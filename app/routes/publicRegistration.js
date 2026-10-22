const express = require('express');
const { randomUUID } = require('crypto');
const { pool } = require('../db');

const router = express.Router();

// Bộ nhớ đệm chống spam đăng ký (in-memory rate limit theo IP)
const registrationRateLimit = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 phút
const MAX_REQUESTS_PER_WINDOW = 15; // Tối đa 15 yêu cầu / phút / IP

const checkRateLimit = (req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const clientRecord = registrationRateLimit.get(clientIp) || { count: 0, resetTime: now + RATE_LIMIT_WINDOW_MS };

    if (now > clientRecord.resetTime) {
        clientRecord.count = 0;
        clientRecord.resetTime = now + RATE_LIMIT_WINDOW_MS;
    }

    clientRecord.count++;
    registrationRateLimit.set(clientIp, clientRecord);

    if (clientRecord.count > MAX_REQUESTS_PER_WINDOW) {
        return res.status(429).json({
            success: false,
            error: 'Bạn thao tác quá nhanh. Vui lòng chờ 1 phút trước khi đăng ký lại.'
        });
    }

    next();
};

/**
 * POST /api/public/registrations
 * Đăng ký vé tham gia sự kiện công khai (Transaction an toàn, chống race-condition & bán vượt vé)
 */
router.post('/registrations', checkRateLimit, async (req, res) => {
    const { eventId, fullName, email, phone, organization } = req.body || {};

    const id = Number(eventId);
    const name = typeof fullName === 'string' ? fullName.trim() : '';
    const mail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const tel = typeof phone === 'string' ? phone.trim() : '';
    const org = typeof organization === 'string' ? organization.trim() : 'Cá nhân';

    // 1. Kiểm tra tính hợp lệ của dữ liệu đầu vào
    if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Mã sự kiện không hợp lệ.'
        });
    }

    if (name.length < 2 || name.length > 255) {
        return res.status(400).json({
            success: false,
            error: 'Họ và tên phải từ 2 đến 255 ký tự.'
        });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || mail.length > 255) {
        return res.status(400).json({
            success: false,
            error: 'Địa chỉ email không đúng định dạng.'
        });
    }

    if (tel && (!/^[0-9+\s().-]{8,20}$/.test(tel))) {
        return res.status(400).json({
            success: false,
            error: 'Số điện thoại không hợp lệ (8 - 20 chữ số).'
        });
    }

    let client;

    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 2. Khóa dòng sự kiện để kiểm tra số lượng vé và trạng thái (chống race condition)
        const eventRes = await client.query(
            `SELECT id, name, date, event_time, location, total_tickets, tickets_sold,
                    status, is_deleted
             FROM events
             WHERE id = $1
             FOR UPDATE`,
            [id]
        );

        if (eventRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Không tìm thấy sự kiện trên hệ thống.'
            });
        }

        const event = eventRes.rows[0];

        // 3. Kiểm tra điều kiện mở đăng ký
        if (event.is_deleted || event.status === 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Sự kiện này đã bị hủy hoặc tạm ngưng nhận đăng ký.'
            });
        }

        if (event.status !== 'published') {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Sự kiện chưa được công bố chính thức.'
            });
        }

        // Kiểm tra ngày diễn ra (chặn sự kiện đã kết thúc trong quá khứ)
        const eventDateStr = new Date(event.date).toISOString().slice(0, 10);
        const todayStr = new Date().toISOString().slice(0, 10);
        if (eventDateStr < todayStr) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Sự kiện này đã diễn ra, không còn nhận đăng ký.'
            });
        }

        // 4. Kiểm tra sức chứa
        if (event.tickets_sold >= event.total_tickets) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                error: 'Sự kiện đã hết vé! Vui lòng chọn sự kiện khác.'
            });
        }

        // 5. Kiểm tra đăng ký trùng lặp (cùng email trong cùng sự kiện đã có vé hợp lệ)
        const duplicateCheck = await client.query(
            `SELECT a.id, t.ticket_code
             FROM attendees a
             JOIN tickets t ON a.id = t.attendee_id
             WHERE a.event_id = $1 AND LOWER(a.email) = $2 AND t.status IN ('valid', 'used')`,
            [id, mail]
        );

        if (duplicateCheck.rowCount > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Email này đã đăng ký vé cho sự kiện này trước đó.',
                existingTicketCode: duplicateCheck.rows[0].ticket_code
            });
        }

        // 6. Thêm bản ghi người tham dự
        const attendeeRes = await client.query(
            `INSERT INTO attendees
             (event_id, full_name, email, phone, organization, status)
             VALUES ($1, $2, $3, $4, $5, 'confirmed')
             RETURNING id, full_name, email, phone, organization, created_at`,
            [id, name, mail, tel || null, org || null]
        );

        const attendeeId = attendeeRes.rows[0].id;

        // 7. Sinh mã vé duy nhất: tiền tố TK-2026-E{id}-{UUID rút gọn}
        const shortHex = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
        const ticketCode = `TK-2026-E${id}-${shortHex}`;

        // 8. Tạo vé điện tử với trạng thái 'valid'
        await client.query(
            `INSERT INTO tickets
             (ticket_code, event_id, attendee_id, status)
             VALUES ($1, $2, $3, 'valid')`,
            [ticketCode, id, attendeeId]
        );

        // 9. Cập nhật số vé đã bán trong bảng events
        await client.query(
            `UPDATE events
             SET tickets_sold = tickets_sold + 1,
                 updated_at = NOW()
             WHERE id = $1`,
            [id]
        );

        await client.query('COMMIT');

        // URL tạo QR code chuẩn cho mã vé
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(ticketCode)}`;

        return res.status(201).json({
            success: true,
            message: 'Đăng ký vé tham dự thành công!',
            data: {
                eventId: id,
                eventName: event.name,
                eventDate: event.date,
                eventTime: event.event_time,
                eventLocation: event.location,
                attendeeId,
                attendeeName: name,
                attendeeEmail: mail,
                attendeePhone: tel,
                attendeeOrg: org,
                ticketCode,
                qrUrl
            }
        });

    } catch (err) {
        if (client) {
            try { await client.query('ROLLBACK'); } catch (_) {}
        }
        console.error('Registration error:', err);
        return res.status(500).json({
            success: false,
            error: 'Lỗi hệ thống khi xử lý đăng ký vé. Vui lòng thử lại sau.'
        });
    } finally {
        if (client) client.release();
    }
});

/**
 * GET /api/public/tickets/lookup
 * Tra cứu thông tin vé đã đăng ký bằng mã vé hoặc Email + Số điện thoại
 * Đáp ứng Yêu cầu 7.12: Khách xem lại vé bằng cơ chế xác thực thích hợp
 */
router.get('/tickets/lookup', checkRateLimit, async (req, res) => {
    const { ticketCode, email, phone } = req.query || {};

    const code = typeof ticketCode === 'string' ? ticketCode.trim().toUpperCase() : '';
    const mail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const tel = typeof phone === 'string' ? phone.trim() : '';

    if (!code && (!mail || !tel)) {
        return res.status(400).json({
            success: false,
            error: 'Vui lòng cung cấp Mã vé hoặc cả Email và Số điện thoại để tra cứu.'
        });
    }

    try {
        let querySql = `
            SELECT
                t.ticket_code,
                t.status AS ticket_status,
                t.checked_in_at,
                t.created_at AS ticket_created_at,
                a.full_name AS attendee_name,
                a.email AS attendee_email,
                a.phone AS attendee_phone,
                a.organization AS attendee_org,
                e.id AS event_id,
                e.name AS event_name,
                e.date AS event_date,
                e.event_time,
                e.location AS event_location,
                e.description AS event_description
            FROM tickets t
            JOIN attendees a ON t.attendee_id = a.id
            JOIN events e ON t.event_id = e.id
            WHERE 1=1
        `;
        const params = [];

        if (code) {
            params.push(code);
            querySql += ` AND UPPER(t.ticket_code) = $${params.length}`;
        } else {
            params.push(mail, tel);
            querySql += ` AND LOWER(a.email) = $${params.length - 1} AND a.phone = $${params.length}`;
        }

        querySql += ` ORDER BY t.created_at DESC LIMIT 10`;

        const result = await pool.query(querySql, params);

        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Không tìm thấy thông tin vé phù hợp với dữ liệu cung cấp.'
            });
        }

        const tickets = result.rows.map(row => ({
            ticketCode: row.ticket_code,
            ticketStatus: row.ticket_status,
            checkedInAt: row.checked_in_at,
            createdAt: row.ticket_created_at,
            attendeeName: row.attendee_name,
            attendeeEmail: row.attendee_email,
            attendeePhone: row.attendee_phone,
            attendeeOrg: row.attendee_org,
            eventId: row.event_id,
            eventName: row.event_name,
            eventDate: row.event_date,
            eventTime: row.event_time,
            eventLocation: row.event_location,
            qrUrl: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(row.ticket_code)}`
        }));

        return res.json({
            success: true,
            totalFound: tickets.length,
            data: tickets
        });

    } catch (err) {
        console.error('Ticket lookup error:', err);
        return res.status(500).json({
            success: false,
            error: 'Lỗi hệ thống khi tra cứu vé.'
        });
    }
});

module.exports = router;

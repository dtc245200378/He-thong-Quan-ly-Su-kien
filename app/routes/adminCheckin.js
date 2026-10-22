const express = require('express');
const router = express.Router();
const { pool, logAdminAction } = require('../db');
const { requireAdminApi } = require('../middleware/auth');

// Xác minh và thực hiện check-in vé
router.post('/checkin', requireAdminApi, async (req, res) => {
    let { ticketCode } = req.body;
    const clientIp = req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1';

    if (!ticketCode || typeof ticketCode !== 'string' || !ticketCode.trim()) {
        return res.status(400).json({
            success: false,
            error: 'Vui lòng nhập hoặc quét mã vé hợp lệ.'
        });
    }

    ticketCode = ticketCode.trim();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Tìm kiếm vé trong CSDL
        const ticketRes = await client.query(`
            SELECT
                t.*,
                a.full_name AS attendee_name,
                a.email AS attendee_email,
                a.phone AS attendee_phone,
                a.organization AS attendee_organization,
                e.id AS event_id,
                e.name AS event_name,
                e.date AS event_date,
                e.location AS event_location,
                e.event_time
            FROM tickets t
            JOIN attendees a ON t.attendee_id = a.id
            JOIN events e ON t.event_id = e.id
            WHERE LOWER(t.ticket_code) = LOWER($1)
            FOR UPDATE OF t
        `, [ticketCode]);

        // 1. Kiểm tra vé giả / không tồn tại
        if (ticketRes.rows.length === 0) {
            await client.query('ROLLBACK');
            await logAdminAction({
                adminId: req.admin.id,
                username: req.admin.username,
                action: 'CHECKIN_FAILED_INVALID_CODE',
                entityType: 'CHECKIN',
                entityId: ticketCode,
                details: { error: 'Ticket code not found' },
                ip: clientIp
            });
            return res.status(404).json({
                success: false,
                status: 'invalid',
                error: `Mã vé "${ticketCode}" KHÔNG TỒN TẠI trên hệ thống! Phát hiện vé không hợp lệ.`
            });
        }

        const ticket = ticketRes.rows[0];

        // 2. Kiểm tra vé đã bị hủy
        if (ticket.status === 'cancelled') {
            await client.query('ROLLBACK');
            await logAdminAction({
                adminId: req.admin.id,
                username: req.admin.username,
                action: 'CHECKIN_REJECTED_CANCELLED',
                entityType: 'CHECKIN',
                entityId: ticketCode,
                details: { cancellation_reason: ticket.cancellation_reason, cancelled_at: ticket.cancelled_at },
                ip: clientIp
            });
            return res.status(400).json({
                success: false,
                status: 'cancelled',
                error: `Vé "${ticketCode}" đã BỊ HỦY BỎ vào ${ticket.cancelled_at ? new Date(ticket.cancelled_at).toLocaleString('vi-VN') : 'trước đó'} (Lý do: ${ticket.cancellation_reason || 'Không nêu'}). Không thể check-in!`,
                ticket
            });
        }

        // 3. Kiểm tra check-in trùng (vé đã sử dụng)
        if (ticket.status === 'used') {
            await client.query('ROLLBACK');
            const checkedTimeStr = ticket.checked_in_at ? new Date(ticket.checked_in_at).toLocaleString('vi-VN') : 'trước đó';
            const checkedByStr = ticket.checked_in_by || 'Ban tổ chức';

            await logAdminAction({
                adminId: req.admin.id,
                username: req.admin.username,
                action: 'CHECKIN_DUPLICATE_ATTEMPT',
                entityType: 'CHECKIN',
                entityId: ticketCode,
                details: { previousCheckinTime: ticket.checked_in_at, checkedInBy: ticket.checked_in_by },
                ip: clientIp
            });

            return res.status(409).json({
                success: false,
                status: 'duplicate',
                error: `CẢNH BÁO VÉ TRÙNG! Vé "${ticketCode}" đã được check-in vào lúc ${checkedTimeStr} bởi [${checkedByStr}].`,
                ticket
            });
        }

        // 4. Vé hợp lệ -> Tiến hành check-in
        const checkinTime = new Date();
        const updateRes = await client.query(`
            UPDATE tickets
            SET status = 'used',
                checked_in_at = $1,
                checked_in_by = $2,
                updated_at = NOW()
            WHERE id = $3
            RETURNING *
        `, [checkinTime, req.admin.username, ticket.id]);

        await client.query('COMMIT');

        // Ghi nhật ký thành công
        await logAdminAction({
            adminId: req.admin.id,
            username: req.admin.username,
            action: 'CHECKIN_SUCCESS',
            entityType: 'CHECKIN',
            entityId: ticketCode,
            details: {
                attendee_name: ticket.attendee_name,
                event_name: ticket.event_name,
                checked_in_at: checkinTime
            },
            ip: clientIp
        });

        return res.json({
            success: true,
            status: 'success',
            message: 'CHECK-IN THÀNH CÔNG! Chào mừng khách tham dự.',
            data: {
                ticketCode: ticket.ticket_code,
                attendeeName: ticket.attendee_name,
                attendeeEmail: ticket.attendee_email,
                attendeePhone: ticket.attendee_phone,
                organization: ticket.attendee_organization,
                eventName: ticket.event_name,
                eventDate: ticket.event_date,
                eventTime: ticket.event_time,
                eventLocation: ticket.event_location,
                checkedInAt: checkinTime,
                checkedInBy: req.admin.username
            }
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Check-in error:', err);
        return res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

// Lấy danh sách lượt check-in gần nhất phục vụ màn hình trực quan tại cổng
router.get('/checkin/recent', requireAdminApi, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                t.ticket_code,
                t.checked_in_at,
                t.checked_in_by,
                a.full_name AS attendee_name,
                a.email AS attendee_email,
                a.organization AS attendee_organization,
                e.name AS event_name
            FROM tickets t
            JOIN attendees a ON t.attendee_id = a.id
            JOIN events e ON t.event_id = e.id
            WHERE t.status = 'used'
            ORDER BY t.checked_in_at DESC
            LIMIT 20
        `);

        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

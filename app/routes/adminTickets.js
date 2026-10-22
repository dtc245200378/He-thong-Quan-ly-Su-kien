const express = require('express');
const router = express.Router();
const { pool, logAdminAction } = require('../db');
const { requireAdminApi } = require('../middleware/auth');

// Lấy danh sách vé điện tử (tìm kiếm mã vé/tên/email, lọc theo trạng thái/sự kiện, phân trang)
router.get('/tickets', requireAdminApi, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '15', 10)));
        const offset = (page - 1) * limit;
        const search = req.query.search ? `%${req.query.search.trim().toLowerCase()}%` : null;
        const status = req.query.status || 'all';
        const eventId = req.query.eventId ? parseInt(req.query.eventId, 10) : null;

        let whereConditions = ["1=1"];
        let params = [];
        let paramIdx = 1;

        if (search) {
            whereConditions.push(`(LOWER(t.ticket_code) LIKE $${paramIdx} OR LOWER(a.full_name) LIKE $${paramIdx} OR LOWER(a.email) LIKE $${paramIdx})`);
            params.push(search);
            paramIdx++;
        }

        if (status && status !== 'all') {
            whereConditions.push(`t.status = $${paramIdx}`);
            params.push(status);
            paramIdx++;
        }

        if (eventId && !isNaN(eventId)) {
            whereConditions.push(`t.event_id = $${paramIdx}`);
            params.push(eventId);
            paramIdx++;
        }

        const whereSql = whereConditions.join(" AND ");

        // Đếm tổng số bản ghi
        const countSql = `
            SELECT COUNT(*) AS total
            FROM tickets t
            JOIN attendees a ON t.attendee_id = a.id
            JOIN events e ON t.event_id = e.id
            WHERE ${whereSql}
        `;
        const countRes = await pool.query(countSql, params);
        const total = parseInt(countRes.rows[0].total, 10);

        // Lấy danh sách
        params.push(limit, offset);
        const listSql = `
            SELECT
                t.*,
                a.full_name AS attendee_name,
                a.email AS attendee_email,
                a.phone AS attendee_phone,
                a.organization AS attendee_organization,
                e.name AS event_name,
                e.date AS event_date,
                e.location AS event_location,
                e.event_time
            FROM tickets t
            JOIN attendees a ON t.attendee_id = a.id
            JOIN events e ON t.event_id = e.id
            WHERE ${whereSql}
            ORDER BY t.created_at DESC, t.id DESC
            LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `;

        const listRes = await pool.query(listSql, params);

        res.json({
            success: true,
            data: listRes.rows,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Tickets list error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Xem chi tiết vé theo mã vé
router.get('/tickets/:code', requireAdminApi, async (req, res) => {
    try {
        const ticketCode = req.params.code.trim();
        const result = await pool.query(`
            SELECT
                t.*,
                a.full_name AS attendee_name,
                a.email AS attendee_email,
                a.phone AS attendee_phone,
                a.organization AS attendee_organization,
                e.name AS event_name,
                e.date AS event_date,
                e.location AS event_location,
                e.event_time
            FROM tickets t
            JOIN attendees a ON t.attendee_id = a.id
            JOIN events e ON t.event_id = e.id
            WHERE LOWER(t.ticket_code) = LOWER($1)
        `, [ticketCode]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy vé tương ứng.' });
        }

        res.json({ success: true, ticket: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Hủy vé điện tử và ghi nhận lịch sử thay đổi
router.post('/tickets/:code/cancel', requireAdminApi, async (req, res) => {
    const ticketCode = req.params.code.trim();
    const { reason } = req.body;
    const clientIp = req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1';

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const ticketRes = await client.query('SELECT * FROM tickets WHERE LOWER(ticket_code) = LOWER($1) FOR UPDATE', [ticketCode]);
        if (ticketRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Mã vé không tồn tại.' });
        }

        const ticket = ticketRes.rows[0];
        if (ticket.status === 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Vé này đã bị hủy trước đó.' });
        }

        // Cập nhật trạng thái vé
        await client.query(`
            UPDATE tickets
            SET status = 'cancelled',
                cancellation_reason = $1,
                cancelled_at = NOW(),
                cancelled_by = $2,
                updated_at = NOW()
            WHERE id = $3
        `, [reason || 'Quản trị viên hủy vé', req.admin.username, ticket.id]);

        // Cập nhật trạng thái người tham dự
        await client.query('UPDATE attendees SET status = \'cancelled\' WHERE id = $1', [ticket.attendee_id]);

        // Giảm số lượng tickets_sold của sự kiện
        await client.query(`
            UPDATE events
            SET tickets_sold = GREATEST(0, tickets_sold - 1),
                updated_at = NOW()
            WHERE id = $1
        `, [ticket.event_id]);

        await client.query('COMMIT');

        // Ghi audit log
        await logAdminAction({
            adminId: req.admin.id,
            username: req.admin.username,
            action: 'TICKET_CANCELLED',
            entityType: 'TICKET',
            entityId: ticketCode,
            details: { reason, attendee_id: ticket.attendee_id, event_id: ticket.event_id },
            ip: clientIp
        });

        res.json({
            success: true,
            message: `Hủy vé ${ticketCode} thành công. Lịch sử đã được ghi nhận.`
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Cancel ticket error:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;

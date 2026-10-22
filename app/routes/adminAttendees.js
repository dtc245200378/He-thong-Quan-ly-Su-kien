const express = require('express');
const router = express.Router();
const { pool, logAdminAction } = require('../db');
const { requireAdminApi } = require('../middleware/auth');

// Lấy danh sách người tham dự (có tìm kiếm, lọc theo sự kiện/trạng thái, phân trang)
router.get('/attendees', requireAdminApi, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '15', 10)));
        const offset = (page - 1) * limit;
        const search = req.query.search ? `%${req.query.search.trim().toLowerCase()}%` : null;
        const eventId = req.query.eventId ? parseInt(req.query.eventId, 10) : null;
        const status = req.query.status || 'all';

        let whereConditions = ["1=1"];
        let params = [];
        let paramIdx = 1;

        if (search) {
            whereConditions.push(`(LOWER(a.full_name) LIKE $${paramIdx} OR LOWER(a.email) LIKE $${paramIdx} OR LOWER(a.phone) LIKE $${paramIdx} OR LOWER(t.ticket_code) LIKE $${paramIdx})`);
            params.push(search);
            paramIdx++;
        }

        if (eventId && !isNaN(eventId)) {
            whereConditions.push(`a.event_id = $${paramIdx}`);
            params.push(eventId);
            paramIdx++;
        }

        if (status && status !== 'all') {
            whereConditions.push(`a.status = $${paramIdx}`);
            params.push(status);
            paramIdx++;
        }

        const whereSql = whereConditions.join(" AND ");

        // Đếm tổng số bản ghi
        const countSql = `
            SELECT COUNT(*) AS total
            FROM attendees a
            LEFT JOIN tickets t ON a.id = t.attendee_id
            WHERE ${whereSql}
        `;
        const countRes = await pool.query(countSql, params);
        const total = parseInt(countRes.rows[0].total, 10);

        // Lấy danh sách chi tiết
        params.push(limit, offset);
        const listSql = `
            SELECT
                a.*,
                e.name AS event_name,
                e.date AS event_date,
                e.location AS event_location,
                t.id AS ticket_id,
                t.ticket_code,
                t.status AS ticket_status,
                t.checked_in_at,
                t.checked_in_by
            FROM attendees a
            JOIN events e ON a.event_id = e.id
            LEFT JOIN tickets t ON a.id = t.attendee_id
            WHERE ${whereSql}
            ORDER BY a.created_at DESC, a.id DESC
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
        console.error('Attendees list error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Xem chi tiết 1 người tham dự
router.get('/attendees/:id', requireAdminApi, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                a.*,
                e.name AS event_name,
                e.date AS event_date,
                e.location AS event_location,
                e.event_time,
                t.id AS ticket_id,
                t.ticket_code,
                t.status AS ticket_status,
                t.checked_in_at,
                t.checked_in_by,
                t.cancellation_reason,
                t.cancelled_at,
                t.cancelled_by
            FROM attendees a
            JOIN events e ON a.event_id = e.id
            LEFT JOIN tickets t ON a.id = t.attendee_id
            WHERE a.id = $1
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy thông tin người tham dự.' });
        }

        res.json({ success: true, attendee: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Hủy đăng ký người tham dự theo quy tắc nghiệp vụ (Transaction bảo toàn lịch sử vé)
router.post('/attendees/:id/cancel', requireAdminApi, async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body;
    const clientIp = req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1';

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Tìm thông tin người tham dự
        const attRes = await client.query('SELECT * FROM attendees WHERE id = $1 FOR UPDATE', [id]);
        if (attRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, error: 'Không tìm thấy người tham dự.' });
        }

        const attendee = attRes.rows[0];
        if (attendee.status === 'cancelled') {
            await client.query('ROLLBACK');
            return res.status(400).json({ success: false, error: 'Đăng ký này đã bị hủy trước đó.' });
        }

        // Cập nhật trạng thái người tham dự sang 'cancelled' (không xóa cứng để bảo lưu hồ sơ)
        await client.query('UPDATE attendees SET status = \'cancelled\' WHERE id = $1', [id]);

        // Cập nhật vé tương ứng sang 'cancelled'
        await client.query(`
            UPDATE tickets
            SET status = 'cancelled',
                cancellation_reason = $1,
                cancelled_at = NOW(),
                cancelled_by = $2,
                updated_at = NOW()
            WHERE attendee_id = $3
        `, [reason || 'Quản trị viên hủy đăng ký', req.admin.username, id]);

        // Giảm tickets_sold của sự kiện tương ứng đi 1
        await client.query(`
            UPDATE events
            SET tickets_sold = GREATEST(0, tickets_sold - 1),
                updated_at = NOW()
            WHERE id = $1
        `, [attendee.event_id]);

        await client.query('COMMIT');

        // Ghi audit log
        await logAdminAction({
            adminId: req.admin.id,
            username: req.admin.username,
            action: 'ATTENDEE_CANCELLED',
            entityType: 'ATTENDEE',
            entityId: id,
            details: { name: attendee.full_name, email: attendee.email, event_id: attendee.event_id, reason },
            ip: clientIp
        });

        res.json({
            success: true,
            message: `Đã hủy đăng ký thành công cho người tham dự "${attendee.full_name}". Số vé sự kiện đã được hoàn lại.`
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Cancel attendee error:', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        client.release();
    }
});

module.exports = router;

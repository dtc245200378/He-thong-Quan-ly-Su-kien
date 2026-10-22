const express = require('express');
const router = express.Router();
const { pool, logAdminAction } = require('../db');
const { requireAdminApi } = require('../middleware/auth');

// Lấy danh sách sự kiện có tìm kiếm, lọc, phân trang
router.get('/events', requireAdminApi, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page || '1', 10));
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '10', 10)));
        const offset = (page - 1) * limit;
        const search = req.query.search ? `%${req.query.search.trim().toLowerCase()}%` : null;
        const status = req.query.status || 'all';

        let whereConditions = ["(is_deleted = false OR is_deleted IS NULL)"];
        let params = [];
        let paramIdx = 1;

        if (search) {
            whereConditions.push(`(LOWER(name) LIKE $${paramIdx} OR LOWER(location) LIKE $${paramIdx})`);
            params.push(search);
            paramIdx++;
        }

        if (status && status !== 'all') {
            if (status === 'open') {
                whereConditions.push("date = CURRENT_DATE");
            } else if (status === 'upcoming') {
                whereConditions.push("date > CURRENT_DATE AND tickets_sold < total_tickets");
            } else if (status === 'ended') {
                whereConditions.push("date < CURRENT_DATE");
            } else if (status === 'soldout') {
                whereConditions.push("tickets_sold >= total_tickets");
            }
        }

        const whereSql = whereConditions.join(" AND ");

        // Đếm tổng số bản ghi
        const countRes = await pool.query(`SELECT COUNT(*) AS total FROM events WHERE ${whereSql}`, params);
        const total = parseInt(countRes.rows[0].total, 10);

        // Lấy danh sách kèm số lượng vé đã check-in thực tế
        params.push(limit, offset);
        const querySql = `
            SELECT
                e.*,
                COALESCE(ci.checked_in_count, 0) AS checked_in_count
            FROM events e
            LEFT JOIN (
                SELECT event_id, COUNT(*) AS checked_in_count
                FROM tickets
                WHERE status = 'used'
                GROUP BY event_id
            ) ci ON e.id = ci.event_id
            WHERE ${whereSql}
            ORDER BY e.date ASC, e.id ASC
            LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
        `;

        const eventsRes = await pool.query(querySql, params);

        res.json({
            success: true,
            data: eventsRes.rows,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('Events list error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Lấy chi tiết 1 sự kiện
router.get('/events/:id', requireAdminApi, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT e.*,
                COALESCE(t.total_issued, 0) AS actual_tickets_count,
                COALESCE(t.used_count, 0) AS actual_checked_in
            FROM events e
            LEFT JOIN (
                SELECT event_id,
                    COUNT(*) AS total_issued,
                    COUNT(CASE WHEN status = 'used' THEN 1 END) AS used_count
                FROM tickets
                GROUP BY event_id
            ) t ON e.id = t.event_id
            WHERE e.id = $1 AND (e.is_deleted = false OR e.is_deleted IS NULL)
        `, [req.params.id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy sự kiện.' });
        }

        res.json({ success: true, event: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Thêm sự kiện mới
router.post('/events', requireAdminApi, async (req, res) => {
    const { name, date, total_tickets, location, event_time, description, image_url } = req.body;
    const clientIp = req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1';

    if (!name || !date || !total_tickets) {
        return res.status(400).json({
            success: false,
            error: 'Vui lòng nhập đầy đủ: Tên sự kiện, Ngày tổ chức và Tổng số vé.'
        });
    }

    const ticketsNum = parseInt(total_tickets, 10);
    if (isNaN(ticketsNum) || ticketsNum <= 0) {
        return res.status(400).json({
            success: false,
            error: 'Tổng số vé phải là số nguyên dương lớn hơn 0.'
        });
    }

    try {
        const insertRes = await pool.query(`
            INSERT INTO events (
                name, date, total_tickets, tickets_sold,
                location, event_time, description, image_url, status, is_deleted
            )
            VALUES ($1, $2, $3, 0, $4, $5, $6, $7, 'published', false)
            RETURNING *
        `, [
            name.trim(),
            date,
            ticketsNum,
            (location || 'Trung tâm Hội nghị Quốc tế').trim(),
            (event_time || '08:30').trim(),
            (description || 'Sự kiện công nghệ chuyên nghiệp.').trim(),
            image_url || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800'
        ]);

        const newEvent = insertRes.rows[0];

        await logAdminAction({
            adminId: req.admin.id,
            username: req.admin.username,
            action: 'EVENT_CREATED',
            entityType: 'EVENT',
            entityId: newEvent.id,
            details: { name: newEvent.name, total_tickets: newEvent.total_tickets, date: newEvent.date },
            ip: clientIp
        });

        res.status(201).json({
            success: true,
            message: 'Tạo sự kiện mới thành công!',
            event: newEvent
        });
    } catch (err) {
        console.error('Create event error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Sửa sự kiện
router.put('/events/:id', requireAdminApi, async (req, res) => {
    const { id } = req.params;
    const { name, date, total_tickets, location, event_time, description, image_url, status } = req.body;
    const clientIp = req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1';

    try {
        const currentRes = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
        if (currentRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy sự kiện để cập nhật.' });
        }

        const currentEvent = currentRes.rows[0];
        const newTotal = parseInt(total_tickets, 10);

        if (isNaN(newTotal) || newTotal <= 0) {
            return res.status(400).json({ success: false, error: 'Tổng số vé không hợp lệ.' });
        }

        // Quy tắc nghiệp vụ: Không cho phép hạ tổng số vé xuống thấp hơn số vé đã phát hành/đã bán
        if (newTotal < currentEvent.tickets_sold) {
            return res.status(400).json({
                success: false,
                error: `Không thể giảm tổng số vé xuống ${newTotal} vì đã có ${currentEvent.tickets_sold} vé được đăng ký!`
            });
        }

        const updateRes = await pool.query(`
            UPDATE events
            SET name = COALESCE($1, name),
                date = COALESCE($2, date),
                total_tickets = $3,
                location = COALESCE($4, location),
                event_time = COALESCE($5, event_time),
                description = COALESCE($6, description),
                image_url = COALESCE($7, image_url),
                status = COALESCE($8, status),
                updated_at = NOW()
            WHERE id = $9
            RETURNING *
        `, [
            name ? name.trim() : null,
            date || null,
            newTotal,
            location ? location.trim() : null,
            event_time ? event_time.trim() : null,
            description ? description.trim() : null,
            image_url || null,
            status || null,
            id
        ]);

        const updatedEvent = updateRes.rows[0];

        await logAdminAction({
            adminId: req.admin.id,
            username: req.admin.username,
            action: 'EVENT_UPDATED',
            entityType: 'EVENT',
            entityId: id,
            details: { name: updatedEvent.name, total_tickets: updatedEvent.total_tickets, date: updatedEvent.date },
            ip: clientIp
        });

        res.json({
            success: true,
            message: 'Cập nhật sự kiện thành công!',
            event: updatedEvent
        });
    } catch (err) {
        console.error('Update event error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Xóa hoặc ẩn sự kiện (An toàn: soft delete để giữ lịch sử)
router.delete('/events/:id', requireAdminApi, async (req, res) => {
    const { id } = req.params;
    const clientIp = req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1';

    try {
        const checkRes = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
        if (checkRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Sự kiện không tồn tại.' });
        }

        const event = checkRes.rows[0];

        // Nếu sự kiện đã có người đăng ký, sử dụng soft delete (is_deleted = true) để bảo đảm tính toàn vẹn dữ liệu
        await pool.query('UPDATE events SET is_deleted = true, status = \'cancelled\', updated_at = NOW() WHERE id = $1', [id]);

        await logAdminAction({
            adminId: req.admin.id,
            username: req.admin.username,
            action: 'EVENT_DELETED',
            entityType: 'EVENT',
            entityId: id,
            details: { name: event.name, tickets_sold: event.tickets_sold },
            ip: clientIp
        });

        res.json({
            success: true,
            message: `Đã xóa/ẩn sự kiện "${event.name}" thành công (lịch sử vé và người tham dự được lưu trữ an toàn).`
        });
    } catch (err) {
        console.error('Delete event error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAdminApi } = require('../middleware/auth');

// Lấy báo cáo thống kê chi tiết theo từng sự kiện
router.get('/reports/events', requireAdminApi, async (req, res) => {
    try {
        const query = `
            SELECT
                e.id,
                e.name,
                e.date,
                e.location,
                e.total_tickets,
                e.tickets_sold,
                COUNT(t.id) AS total_tickets_in_db,
                COUNT(CASE WHEN t.status = 'used' THEN 1 END) AS checked_in_count,
                COUNT(CASE WHEN t.status = 'valid' THEN 1 END) AS valid_count,
                COUNT(CASE WHEN t.status = 'cancelled' THEN 1 END) AS cancelled_count
            FROM events e
            LEFT JOIN tickets t ON e.id = t.event_id
            WHERE e.is_deleted = false OR e.is_deleted IS NULL
            GROUP BY e.id, e.name, e.date, e.location, e.total_tickets, e.tickets_sold
            ORDER BY e.date ASC
        `;

        const result = await pool.query(query);

        const reports = result.rows.map(row => {
            const total = parseInt(row.total_tickets, 10);
            const sold = parseInt(row.tickets_sold, 10);
            const checkedIn = parseInt(row.checked_in_count, 10);
            const valid = parseInt(row.valid_count, 10);
            const remaining = Math.max(0, total - sold);
            const fillRate = total > 0 ? ((sold / total) * 100).toFixed(1) : '0.0';
            const attendanceRate = sold > 0 ? ((checkedIn / sold) * 100).toFixed(1) : '0.0';

            return {
                id: row.id,
                name: row.name,
                date: row.date,
                location: row.location,
                totalTickets: total,
                ticketsSold: sold,
                checkedInCount: checkedIn,
                validCount: valid,
                cancelledCount: parseInt(row.cancelled_count, 10),
                remainingTickets: remaining,
                fillRate: parseFloat(fillRate),
                attendanceRate: parseFloat(attendanceRate)
            };
        });

        res.json({ success: true, data: reports });
    } catch (err) {
        console.error('Reports error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Xuất file CSV / Excel với UTF-8 BOM
router.get('/reports/export-csv', requireAdminApi, async (req, res) => {
    try {
        const type = req.query.type || 'events'; // 'events' hoặc 'attendees'

        if (type === 'attendees') {
            const eventId = req.query.eventId ? parseInt(req.query.eventId, 10) : null;
            let query = `
                SELECT
                    a.id,
                    a.full_name,
                    a.email,
                    a.phone,
                    a.organization,
                    a.status AS attendee_status,
                    a.created_at AS registration_time,
                    e.name AS event_name,
                    e.date AS event_date,
                    t.ticket_code,
                    t.status AS ticket_status,
                    t.checked_in_at,
                    t.checked_in_by
                FROM attendees a
                JOIN events e ON a.event_id = e.id
                LEFT JOIN tickets t ON a.id = t.attendee_id
                WHERE 1=1
            `;
            const params = [];
            if (eventId && !isNaN(eventId)) {
                query += " AND a.event_id = $1";
                params.push(eventId);
            }
            query += " ORDER BY a.created_at DESC";

            const result = await pool.query(query, params);

            // Tạo nội dung CSV với UTF-8 BOM
            let csv = '\uFEFF';
            csv += 'STT,Họ và Tên,Email,Số Điện Thoại,Đơn Vị,Sự Kiện,Ngày Sự Kiện,Mã Vé,Trạng Thái Vé,Thời Gian Check-in,Người Soát Vé\n';

            result.rows.forEach((r, idx) => {
                const escapeCsv = (str) => `"${(str || '').toString().replace(/"/g, '""')}"`;
                const checkinTime = r.checked_in_at ? new Date(r.checked_in_at).toLocaleString('vi-VN') : 'Chưa check-in';
                const statusText = r.ticket_status === 'used' ? 'Đã check-in' : (r.ticket_status === 'cancelled' ? 'Đã hủy' : 'Hợp lệ');

                csv += [
                    idx + 1,
                    escapeCsv(r.full_name),
                    escapeCsv(r.email),
                    escapeCsv(r.phone),
                    escapeCsv(r.organization),
                    escapeCsv(r.event_name),
                    escapeCsv(r.event_date ? new Date(r.event_date).toISOString().split('T')[0] : ''),
                    escapeCsv(r.ticket_code),
                    escapeCsv(statusText),
                    escapeCsv(checkinTime),
                    escapeCsv(r.checked_in_by || '')
                ].join(',') + '\n';
            });

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=Danh_sach_nguoi_tham_du_${new Date().toISOString().split('T')[0]}.csv`);
            return res.send(csv);
        } else {
            // Xuất báo cáo tổng hợp sự kiện
            const query = `
                SELECT
                    e.id,
                    e.name,
                    e.date,
                    e.location,
                    e.total_tickets,
                    e.tickets_sold,
                    COUNT(CASE WHEN t.status = 'used' THEN 1 END) AS checked_in,
                    COUNT(CASE WHEN t.status = 'valid' THEN 1 END) AS valid_count
                FROM events e
                LEFT JOIN tickets t ON e.id = t.event_id
                WHERE e.is_deleted = false OR e.is_deleted IS NULL
                GROUP BY e.id, e.name, e.date, e.location, e.total_tickets, e.tickets_sold
                ORDER BY e.date ASC
            `;

            const result = await pool.query(query);

            let csv = '\uFEFF';
            csv += 'STT,Tên Sự Kiện,Ngày Tổ Chức,Địa Điểm,Tổng Vé Phát Hành,Vé Đã Bán/Đăng Ký,Vé Còn Lại,Đã Check-in,Tỷ Lệ Lấp Đầy (%),Tỷ Lệ Tham Dự (%)\n';

            result.rows.forEach((r, idx) => {
                const escapeCsv = (str) => `"${(str || '').toString().replace(/"/g, '""')}"`;
                const total = parseInt(r.total_tickets, 10);
                const sold = parseInt(r.tickets_sold, 10);
                const checkedIn = parseInt(r.checked_in, 10);
                const remaining = Math.max(0, total - sold);
                const fillRate = total > 0 ? ((sold / total) * 100).toFixed(1) : '0.0';
                const attRate = sold > 0 ? ((checkedIn / sold) * 100).toFixed(1) : '0.0';

                csv += [
                    idx + 1,
                    escapeCsv(r.name),
                    escapeCsv(r.date ? new Date(r.date).toISOString().split('T')[0] : ''),
                    escapeCsv(r.location),
                    total,
                    sold,
                    remaining,
                    checkedIn,
                    `${fillRate}%`,
                    `${attRate}%`
                ].join(',') + '\n';
            });

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename=Bao_cao_tong_hop_su_kien_${new Date().toISOString().split('T')[0]}.csv`);
            return res.send(csv);
        }
    } catch (err) {
        console.error('Export CSV error:', err);
        res.status(500).send('Lỗi khi xuất file báo cáo: ' + err.message);
    }
});

module.exports = router;

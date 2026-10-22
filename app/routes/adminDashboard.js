const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { requireAdminApi } = require('../middleware/auth');

router.get('/dashboard', requireAdminApi, async (req, res) => {
    try {
        // 1. Tổng sự kiện
        const eventsCountRes = await pool.query(
            "SELECT COUNT(*) AS total FROM events WHERE is_deleted = false OR is_deleted IS NULL"
        );
        const totalEvents = parseInt(eventsCountRes.rows[0].total, 10);

        // 2. Tổng vé phát hành & tổng vé đã bán từ events
        const eventTotalsRes = await pool.query(`
            SELECT
                COALESCE(SUM(total_tickets), 0) AS total_capacity,
                COALESCE(SUM(tickets_sold), 0) AS total_sold
            FROM events
            WHERE is_deleted = false OR is_deleted IS NULL
        `);
        const totalTicketsIssued = parseInt(eventTotalsRes.rows[0].total_capacity, 10);
        const totalTicketsSold = parseInt(eventTotalsRes.rows[0].total_sold, 10);

        // 3. Đếm số vé đã check-in thực tế trong bảng tickets
        const checkinCountRes = await pool.query(
            "SELECT COUNT(*) AS total FROM tickets WHERE status = 'used'"
        );
        const totalCheckedIn = parseInt(checkinCountRes.rows[0].total, 10);

        // 4. Đếm số đăng ký thực tế trong bảng attendees
        const attendeesCountRes = await pool.query(
            "SELECT COUNT(*) AS total FROM attendees WHERE status = 'confirmed'"
        );
        const totalRegistrations = parseInt(attendeesCountRes.rows[0].total, 10);

        // 5. Vé còn lại và các tỷ lệ
        const remainingTickets = Math.max(0, totalTicketsIssued - totalTicketsSold);
        const fillRate = totalTicketsIssued > 0 ? ((totalTicketsSold / totalTicketsIssued) * 100).toFixed(1) : 0;
        const checkinRate = totalTicketsSold > 0 ? ((totalCheckedIn / totalTicketsSold) * 100).toFixed(1) : 0;

        // 6. Thống kê theo từng sự kiện (cho biểu đồ)
        const eventsStatsRes = await pool.query(`
            SELECT
                e.id,
                e.name,
                e.date,
                e.total_tickets,
                e.tickets_sold,
                COUNT(CASE WHEN t.status = 'used' THEN 1 END) AS checked_in,
                COUNT(CASE WHEN t.status = 'valid' THEN 1 END) AS valid_tickets
            FROM events e
            LEFT JOIN tickets t ON e.id = t.event_id
            WHERE e.is_deleted = false OR e.is_deleted IS NULL
            GROUP BY e.id, e.name, e.date, e.total_tickets, e.tickets_sold
            ORDER BY e.date ASC
        `);

        // 7. Thống kê trạng thái vé (used, valid, cancelled)
        const ticketStatusRes = await pool.query(`
            SELECT status, COUNT(*) AS count
            FROM tickets
            GROUP BY status
        `);

        // 8. Danh sách sự kiện sắp diễn ra (5 sự kiện gần nhất)
        const upcomingEventsRes = await pool.query(`
            SELECT id, name, date, event_time, location, total_tickets, tickets_sold
            FROM events
            WHERE (is_deleted = false OR is_deleted IS NULL)
            ORDER BY date ASC
            LIMIT 5
        `);

        // 9. Lịch sử check-in gần nhất (5 lượt mới nhất)
        const recentCheckinsRes = await pool.query(`
            SELECT
                t.ticket_code,
                t.checked_in_at,
                t.checked_in_by,
                a.full_name AS attendee_name,
                a.email AS attendee_email,
                e.name AS event_name
            FROM tickets t
            JOIN attendees a ON t.attendee_id = a.id
            JOIN events e ON t.event_id = e.id
            WHERE t.status = 'used'
            ORDER BY t.checked_in_at DESC
            LIMIT 5
        `);

        res.json({
            success: true,
            data: {
                metrics: {
                    totalEvents,
                    totalTicketsIssued,
                    totalRegistrations,
                    totalTicketsSold,
                    totalCheckedIn,
                    remainingTickets,
                    fillRate: parseFloat(fillRate),
                    checkinRate: parseFloat(checkinRate)
                },
                eventsBreakdown: eventsStatsRes.rows.map(r => ({
                    id: r.id,
                    name: r.name,
                    date: r.date,
                    totalTickets: parseInt(r.total_tickets, 10),
                    ticketsSold: parseInt(r.tickets_sold, 10),
                    checkedIn: parseInt(r.checked_in, 10),
                    validTickets: parseInt(r.valid_tickets, 10)
                })),
                ticketStatusBreakdown: ticketStatusRes.rows,
                upcomingEvents: upcomingEventsRes.rows,
                recentCheckins: recentCheckinsRes.rows
            }
        });
    } catch (err) {
        console.error('Dashboard stats error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

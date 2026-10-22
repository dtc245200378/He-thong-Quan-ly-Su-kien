const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const { pool, runMigrations } = require('./db');
const { verifyAdminToken, requireAdminApi } = require('./middleware/auth');

// Import các router quản trị
const adminAuthRouter = require('./routes/adminAuth');
const adminDashboardRouter = require('./routes/adminDashboard');
const adminEventsRouter = require('./routes/adminEvents');
const adminAttendeesRouter = require('./routes/adminAttendees');
const adminTicketsRouter = require('./routes/adminTickets');
const adminCheckinRouter = require('./routes/adminCheckin');
const adminAuditRouter = require('./routes/adminAudit');
const adminReportsRouter = require('./routes/adminReports');

// Import router đăng ký & tra cứu công khai cho khách hàng
const publicRegistrationRouter = require('./routes/publicRegistration');
const customerAuthRouter = require('./routes/customerAuth');

const app = express();

// CUSTOMER_TRUST_PROXY_V1
// Chỉ bật khi ứng dụng chạy sau reverse proxy đáng tin cậy.
// Nginx phải ghi đè các header X-Forwarded-*.
if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

const port = process.env.PORT || 3000;

// Bảo mật tiêu chuẩn
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(cookieParser());

// Chống rò rỉ bộ nhớ đệm trang quản trị
app.use('/admin', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    next();
});

// Kiểm tra Origin / Host chống CSRF trên các API quản trị thay đổi trạng thái
app.use('/api/admin', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        const origin = req.get('origin');
        const host = req.get('x-forwarded-host') || req.get('host');
        if (origin) {
            try {
                if (new URL(origin).host !== host) {
                    return res.status(403).json({ success: false, error: 'Phát hiện yêu cầu không hợp lệ (Origin mismatch).' });
                }
            } catch (_) {
                return res.status(403).json({ success: false, error: 'Origin không hợp lệ.' });
            }
        } else if (req.get('sec-fetch-site') === 'cross-site') {
            return res.status(403).json({ success: false, error: 'Yêu cầu cross-site bị từ chối.' });
        }
    }
    next();
});

// Middleware bảo vệ các tài nguyên HTML trong /admin
app.use('/admin', (req, res, next) => {
    const publicPaths = ['/login', '/login.html', '/css/', '/js/'];
    if (publicPaths.some(p => req.path === p || (p.endsWith('/') && req.path.startsWith(p)))) {
        return next();
    }

    const token = req.cookies?.admin_token;
    if (!token || !verifyAdminToken(token)) {
        return res.redirect('/admin/login');
    }
    next();
});

// Cung cấp các file tĩnh trong thư mục public
app.use(express.static(path.join(__dirname, 'public')));

// Gắn các API Admin
app.use('/api/admin/auth', adminAuthRouter);
app.use('/api/admin', adminDashboardRouter);
app.use('/api/admin', adminEventsRouter);
app.use('/api/admin', adminAttendeesRouter);
app.use('/api/admin', adminTicketsRouter);
app.use('/api/admin', adminCheckinRouter);
app.use('/api/admin', adminAuditRouter);
app.use('/api/admin', adminReportsRouter);

// Gắn API công khai cho khách hàng (Đăng ký vé, Tra cứu vé QR)
app.use('/api/public', publicRegistrationRouter);
app.use('/api/customer', customerAuthRouter);

// ==========================================
// CÁC ĐƯỜNG DẪN GIAO DIỆN ADMIN (HTML PAGES)
// ==========================================

// Trang đăng nhập Admin
app.get('/admin/login', (req, res) => {
    if (req.cookies?.admin_token && verifyAdminToken(req.cookies.admin_token)) {
        return res.redirect('/admin');
    }
    res.sendFile(path.join(__dirname, 'public', 'admin', 'login.html'));
});

// Trang đăng xuất Admin
app.get('/admin/logout', (req, res) => {
    res.clearCookie('admin_token');
    res.redirect('/admin/login');
});

// Trang Admin Portal & Dashboard
app.get(['/admin', '/admin/*', '/admin/profile'], (req, res) => {
    const token = req.cookies?.admin_token;
    if (!token || !verifyAdminToken(token)) {
        return res.redirect('/admin/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html'));
});

// ==========================================
// CÁC ROUTE CÔNG KHAI CHO WEBSITE KHÁCH HÀNG
// ==========================================

// Lấy danh sách sự kiện công khai (chỉ lấy các sự kiện đã công bố và chưa bị xóa mềm)
app.get('/api/events', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                id, name, date, total_tickets, tickets_sold,
                GREATEST(0, total_tickets - tickets_sold) AS remaining_tickets,
                location, event_time, description, image_url, status,
                CASE
                    WHEN tickets_sold >= total_tickets THEN 'soldout'
                    WHEN date < CURRENT_DATE THEN 'ended'
                    WHEN date = CURRENT_DATE THEN 'open'
                    ELSE 'upcoming'
                END AS calculated_status
            FROM events
            WHERE (is_deleted = false OR is_deleted IS NULL)
              AND status = 'published'
            ORDER BY date ASC, id ASC
        `);
        res.json({
            success: true,
            data: result.rows
        });
    } catch (err) {
        console.error("Public API Events DB Error:", err.message);
        res.status(500).json({ success: false, data: [], error: 'Không thể tải danh sách sự kiện.' });
    }
});

// Tương thích ngược: Endpoint tạo sự kiện (YÊU CẦU QUYỀN ADMIN)
app.post('/api/events', requireAdminApi, async (req, res) => {
    const { name, date, total_tickets, location, description } = req.body;
    try {
        const result = await pool.query(
            `INSERT INTO events (name, date, total_tickets, tickets_sold, location, description, status, is_deleted)
             VALUES ($1, $2, $3, 0, $4, $5, 'published', false)
             RETURNING *`,
            [name, date, total_tickets, location || 'Trung tâm Hội nghị Quốc tế', description || '']
        );
        res.status(201).json({ success: true, event: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Tương thích ngược: POST /api/events/:id/book (Ủy quyền an toàn qua transaction)
app.post('/api/events/:id/book', async (req, res, next) => {
    req.body.eventId = req.params.id;
    req.body.fullName = req.body.name || req.body.fullName;
    // Chuyển tiếp vào router publicRegistration
    return publicRegistrationRouter.handle(req, res, next);
});

// Trang chủ website khách hàng
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Khởi động server
const startServer = async () => {
    try {
        console.log('[INIT] Đang kiểm tra kết nối PostgreSQL...');
        await pool.query('SELECT 1');
        console.log('[INIT] Kết nối PostgreSQL thành công!');

        // Nếu bật cờ AUTO_MIGRATE=true (môi trường dev), chạy cập nhật cấu trúc bảng an toàn
        if (process.env.AUTO_MIGRATE === 'true') {
            console.log('[INIT] Đang kiểm tra cấu trúc bảng CSDL...');
            await runMigrations();
        }

        app.listen(port, () => {
            console.log(`===============================================`);
            console.log(`🚀 Hệ thống Quản lý Sự kiện đang chạy tại cổng ${port}`);
            console.log(`🌐 Website Khách Hàng: http://localhost:${port}/`);
            console.log(`🔐 Quản trị Admin:     http://localhost:${port}/admin/login`);
            console.log(`===============================================`);
        });
    } catch (err) {
        console.error('[CRITICAL] Không thể khởi động ứng dụng do lỗi CSDL:', err.message);
        process.exit(1);
    }
};

startServer();

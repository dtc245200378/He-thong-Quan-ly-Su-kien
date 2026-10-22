const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, logAdminAction } = require('../db');
const { JWT_SECRET, requireAdminApi, requireRoles } = require('../middleware/auth');

// Đăng nhập Admin
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    const clientIp = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

    if (!username || !password) {
        return res.status(400).json({
            success: false,
            error: 'Vui lòng cung cấp đầy đủ tên đăng nhập và mật khẩu.'
        });
    }

    try {
        const userRes = await pool.query('SELECT * FROM admin_users WHERE username = $1', [username.trim()]);

        if (userRes.rows.length === 0) {
            // Ghi audit log đăng nhập thất bại
            await logAdminAction({
                username: username.trim(),
                action: 'ADMIN_LOGIN_FAILED',
                entityType: 'AUTH',
                details: { reason: 'User not found' },
                ip: clientIp
            });
            return res.status(401).json({
                success: false,
                error: 'Tên đăng nhập hoặc mật khẩu không chính xác.'
            });
        }

        const user = userRes.rows[0];

        // Kiểm tra xem tài khoản có bị khóa tạm thời do nhập sai quá nhiều lần
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
            return res.status(429).json({
                success: false,
                error: `Tài khoản đã bị tạm khóa do nhập sai mật khẩu quá 5 lần. Vui lòng thử lại sau ${minutesLeft} phút.`
            });
        }

        // Kiểm tra mật khẩu
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            const newFailed = (user.failed_attempts || 0) + 1;
            let lockTime = null;
            let errorMsg = 'Tên đăng nhập hoặc mật khẩu không chính xác.';

            if (newFailed >= 5) {
                // Khóa 15 phút
                lockTime = new Date(Date.now() + 15 * 60 * 1000);
                errorMsg = 'Bạn đã nhập sai quá 5 lần. Tài khoản bị tạm khóa 15 phút để bảo đảm an toàn.';
            }

            await pool.query(
                'UPDATE admin_users SET failed_attempts = $1, locked_until = $2 WHERE id = $3',
                [newFailed, lockTime, user.id]
            );

            await logAdminAction({
                adminId: user.id,
                username: user.username,
                action: 'ADMIN_LOGIN_FAILED',
                entityType: 'AUTH',
                details: { failedAttempts: newFailed, locked: !!lockTime },
                ip: clientIp
            });

            return res.status(401).json({
                success: false,
                error: errorMsg,
                attemptsRemaining: Math.max(0, 5 - newFailed)
            });
        }

        // Đăng nhập thành công -> Reset failed_attempts, cập nhật last_login
        await pool.query(
            'UPDATE admin_users SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE id = $1',
            [user.id]
        );

        // Tạo JWT Token có thời hạn 24 giờ
        const tokenPayload = {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            fullName: user.full_name
        };

        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

        const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || process.env.COOKIE_SECURE === 'true';

        // Đặt Cookie an toàn httpOnly
        res.cookie('admin_token', token, {
            httpOnly: true,
            secure: isHttps,
            sameSite: 'lax',
            maxAge: 24 * 60 * 60 * 1000 // 24 giờ
        });

        await logAdminAction({
            adminId: user.id,
            username: user.username,
            action: 'ADMIN_LOGIN_SUCCESS',
            entityType: 'AUTH',
            details: { role: user.role },
            ip: clientIp
        });

        return res.json({
            success: true,
            message: 'Đăng nhập thành công!',
            user: tokenPayload
        });
    } catch (err) {
        console.error('Login error:', err);
        return res.status(500).json({ success: false, error: 'Lỗi máy chủ nội bộ. Vui lòng thử lại.' });
    }
});

// Đăng xuất Admin
router.post('/logout', (req, res) => {
    const clientIp = req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1';

    // Ghi audit log nếu có token
    if (req.cookies && req.cookies.admin_token) {
        try {
            const { verifyAdminToken } = require('../middleware/auth');
            const decoded = verifyAdminToken(req.cookies.admin_token);
            if (decoded) {
                logAdminAction({
                    adminId: decoded.id,
                    username: decoded.username,
                    action: 'ADMIN_LOGOUT',
                    entityType: 'AUTH',
                    ip: clientIp
                });
            }
        } catch (e) {}
    }

    res.clearCookie('admin_token');
    return res.json({ success: true, message: 'Đã đăng xuất an toàn.' });
});

// Lấy thông tin tài khoản hiện tại
router.get('/me', requireAdminApi, async (req, res) => {
    try {
        const userRes = await pool.query(
            'SELECT id, username, email, full_name, role, last_login, created_at FROM admin_users WHERE id = $1',
            [req.admin.id]
        );
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy người dùng.' });
        }
        res.json({
            success: true,
            user: userRes.rows[0]
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Đổi mật khẩu Admin
router.put('/change-password', requireAdminApi, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const clientIp = req.headers['x-real-ip'] || req.socket.remoteAddress || '127.0.0.1';

    if (!currentPassword || !newPassword) {
        return res.status(400).json({
            success: false,
            error: 'Vui lòng điền mật khẩu hiện tại và mật khẩu mới.'
        });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({
            success: false,
            error: 'Mật khẩu mới phải có tối thiểu 6 ký tự.'
        });
    }

    try {
        const userRes = await pool.query('SELECT password_hash FROM admin_users WHERE id = $1', [req.admin.id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Người dùng không tồn tại.' });
        }

        const isMatch = await bcrypt.compare(currentPassword, userRes.rows[0].password_hash);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                error: 'Mật khẩu hiện tại không chính xác.'
            });
        }

        const salt = await bcrypt.genSalt(10);
        const newHash = await bcrypt.hash(newPassword, salt);

        await pool.query(
            'UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
            [newHash, req.admin.id]
        );

        await logAdminAction({
            adminId: req.admin.id,
            username: req.admin.username,
            action: 'ADMIN_PASSWORD_CHANGED',
            entityType: 'AUTH',
            ip: clientIp
        });

        res.json({
            success: true,
            message: 'Đổi mật khẩu thành công!'
        });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Danh sách tài khoản Admin (Chỉ superadmin)
router.get('/users', requireAdminApi, requireRoles(['superadmin']), async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, username, email, full_name, role, failed_attempts, last_login, created_at
            FROM admin_users
            ORDER BY id ASC
        `);
        res.json({ success: true, users: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');
const { loginLimiter, registerLimiter } = require('../middleware/customerRateLimit');

const router = express.Router();
const COOKIE_NAME = 'customer_token';
const TOKEN_AGE = 24 * 60 * 60 * 1000;

function getSecret() {
    const secret = process.env.CUSTOMER_JWT_SECRET;
    if (!secret || secret.length < 32) {
        throw new Error('CUSTOMER_JWT_SECRET must contain at least 32 characters');
    }
    return secret;
}

function cookieOptions(req) {
    return {
        httpOnly: true,
        secure: req.secure || process.env.COOKIE_SECURE === 'true',
        sameSite: 'lax',
        path: '/'
    };
}

function checkOrigin(req, res, next) {
    const origin = req.get('origin');
    // Host do Nginx ghi đè khi chuyển tiếp yêu cầu.
    const host = req.get('host');

    if (req.get('sec-fetch-site') === 'cross-site') {
        return res.status(403).json({
            success: false, error: 'Yêu cầu không hợp lệ.'
        });
    }

    if (origin) {
        try {
            if (new URL(origin).host !== host) {
                return res.status(403).json({
                    success: false, error: 'Origin không hợp lệ.'
                });
            }
        } catch {
            return res.status(403).json({
                success: false, error: 'Origin không hợp lệ.'
            });
        }
    }

    next();
}

router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

router.use((req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        return checkOrigin(req, res, next);
    }
    next();
});

function requireCustomer(req, res, next) {
    try {
        const token = req.cookies?.[COOKIE_NAME];
        if (!token) {
            return res.status(401).json({
                success: false, error: 'Vui lòng đăng nhập.'
            });
        }

        req.customer = jwt.verify(token, getSecret(), {
            audience: 'customer',
            issuer: 'event-management-customer',
            algorithms: ['HS256']
        });

        next();
    } catch {
        return res.status(401).json({
            success: false, error: 'Phiên đăng nhập không hợp lệ.'
        });
    }
}

// Đăng ký tài khoản
router.post('/register', registerLimiter, async (req, res) => {
    const { fullName, email, password } = req.body || {};

    if (typeof fullName !== 'string'
        || typeof email !== 'string'
        || typeof password !== 'string') {
        return res.status(400).json({
            success: false, error: 'Dữ liệu không hợp lệ.'
        });
    }

    const name = fullName.trim();
    const mail = email.trim().toLowerCase();

    if (name.length < 2 || name.length > 255
        || mail.length > 255
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)
        || password.length < 12 || password.length > 72) {
        return res.status(400).json({
            success: false,
            error: 'Họ tên từ 2 ký tự, email hợp lệ và mật khẩu từ 12 đến 72 ký tự.'
        });
    }

    try {
        const hash = await bcrypt.hash(password, 12);

        const result = await pool.query(
            `INSERT INTO customer_users (full_name, email, password_hash)
             VALUES ($1, $2, $3)
             RETURNING id, full_name, email, created_at`,
            [name, mail, hash]
        );

        return res.status(201).json({
            success: true,
            message: 'Đăng ký thành công.',
            user: result.rows[0]
        });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({
                success: false, error: 'Email đã được sử dụng.'
            });
        }

        console.error('Customer register error:', err.message);
        return res.status(500).json({
            success: false, error: 'Không thể đăng ký tài khoản.'
        });
    }
});

// Đăng nhập
router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};

    if (typeof email !== 'string' || typeof password !== 'string'
        || email.length > 255 || password.length > 1000) {
        return res.status(400).json({
            success: false, error: 'Dữ liệu không hợp lệ.'
        });
    }

    try {
        const result = await pool.query(
            'SELECT * FROM customer_users WHERE LOWER(email) = $1',
            [email.trim().toLowerCase()]
        );

        const user = result.rows[0];
        const error = 'Email hoặc mật khẩu không chính xác.';

        if (!user || !user.is_active) {
            return res.status(401).json({ success: false, error });
        }

        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            return res.status(429).json({
                success: false,
                error: 'Tài khoản bị khóa tạm thời. Vui lòng thử lại sau.'
            });
        }

        if (!(await bcrypt.compare(password, user.password_hash))) {
            await pool.query(
                `UPDATE customer_users
                 SET failed_attempts = failed_attempts + 1,
                     locked_until = CASE
                         WHEN failed_attempts + 1 >= 5
                         THEN NOW() + INTERVAL '15 minutes'
                         ELSE NULL
                     END
                 WHERE id = $1`,
                [user.id]
            );

            return res.status(401).json({ success: false, error });
        }

        await pool.query(
            `UPDATE customer_users
             SET failed_attempts = 0, locked_until = NULL
             WHERE id = $1`,
            [user.id]
        );

        const token = jwt.sign(
            { sub: String(user.id), type: 'customer' },
            getSecret(),
            {
                algorithm: 'HS256',
                expiresIn: '24h',
                audience: 'customer',
                issuer: 'event-management-customer'
            }
        );

        res.cookie(COOKIE_NAME, token, {
            ...cookieOptions(req),
            maxAge: TOKEN_AGE
        });

        return res.json({
            success: true,
            message: 'Đăng nhập thành công.',
            user: {
                id: user.id,
                fullName: user.full_name,
                email: user.email
            }
        });
    } catch (err) {
        console.error('Customer login error:', err.message);
        return res.status(500).json({
            success: false, error: 'Không thể đăng nhập.'
        });
    }
});

// Lấy thông tin tài khoản
router.get('/me', requireCustomer, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, full_name, email, created_at
             FROM customer_users
             WHERE id = $1 AND is_active = true`,
            [req.customer.sub]
        );

        if (!result.rows.length) {
            return res.status(401).json({
                success: false, error: 'Tài khoản không còn hoạt động.'
            });
        }

        return res.json({
            success: true, user: result.rows[0]
        });
    } catch (err) {
        console.error('Customer me error:', err.message);
        return res.status(500).json({
            success: false, error: 'Không thể tải thông tin.'
        });
    }
});

// Đăng xuất
router.post('/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, cookieOptions(req));
    return res.json({
        success: true, message: 'Đã đăng xuất.'
    });
});


// Danh sách vé thuộc tài khoản đã xác thực
router.get('/my-tickets', requireCustomer, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                t.id,
                t.ticket_code,
                t.status,
                t.checked_in_at,
                t.created_at,
                e.id AS event_id,
                e.name AS event_name,
                e.date AS event_date,
                e.event_time,
                e.location
             FROM tickets t
             JOIN attendees a ON a.id = t.attendee_id
             JOIN events e ON e.id = t.event_id
             JOIN customer_users c ON c.id = a.customer_user_id
             WHERE c.id = $1 AND c.is_active = TRUE
             ORDER BY t.created_at DESC, t.id DESC`,
            [req.customer.sub]
        );

        return res.json({
            success: true,
            data: result.rows
        });
    } catch (err) {
        console.error('Customer tickets error:', err.message);
        return res.status(500).json({
            success: false,
            error: 'Không thể tải danh sách vé.'
        });
    }
});

module.exports = router;

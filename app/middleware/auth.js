const jwt = require('jsonwebtoken');

// Đảm bảo khóa JWT_SECRET an toàn
let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('[SECURITY FATAL] JWT_SECRET bắt buộc phải được cấu hình trong môi trường production và có độ dài tối thiểu 32 ký tự.');
    }
    // Giá trị bảo mật mặc định trong môi trường phát triển nội bộ
    throw new Error('JWT_SECRET phải được cấu hình qua biến môi trường.');
} else if (JWT_SECRET.length < 32) {
    console.warn('[SECURITY WARNING] Khóa JWT_SECRET ngắn hơn 32 ký tự, nên nâng cấp độ dài để đảm bảo an toàn tối đa.');
}

const verifyAdminToken = (token) => {
    try {
        if (!token || typeof token !== 'string') return null;
        return jwt.verify(token, JWT_SECRET);
    } catch (err) {
        return null;
    }
};

// Middleware bảo vệ các API quản trị
const requireAdminApi = (req, res, next) => {
    let token = null;

    if (req.cookies && req.cookies.admin_token) {
        token = req.cookies.admin_token;
    } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            error: 'Bạn chưa đăng nhập hoặc phiên làm việc đã kết thúc. Vui lòng đăng nhập lại.',
            code: 'AUTH_REQUIRED'
        });
    }

    const decoded = verifyAdminToken(token);
    if (!decoded) {
        return res.status(401).json({
            success: false,
            error: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.',
            code: 'TOKEN_INVALID'
        });
    }

    req.admin = decoded;
    next();
};

// Middleware kiểm tra quyền theo vai trò (superadmin, admin, staff)
const requireRoles = (roles = ['superadmin', 'admin']) => {
    return (req, res, next) => {
        if (!req.admin) {
            return res.status(401).json({ success: false, error: 'Chưa xác thực quyền.' });
        }
        if (!roles.includes(req.admin.role)) {
            return res.status(403).json({
                success: false,
                error: 'Bạn không có quyền thực hiện thao tác này.'
            });
        }
        next();
    };
};

module.exports = {
    JWT_SECRET,
    verifyAdminToken,
    requireAdminApi,
    requireRoles
};

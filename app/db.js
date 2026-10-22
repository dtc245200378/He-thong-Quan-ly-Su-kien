const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    user: process.env.DB_USER || 'user',
    host: process.env.DB_HOST || 'postgres',
    database: process.env.DB_NAME || 'event_db',
    password: process.env.DB_PASSWORD || 'password',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle PostgreSQL client:', err);
});

// Chạy migration an toàn không làm mất 4 sự kiện cũ
const runMigrations = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Đảm bảo bảng events tồn tại và nâng cấp các cột bổ sung
        await client.query(`
            CREATE TABLE IF NOT EXISTS events (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                date DATE NOT NULL,
                total_tickets INT NOT NULL,
                tickets_sold INT DEFAULT 0
            );
        `);

        // Bổ sung các cột mới nếu chưa có
        await client.query(`
            ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT;
            ALTER TABLE events ADD COLUMN IF NOT EXISTS location VARCHAR(255) DEFAULT 'Trung tâm Sự kiện Quốc tế';
            ALTER TABLE events ADD COLUMN IF NOT EXISTS event_time VARCHAR(50) DEFAULT '08:30';
            ALTER TABLE events ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800';
            ALTER TABLE events ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'published';
            ALTER TABLE events ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE;
            ALTER TABLE events ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
            ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
        `);

        // Giữ nguyên dữ liệu sự kiện hiện có.

        // 2. Bảng quản trị viên (admin_users)
        await client.query(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                full_name VARCHAR(100) NOT NULL,
                role VARCHAR(50) DEFAULT 'superadmin',
                failed_attempts INT DEFAULT 0,
                locked_until TIMESTAMP WITH TIME ZONE,
                last_login TIMESTAMP WITH TIME ZONE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);

        // 3. Bảng người tham dự (attendees)
        await client.query(`
            CREATE TABLE IF NOT EXISTS attendees (
                id SERIAL PRIMARY KEY,
                event_id INT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
                full_name VARCHAR(255) NOT NULL,
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(50),
                organization VARCHAR(255),
                status VARCHAR(50) DEFAULT 'confirmed',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);

        // 4. Bảng vé điện tử (tickets)
        await client.query(`
            CREATE TABLE IF NOT EXISTS tickets (
                id SERIAL PRIMARY KEY,
                ticket_code VARCHAR(64) UNIQUE NOT NULL,
                event_id INT NOT NULL REFERENCES events(id) ON DELETE RESTRICT,
                attendee_id INT NOT NULL REFERENCES attendees(id) ON DELETE RESTRICT,
                status VARCHAR(50) DEFAULT 'valid',
                checked_in_at TIMESTAMP WITH TIME ZONE,
                checked_in_by VARCHAR(50),
                cancellation_reason TEXT,
                cancelled_at TIMESTAMP WITH TIME ZONE,
                cancelled_by VARCHAR(50),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);

        // 5. Bảng nhật ký thao tác quản trị (audit_logs)
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                admin_id INT,
                username VARCHAR(50),
                action VARCHAR(100) NOT NULL,
                entity_type VARCHAR(50),
                entity_id VARCHAR(50),
                details JSONB,
                ip_address VARCHAR(45),
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
        `);

        // 6. Bootstrap tài khoản Admin đầu tiên nếu bảng đang rỗng và được cấu hình
        const adminCheck = await client.query('SELECT COUNT(*) FROM admin_users');
        if (parseInt(adminCheck.rows[0].count, 10) === 0 && process.env.BOOTSTRAP_ADMIN === 'true') {
            const initUsername = process.env.ADMIN_INIT_USERNAME || 'admin';
            const initEmail = process.env.ADMIN_INIT_EMAIL || 'admin@eventmanagement.vn';
            const initPassword = process.env.ADMIN_INIT_PASSWORD;
            if (!initPassword || initPassword.length < 12) {
                throw new Error('ADMIN_INIT_PASSWORD phải có ít nhất 12 ký tự khi bật BOOTSTRAP_ADMIN.');
            }
            const initFullName = 'Quản Trị Viên';

            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash(initPassword, salt);

            await client.query(`
                INSERT INTO admin_users (username, email, password_hash, full_name, role)
                VALUES ($1, $2, $3, $4, 'superadmin')
            `, [initUsername, initEmail, passwordHash, initFullName]);

            console.log(`[BOOTSTRAP] Đã khởi tạo tài khoản Admin mặc định an toàn: ${initUsername}`);
        }

        await client.query('COMMIT');
        console.log('[MIGRATION] Cấu trúc CSDL đã được kiểm tra và đảm bảo toàn vẹn.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('[MIGRATION ERROR]', err);
        throw err;
    } finally {
        client.release();
    }
};

// Hàm ghi log thao tác Admin an toàn (không ghi mật khẩu, token)
const logAdminAction = async ({ adminId, username, action, entityType, entityId, details, ip }) => {
    try {
        const cleanDetails = { ...details };
        if (cleanDetails) {
            delete cleanDetails.password;
            delete cleanDetails.currentPassword;
            delete cleanDetails.newPassword;
            delete cleanDetails.token;
            delete cleanDetails.password_hash;
        }

        await pool.query(`
            INSERT INTO audit_logs (admin_id, username, action, entity_type, entity_id, details, ip_address)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            adminId || null,
            username || 'system',
            action,
            entityType || null,
            entityId ? String(entityId) : null,
            cleanDetails ? JSON.stringify(cleanDetails) : null,
            ip || '127.0.0.1'
        ]);
    } catch (err) {
        console.error('[AUDIT LOG ERROR]', err.message);
    }
};

module.exports = {
    pool,
    runMigrations,
    logAdminAction
};

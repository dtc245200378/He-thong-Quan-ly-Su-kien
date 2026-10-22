/**
 * Script bootstrap tài khoản Admin an toàn
 * Cách dùng:
 *   node scripts/bootstrap_admin.js [username] [password] [email] [fullName]
 * Hoặc qua biến môi trường:
 *   ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_EMAIL, ADMIN_FULLNAME
 */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    user: process.env.DB_USER || 'user',
    host: process.env.DB_HOST || 'postgres',
    database: process.env.DB_NAME || 'event_db',
    password: process.env.DB_PASSWORD || 'password',
    port: parseInt(process.env.DB_PORT || '5432', 10),
});

async function main() {
    const args = process.argv.slice(2);
    const username = args[0] || process.env.ADMIN_USERNAME || 'admin';
    const password = args[1] || process.env.ADMIN_PASSWORD;
    const email = args[2] || process.env.ADMIN_EMAIL || `${username}@eventmanagement.vn`;
    const fullName = args[3] || process.env.ADMIN_FULLNAME || 'Khoàng Tuấn Hùng';

    if (!password) {
        console.error('LỖI: Mật khẩu không được để trống!');
        console.error('Cú pháp: node scripts/bootstrap_admin.js <username> <password> [email] [fullName]');
        process.exit(1);
    }

    if (password.length < 6) {
        console.error('LỖI: Mật khẩu phải có ít nhất 6 ký tự!');
        process.exit(1);
    }

    const client = await pool.connect();
    try {
        console.log(`Bắt đầu khởi tạo/cập nhật tài khoản Admin [${username}]...`);

        // Đảm bảo bảng tồn tại
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

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        const checkRes = await client.query('SELECT id FROM admin_users WHERE username = $1', [username]);

        if (checkRes.rows.length > 0) {
            await client.query(`
                UPDATE admin_users
                SET password_hash = $1, email = $2, full_name = $3, failed_attempts = 0, locked_until = NULL, updated_at = NOW()
                WHERE username = $4
            `, [hash, email, fullName, username]);
            console.log(`[THÀNH CÔNG] Đã cập nhật mật khẩu và thông tin cho Admin [${username}]!`);
        } else {
            await client.query(`
                INSERT INTO admin_users (username, email, password_hash, full_name, role)
                VALUES ($1, $2, $3, $4, 'superadmin')
            `, [username, email, hash, fullName]);
            console.log(`[THÀNH CÔNG] Đã tạo mới tài khoản Admin [${username}] (${email})!`);
        }
    } catch (err) {
        console.error('[LỖI BOOTSTRAP]', err.message);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main();

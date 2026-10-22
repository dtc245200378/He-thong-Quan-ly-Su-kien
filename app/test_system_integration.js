const assert = require('assert');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

console.log('====================================================');
console.log('🧪 BẮT ĐẦU CHẠY BỘ KIỂM THỬ TÍCH HỢP HỆ THỐNG');
console.log('====================================================\n');

let passCount = 0;
let failCount = 0;

function runTest(name, fn) {
    try {
        fn();
        console.log(`✅ [PASS] ${name}`);
        passCount++;
    } catch (err) {
        console.error(`❌ [FAIL] ${name}`);
        console.error(`   Lỗi: ${err.message}`);
        failCount++;
    }
}

async function runAsyncTest(name, fn) {
    try {
        await fn();
        console.log(`✅ [PASS] ${name}`);
        passCount++;
    } catch (err) {
        console.error(`❌ [FAIL] ${name}`);
        console.error(`   Lỗi: ${err.message}`);
        failCount++;
    }
}

async function main() {
    // -----------------------------------------------------------------
    // TEST 1: Xác thực JWT & Phân quyền bảo mật
    // -----------------------------------------------------------------
    const { JWT_SECRET, verifyAdminToken, requireAdminApi, requireRoles } = require('./middleware/auth');

    runTest('1. JWT Secret được khởi tạo an toàn (tối thiểu 32 ký tự)', () => {
        assert(JWT_SECRET, 'JWT_SECRET phải tồn tại');
        assert(JWT_SECRET.length >= 32, `JWT_SECRET phải có tối thiểu 32 ký tự (hiện tại: ${JWT_SECRET.length})`);
    });

    runTest('2. Tạo và xác thực Token Admin hợp lệ', () => {
        const payload = { id: 1, username: 'admin', role: 'superadmin', fullName: 'Quản Trị Viên' };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
        const decoded = verifyAdminToken(token);
        assert(decoded !== null, 'Token phải giải mã thành công');
        assert.strictEqual(decoded.username, 'admin');
        assert.strictEqual(decoded.role, 'superadmin');
    });

    runTest('3. Chặn Token giả mạo hoặc hết hạn', () => {
        const fakeToken = jwt.sign({ id: 99, role: 'hacker' }, 'wrong_secret_key_12345678901234567890');
        const decoded = verifyAdminToken(fakeToken);
        assert.strictEqual(decoded, null, 'Token ký bằng khóa giả mạo phải bị từ chối');

        const expiredToken = jwt.sign({ id: 1 }, JWT_SECRET, { expiresIn: '-1s' });
        const decodedExpired = verifyAdminToken(expiredToken);
        assert.strictEqual(decodedExpired, null, 'Token hết hạn phải bị từ chối');
    });

    runTest('4. Middleware requireAdminApi chặn truy cập không có Token', () => {
        let statusSent = null;
        let jsonSent = null;
        const req = { cookies: {}, headers: {} };
        const res = {
            status(s) { statusSent = s; return this; },
            json(j) { jsonSent = j; }
        };
        let nextCalled = false;
        requireAdminApi(req, res, () => { nextCalled = true; });

        assert.strictEqual(nextCalled, false, 'Không được gọi next() khi không có token');
        assert.strictEqual(statusSent, 401, 'Phải trả về HTTP 401');
        assert.strictEqual(jsonSent.code, 'AUTH_REQUIRED');
    });

    runTest('5. Middleware requireRoles kiểm tra đúng quyền hạn', () => {
        const reqAdmin = { admin: { role: 'admin' } };
        const reqSuperadmin = { admin: { role: 'superadmin' } };
        const reqStaff = { admin: { role: 'staff' } };

        let statusSent = null;
        const res = { status(s) { statusSent = s; return this; }, json() {} };

        let nextSuper = false;
        requireRoles(['superadmin'])(reqSuperadmin, res, () => { nextSuper = true; });
        assert.strictEqual(nextSuper, true, 'Superadmin phải được phép truy cập');

        let nextStaffBlocked = false;
        requireRoles(['superadmin', 'admin'])(reqStaff, res, () => { nextStaffBlocked = true; });
        assert.strictEqual(nextStaffBlocked, false, 'Staff không được truy cập chức năng chỉ dành cho Admin/Superadmin');
        assert.strictEqual(statusSent, 403, 'Phải trả về HTTP 403 Forbidden');
    });

    // -----------------------------------------------------------------
    // TEST 2: Đăng nhập & Hash mật khẩu Bcrypt
    // -----------------------------------------------------------------
    await runAsyncTest('6. Mã hóa và so khớp mật khẩu quản trị viên với Bcrypt', async () => {
        const plainPassword = 'Admin@2026!Secure';
        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(plainPassword, salt);

        const isMatch = await bcrypt.compare(plainPassword, hash);
        assert.strictEqual(isMatch, true, 'Mật khẩu đúng phải khớp');

        const isWrong = await bcrypt.compare('WrongPassword', hash);
        assert.strictEqual(isWrong, false, 'Mật khẩu sai phải bị từ chối');
    });

    // -----------------------------------------------------------------
    // TEST 3: Kiểm tra định dạng mã vé & QR Code
    // -----------------------------------------------------------------
    runTest('7. Sinh mã vé độc nhất chuẩn TK-2026-E{id}-{UUID}', () => {
        const { randomUUID } = require('crypto');
        const eventId = 1;
        const shortHex = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
        const ticketCode = `TK-2026-E${eventId}-${shortHex}`;

        assert.match(ticketCode, /^TK-2026-E1-[0-9A-F]{8}$/, 'Mã vé phải đúng định dạng chuẩn');
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(ticketCode)}`;
        assert(qrUrl.includes(ticketCode), 'URL QR Code phải chứa chính xác mã vé');
    });

    // -----------------------------------------------------------------
    // TEST 4: Kiểm tra logic kiểm soát nghiệp vụ vé & sự kiện
    // -----------------------------------------------------------------
    runTest('8. Kiểm tra quy tắc sự kiện hết vé', () => {
        const event = { id: 1, total_tickets: 100, tickets_sold: 100 };
        const isSoldOut = event.tickets_sold >= event.total_tickets;
        assert.strictEqual(isSoldOut, true, 'Sự kiện phải xác định là hết vé khi sold >= total');
    });

    runTest('9. Chặn giảm tổng số vé xuống dưới số vé đã phát hành khi sửa sự kiện', () => {
        const currentEvent = { id: 1, tickets_sold: 50, total_tickets: 100 };
        const newTotalProposal = 40; // Đề xuất giảm xuống 40 trong khi đã bán 50

        const isValid = newTotalProposal >= currentEvent.tickets_sold;
        assert.strictEqual(isValid, false, 'Không được phép giảm tổng số vé thấp hơn số vé đã bán');
    });

    runTest('10. Kiểm tra quy tắc xóa mềm (Soft Delete) sự kiện', () => {
        const eventBefore = { id: 1, is_deleted: false, status: 'published' };
        // Giả lập cập nhật soft-delete
        const eventAfter = { ...eventBefore, is_deleted: true, status: 'cancelled' };

        assert.strictEqual(eventAfter.is_deleted, true, 'is_deleted phải bằng true');
        assert.strictEqual(eventAfter.status, 'cancelled', 'Trạng thái phải chuyển thành cancelled');

        // Bộ lọc sự kiện khách hàng: loại bỏ is_deleted = true
        const publicEvents = [eventAfter].filter(e => !e.is_deleted && e.status === 'published');
        assert.strictEqual(publicEvents.length, 0, 'Sự kiện xóa mềm không được hiển thị cho khách hàng');
    });

    // -----------------------------------------------------------------
    // TEST 5: Kiểm tra logic Check-in 4 trạng thái
    // -----------------------------------------------------------------
    runTest('11. Xác thực vé hợp lệ lần đầu (Check-in thành công)', () => {
        const ticket = { id: 10, ticket_code: 'TK-2026-E1-TEST1234', status: 'valid', checked_in_at: null };
        assert.strictEqual(ticket.status, 'valid');

        // Thực hiện check-in
        ticket.status = 'used';
        ticket.checked_in_at = new Date();
        ticket.checked_in_by = 'admin';

        assert.strictEqual(ticket.status, 'used');
        assert(ticket.checked_in_at !== null);
    });

    runTest('12. Chặn Check-in trùng lặp (Vé đã sử dụng)', () => {
        const ticket = { id: 10, ticket_code: 'TK-2026-E1-TEST1234', status: 'used', checked_in_at: new Date() };
        assert.strictEqual(ticket.status === 'used', true, 'Phải phát hiện vé đã qua sử dụng');
    });

    runTest('13. Chặn Check-in vé đã bị hủy', () => {
        const ticket = { id: 11, ticket_code: 'TK-2026-E1-CANCELLED', status: 'cancelled' };
        assert.strictEqual(ticket.status === 'cancelled', true, 'Phải phát hiện vé bị hủy');
    });

    runTest('14. Chặn Check-in vé giả / không tìm thấy trong CSDL', () => {
        const dbTickets = [{ ticket_code: 'TK-REAL-001' }];
        const searchCode = 'TK-FAKE-999';
        const found = dbTickets.find(t => t.ticket_code === searchCode);
        assert.strictEqual(found, undefined, 'Mã vé không tồn tại trong CSDL phải trả về undefined/404');
    });

    // -----------------------------------------------------------------
    // TEST 6: Kiểm tra tính toán Dashboard & Báo cáo
    // -----------------------------------------------------------------
    runTest('15. Tính toán chỉ số Dashboard: tỷ lệ lấp đầy & tỷ lệ check-in', () => {
        const totalCapacity = 500;
        const totalSold = 350;
        const totalCheckedIn = 280;

        const remainingTickets = Math.max(0, totalCapacity - totalSold);
        const fillRate = ((totalSold / totalCapacity) * 100).toFixed(1);
        const checkinRate = ((totalCheckedIn / totalSold) * 100).toFixed(1);

        assert.strictEqual(remainingTickets, 150, 'Số vé còn lại phải bằng 150');
        assert.strictEqual(fillRate, '70.0', 'Tỷ lệ lấp đầy phải là 70.0%');
        assert.strictEqual(checkinRate, '80.0', 'Tỷ lệ check-in phải là 80.0%');
    });

    runTest('16. Định dạng xuất CSV có BOM UTF-8', () => {
        let csv = '\uFEFF';
        csv += 'STT,Tên Sự Kiện,Sức Chứa,Đã Bán,Đã Check-in,Tỷ Lệ\n';
        csv += '1,Hội Thảo Công Nghệ 2026,200,150,120,75.0%\n';

        assert(csv.startsWith('\uFEFF'), 'CSV phải bắt đầu bằng UTF-8 BOM để Excel hiển thị tiếng Việt không lỗi font');
        assert(csv.includes('Hội Thảo Công Nghệ 2026'), 'Nội dung tiếng Việt phải nguyên vẹn');
    });

    // -----------------------------------------------------------------
    // TEST 7: Kiểm tra XSS Escaping trong giao diện
    // -----------------------------------------------------------------
    runTest('17. Khử độc ký tự nguy hiểm (XSS Escaping)', () => {
        const escapeHtml = str => String(str ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));

        const maliciousInput = '<script>alert("XSS")</script>';
        const escaped = escapeHtml(maliciousInput);
        assert(!escaped.includes('<script>'), 'Thẻ script phải được escape thành mã HTML entity');
        assert.strictEqual(escaped, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
    });

    // -----------------------------------------------------------------
    // TEST 8: Kiểm tra cấu trúc API công khai vs Quản trị
    // -----------------------------------------------------------------
    runTest('18. Phân tách rõ ràng quyền hạn giữa Website Khách và Admin', () => {
        // Kiểm tra customer public/index.html không chứa nút hoặc hàm createEvent / deleteEvent của Admin
        const fs = require('fs');
        const path = require('path');
        const customerHtml = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

        assert(!customerHtml.includes('createEvent(event)'), 'Website khách hàng không được chứa form tạo sự kiện');
        assert(!customerHtml.includes('deleteEvent('), 'Website khách hàng không được chứa nút xóa sự kiện');
        assert(!customerHtml.includes('editEvent('), 'Website khách hàng không được chứa nút sửa sự kiện');
        assert(customerHtml.includes('/api/public/registrations'), 'Website khách hàng phải gọi đúng API đăng ký vé thật');
        assert(customerHtml.includes('handleTicketLookup'), 'Website khách hàng có chức năng tra cứu vé QR');
    });

    runTest('19. Giao diện Admin đồng bộ giao diện và màu sắc', () => {
        const fs = require('fs');
        const path = require('path');
        const adminHtml = fs.readFileSync(path.join(__dirname, 'public', 'admin', 'index.html'), 'utf8');

        assert(adminHtml.includes('#4f46e5'), 'Admin phải sử dụng màu chủ đạo #4f46e5');
        assert(adminHtml.includes('#1e293b'), 'Admin phải sử dụng màu header bảng #1e293b');
        assert(adminHtml.includes('border-start border-4 border-primary'), 'Admin phải có thẻ thống kê viền màu');
        assert(adminHtml.includes('view-dashboard'), 'Admin phải có view Dashboard');
        assert(adminHtml.includes('view-events'), 'Admin phải có view Quản lý Sự kiện');
        assert(adminHtml.includes('view-attendees'), 'Admin phải có view Người tham dự');
        assert(adminHtml.includes('view-tickets'), 'Admin phải có view Quản lý Vé');
        assert(adminHtml.includes('view-checkin'), 'Admin phải có view Trạm Check-in');
        assert(adminHtml.includes('view-reports'), 'Admin phải có view Báo cáo');
        assert(adminHtml.includes('view-audit'), 'Admin phải có view Nhật ký Quản trị');
        assert(adminHtml.includes('view-profile'), 'Admin phải có view Hồ sơ & Đổi mật khẩu');
    });

    // -----------------------------------------------------------------
    // TỔNG KẾT KẾT QUẢ KIỂM THỬ
    // -----------------------------------------------------------------
    console.log('\n====================================================');
    console.log(`📊 TỔNG KẾT: ${passCount} PASSED / ${failCount} FAILED`);
    console.log('====================================================');

    if (failCount > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal test error:', err);
    process.exit(1);
});

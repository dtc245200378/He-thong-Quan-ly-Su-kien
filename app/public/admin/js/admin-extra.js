// Admin Extended Modules: Attendees, Tickets, Check-in, Reports, Audit Logs, Profile
// Tích hợp API thật 100%, bảo đảm tính toàn vẹn dữ liệu và an toàn XSS

const adminEscape = window.adminEscape || (value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[c])));

window.adminEscape = adminEscape;

async function adminFetch(url, options = {}) {
    const defaultHeaders = {
        'Accept': 'application/json'
    };
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        defaultHeaders['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
    }
    options.headers = { ...defaultHeaders, ...options.headers };
    options.credentials = 'same-origin';

    const res = await fetch(url, options);
    if (res.status === 401) {
        window.location.href = '/admin/login';
        throw new Error('Phiên đăng nhập đã hết hạn. Đang chuyển hướng...');
    }

    const payload = await res.json().catch(() => ({}));
    if (!res.ok || payload.success === false) {
        throw new Error(payload.error || `Yêu cầu thất bại với mã lỗi HTTP ${res.status}`);
    }
    return payload;
}

// ==========================================
// 1. QUẢN LÝ NGƯỜI THAM DỰ (ATTENDEES)
// ==========================================
window.AdminAttendees = {
    eventIdFilter: '',
    searchDebounce: null,

    async loadAttendees() {
        const tbody = document.getElementById('attendees-table-body');
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Đang tải danh sách người tham dự...</td></tr>`;

        try {
            const searchInput = document.getElementById('attendees-search-input');
            const searchVal = searchInput ? searchInput.value.trim() : '';

            const params = new URLSearchParams({ page: '1', limit: '100' });
            if (searchVal) params.set('search', searchVal);
            if (this.eventIdFilter) params.set('eventId', this.eventIdFilter);

            const res = await adminFetch('/api/admin/attendees?' + params.toString());
            const list = res.data || [];

            if (list.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><i class="fa-solid fa-users-slash me-2"></i>Không tìm thấy người tham dự nào phù hợp.</td></tr>`;
                return;
            }

            tbody.innerHTML = list.map(item => {
                const statusBadge = item.status === 'confirmed'
                    ? '<span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1 rounded-pill">Đã xác nhận</span>'
                    : '<span class="badge bg-secondary-subtle text-secondary px-2 py-1 rounded-pill">Đã hủy</span>';

                const ticketBadge = item.ticket_code
                    ? `<code class="fw-bold text-primary">${adminEscape(item.ticket_code)}</code>`
                    : '<span class="text-muted small">Chưa cấp</span>';

                return `
                    <tr>
                        <td class="ps-3 fw-bold text-dark">${adminEscape(item.full_name)}</td>
                        <td>
                            <div><i class="fa-regular fa-envelope me-1 text-muted small"></i>${adminEscape(item.email)}</div>
                            ${item.phone ? `<div class="text-muted small"><i class="fa-solid fa-phone me-1 small"></i>${adminEscape(item.phone)}</div>` : ''}
                        </td>
                        <td>
                            <div class="fw-semibold text-dark">${adminEscape(item.event_name)}</div>
                            <div class="text-muted small">${new Date(item.event_date).toLocaleDateString('vi-VN')}</div>
                        </td>
                        <td>${ticketBadge}</td>
                        <td>${statusBadge}</td>
                        <td class="text-end pe-3">
                            ${item.status === 'confirmed' ? `
                                <button class="btn btn-sm btn-outline-danger rounded-2" onclick="AdminAttendees.confirmCancel(${item.id}, '${adminEscape(item.full_name)}')">
                                    <i class="fa-solid fa-ban me-1"></i>Hủy đăng ký
                                </button>
                            ` : '<span class="text-muted small">Không khả dụng</span>'}
                        </td>
                    </tr>
                `;
            }).join('');

            // Tải danh sách sự kiện vào bộ lọc dropdown nếu dropdown còn rỗng
            const eventSelect = document.getElementById('attendees-event-filter');
            if (eventSelect && eventSelect.options.length <= 1) {
                const evRes = await adminFetch('/api/admin/events?limit=100');
                const events = evRes.data || [];
                eventSelect.innerHTML = '<option value="">🔍 Tất cả sự kiện</option>';
                events.forEach(ev => {
                    const opt = document.createElement('option');
                    opt.value = ev.id;
                    opt.textContent = ev.name;
                    eventSelect.appendChild(opt);
                });
                if (this.eventIdFilter) eventSelect.value = this.eventIdFilter;
            }

        } catch (err) {
            console.error('Load attendees error:', err);
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger"><i class="fa-solid fa-circle-exclamation me-2"></i>Lỗi tải dữ liệu: ${adminEscape(err.message)}</td></tr>`;
            AdminApp.showToast(err.message, 'error');
        }
    },

    async confirmCancel(attendeeId, attendeeName) {
        const reason = prompt(`Xác nhận hủy đăng ký của "${attendeeName}"?\nVui lòng nhập lý do hủy:`, 'Khách yêu cầu hủy');
        if (reason === null) return;
        if (!reason.trim()) {
            AdminApp.showToast('Vui lòng nhập lý do hủy đăng ký.', 'warning');
            return;
        }

        try {
            await adminFetch(`/api/admin/attendees/${attendeeId}/cancel`, {
                method: 'POST',
                body: { reason: reason.trim() }
            });
            AdminApp.showToast(`Đã hủy đăng ký của ${attendeeName} thành công.`, 'success');
            this.loadAttendees();
        } catch (err) {
            AdminApp.showToast(err.message, 'error');
        }
    }
};

// ==========================================
// 2. QUẢN LÝ VÉ ĐIỆN TỬ (TICKETS)
// ==========================================
window.AdminTickets = {
    async loadTickets() {
        const tbody = document.getElementById('tickets-table-body');
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Đang tải danh sách vé...</td></tr>`;

        try {
            const searchInput = document.getElementById('tickets-search-input');
            const searchVal = searchInput ? searchInput.value.trim() : '';

            const params = new URLSearchParams({ limit: '100' });
            if (searchVal) params.set('search', searchVal);

            const res = await adminFetch('/api/admin/tickets?' + params.toString());
            const list = res.data || [];

            if (list.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-muted"><i class="fa-solid fa-ticket-simple me-2"></i>Không tìm thấy vé nào phù hợp.</td></tr>`;
                return;
            }

            tbody.innerHTML = list.map(item => {
                let statusBadge = '<span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1 rounded-pill">Hợp lệ (Chưa Check-in)</span>';
                if (item.status === 'used') {
                    statusBadge = '<span class="badge bg-info-subtle text-info border border-info-subtle px-2 py-1 rounded-pill"><i class="fa-solid fa-check-double me-1"></i>Đã Check-in</span>';
                } else if (item.status === 'cancelled') {
                    statusBadge = '<span class="badge bg-danger-subtle text-danger border border-danger-subtle px-2 py-1 rounded-pill"><i class="fa-solid fa-ban me-1"></i>Đã Hủy</span>';
                }

                return `
                    <tr>
                        <td class="ps-3">
                            <span class="badge bg-light text-dark border font-monospace px-2 py-1 fs-6">${adminEscape(item.ticket_code)}</span>
                        </td>
                        <td>
                            <div class="fw-bold text-dark">${adminEscape(item.attendee_name || 'Khách Vãng Lai')}</div>
                            <div class="text-muted small">${adminEscape(item.attendee_email || '')}</div>
                        </td>
                        <td>
                            <div class="fw-semibold text-dark">${adminEscape(item.event_name)}</div>
                        </td>
                        <td>${statusBadge}</td>
                        <td class="small text-muted">
                            ${item.checked_in_at ? new Date(item.checked_in_at).toLocaleString('vi-VN') : '—'}
                        </td>
                        <td class="text-end pe-3">
                            ${item.status === 'valid' ? `
                                <button class="btn btn-sm btn-outline-danger rounded-2" onclick="AdminTickets.confirmCancelTicket('${adminEscape(item.ticket_code)}')">
                                    <i class="fa-solid fa-xmark me-1"></i>Hủy vé
                                </button>
                            ` : '<span class="text-muted small">—</span>'}
                        </td>
                    </tr>
                `;
            }).join('');

        } catch (err) {
            console.error('Load tickets error:', err);
            tbody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-danger"><i class="fa-solid fa-circle-exclamation me-2"></i>Lỗi tải vé: ${adminEscape(err.message)}</td></tr>`;
            AdminApp.showToast(err.message, 'error');
        }
    },

    async confirmCancelTicket(ticketCode) {
        const reason = prompt(`Xác nhận hủy vé "${ticketCode}"?\nVui lòng nhập lý do hủy vé:`, 'Khách không tham dự');
        if (reason === null) return;
        if (!reason.trim()) {
            AdminApp.showToast('Vui lòng nhập lý do hủy vé.', 'warning');
            return;
        }

        try {
            await adminFetch(`/api/admin/tickets/${encodeURIComponent(ticketCode)}/cancel`, {
                method: 'POST',
                body: { reason: reason.trim() }
            });
            AdminApp.showToast(`Đã hủy vé ${ticketCode} thành công.`, 'success');
            this.loadTickets();
        } catch (err) {
            AdminApp.showToast(err.message, 'error');
        }
    }
};

// ==========================================
// 3. TRẠM CHECK-IN SOÁT VÉ (CHECK-IN)
// ==========================================
window.AdminCheckin = {
    initStation() {
        const input = document.getElementById('checkin-code');
        if (input) {
            input.value = '';
            input.focus();
        }
    },

    async handleCheckin(e) {
        if (e) e.preventDefault();
        const input = document.getElementById('checkin-code');
        const resultContainer = document.getElementById('checkin-result');
        if (!input || !resultContainer) return;

        const ticketCode = input.value.trim();
        if (!ticketCode) {
            resultContainer.innerHTML = `<div class="alert alert-warning border-0 rounded-3 shadow-sm py-2"><i class="fa-solid fa-triangle-exclamation me-2"></i>Vui lòng nhập hoặc quét mã vé.</div>`;
            return;
        }

        resultContainer.innerHTML = `<div class="text-center py-2 text-muted"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Đang xác thực vé trên CSDL...</div>`;

        try {
            const res = await adminFetch('/api/admin/checkin', {
                method: 'POST',
                body: { ticketCode }
            });

            // Check-in thành công
            resultContainer.innerHTML = `
                <div class="alert alert-success border-0 rounded-4 shadow-sm p-4 text-start">
                    <div class="d-flex align-items-center mb-3">
                        <i class="fa-solid fa-circle-check text-success display-5 me-3"></i>
                        <div>
                            <h4 class="alert-heading fw-bold text-success mb-1">CHECK-IN THÀNH CÔNG!</h4>
                            <p class="mb-0 text-muted small">Thời gian xác thực: ${new Date().toLocaleTimeString('vi-VN')} | Người duyệt: Quản trị viên</p>
                        </div>
                    </div>
                    <hr class="opacity-25">
                    <div class="row g-2">
                        <div class="col-sm-6"><b>Mã vé:</b> <code class="fs-6 text-primary">${adminEscape(res.ticket ? res.ticket.ticket_code : ticketCode)}</code></div>
                        <div class="col-sm-6"><b>Người tham dự:</b> <span class="fw-semibold">${adminEscape(res.ticket ? res.ticket.attendee_name : 'Khách mời')}</span></div>
                        <div class="col-sm-6"><b>Sự kiện:</b> <span>${adminEscape(res.ticket ? res.ticket.event_name : 'Sự kiện hệ thống')}</span></div>
                        <div class="col-sm-6"><b>Email:</b> <span>${adminEscape(res.ticket ? res.ticket.attendee_email : '—')}</span></div>
                    </div>
                </div>
            `;
            AdminApp.showToast('Check-in vé thành công!', 'success');
            input.value = '';
            input.focus();

        } catch (err) {
            console.error('Checkin failed:', err);
            resultContainer.innerHTML = `
                <div class="alert alert-danger border-0 rounded-4 shadow-sm p-4 text-start">
                    <div class="d-flex align-items-center">
                        <i class="fa-solid fa-circle-xmark text-danger display-5 me-3"></i>
                        <div>
                            <h4 class="alert-heading fw-bold text-danger mb-1">TỪ CHỐI CHECK-IN!</h4>
                            <p class="mb-0 fw-semibold">${adminEscape(err.message)}</p>
                        </div>
                    </div>
                </div>
            `;
            AdminApp.showToast(err.message, 'error');
            input.select();
        }
    }
};

// ==========================================
// 4. BÁO CÁO & THỐNG KÊ (REPORTS)
// ==========================================
window.AdminReports = {
    async loadReports() {
        const tbody = document.getElementById('reports-table-body');
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Đang tổng hợp báo cáo...</td></tr>`;

        try {
            const res = await adminFetch('/api/admin/reports/events');
            const list = res.data || [];

            if (list.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted"><i class="fa-solid fa-chart-pie me-2"></i>Chưa có dữ liệu sự kiện để lập báo cáo.</td></tr>`;
                return;
            }

            tbody.innerHTML = list.map(item => {
                const fillRate = item.fillRate || 0;
                const attendRate = item.attendanceRate || 0;

                return `
                    <tr>
                        <td class="ps-3 fw-bold text-dark">${adminEscape(item.name)}</td>
                        <td>${new Date(item.date).toLocaleDateString('vi-VN')}</td>
                        <td><span class="badge bg-light text-dark border px-2 py-1">${item.totalTickets}</span></td>
                        <td><b class="text-primary">${item.ticketsSold}</b> vé</td>
                        <td><b class="text-success">${item.checkedInCount}</b> lượt</td>
                        <td>
                            <div class="d-flex align-items-center gap-2">
                                <div class="progress flex-grow-1" style="height: 6px;">
                                    <div class="progress-bar bg-primary" style="width: ${Math.min(100, fillRate)}%"></div>
                                </div>
                                <span class="small fw-semibold text-muted">${fillRate}%</span>
                            </div>
                        </td>
                        <td class="text-end pe-3">
                            <span class="badge ${attendRate >= 80 ? 'bg-success' : attendRate >= 50 ? 'bg-warning text-dark' : 'bg-secondary'} px-2 py-1 rounded-pill">
                                ${attendRate}%
                            </span>
                        </td>
                    </tr>
                `;
            }).join('');

        } catch (err) {
            console.error('Load reports error:', err);
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-danger"><i class="fa-solid fa-circle-exclamation me-2"></i>Lỗi tải báo cáo: ${adminEscape(err.message)}</td></tr>`;
            AdminApp.showToast(err.message, 'error');
        }
    }
};

// ==========================================
// 5. NHẬT KÝ QUẢN TRỊ (AUDIT LOGS)
// ==========================================
window.AdminAudit = {
    async loadLogs() {
        const tbody = document.getElementById('audit-table-body');
        if (!tbody) return;
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted"><div class="spinner-border spinner-border-sm text-primary me-2"></div>Đang tải nhật ký bảo mật...</td></tr>`;

        try {
            const res = await adminFetch('/api/admin/audit-logs?limit=100');
            const list = res.data || [];

            if (list.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted"><i class="fa-solid fa-shield-halved me-2"></i>Chưa có nhật ký ghi nhận.</td></tr>`;
                return;
            }

            tbody.innerHTML = list.map(item => {
                let actionBadge = `<span class="badge bg-light text-dark border">${adminEscape(item.action)}</span>`;
                if (item.action.includes('SUCCESS') || item.action.includes('CREATED')) {
                    actionBadge = `<span class="badge bg-success-subtle text-success border border-success-subtle">${adminEscape(item.action)}</span>`;
                } else if (item.action.includes('FAILED') || item.action.includes('DELETED') || item.action.includes('CANCEL')) {
                    actionBadge = `<span class="badge bg-danger-subtle text-danger border border-danger-subtle">${adminEscape(item.action)}</span>`;
                } else if (item.action.includes('UPDATE')) {
                    actionBadge = `<span class="badge bg-warning-subtle text-warning border border-warning-subtle">${adminEscape(item.action)}</span>`;
                }

                return `
                    <tr>
                        <td class="ps-3 text-muted small">${new Date(item.created_at).toLocaleString('vi-VN')}</td>
                        <td><span class="fw-bold text-dark">${adminEscape(item.username || 'system')}</span></td>
                        <td>${actionBadge}</td>
                        <td><span class="text-muted small">${adminEscape(item.entity_type || '—')}</span></td>
                        <td class="pe-3 font-monospace small text-muted">${adminEscape(item.ip_address || '—')}</td>
                    </tr>
                `;
            }).join('');

        } catch (err) {
            console.error('Load audit error:', err);
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-danger"><i class="fa-solid fa-circle-exclamation me-2"></i>Lỗi tải nhật ký: ${adminEscape(err.message)}</td></tr>`;
            AdminApp.showToast(err.message, 'error');
        }
    }
};

// ==========================================
// 6. HỒ SƠ & BẢO MẬT (PROFILE)
// ==========================================
window.AdminProfile = {
    loadProfile() {
        if (AdminApp.currentUser) {
            AdminApp.renderUserInfo();
        }
    },

    async handleChangePassword(e) {
        if (e) e.preventDefault();
        const curPass = document.getElementById('current-pass').value;
        const newPass = document.getElementById('new-pass').value;
        const confirmPass = document.getElementById('confirm-pass')?.value;

        if (!curPass || !newPass) {
            AdminApp.showToast('Vui lòng nhập đầy đủ thông tin mật khẩu.', 'warning');
            return;
        }

        if (newPass.length < 8) {
            AdminApp.showToast('Mật khẩu mới phải có tối thiểu 8 ký tự.', 'warning');
            return;
        }

        if (confirmPass && newPass !== confirmPass) {
            AdminApp.showToast('Mật khẩu xác nhận không trùng khớp.', 'warning');
            return;
        }

        try {
            await adminFetch('/api/admin/auth/change-password', {
                method: 'PUT',
                body: { currentPassword: curPass, newPassword: newPass }
            });

            AdminApp.showToast('Đổi mật khẩu thành công! Vui lòng sử dụng mật khẩu mới cho lần đăng nhập tới.', 'success');
            document.getElementById('password-form')?.reset();

        } catch (err) {
            AdminApp.showToast(err.message, 'error');
        }
    }
};

// Lắng nghe sự kiện DOM
document.addEventListener('DOMContentLoaded', () => {
    // Tìm kiếm Người tham dự (Debounce)
    const attSearch = document.getElementById('attendees-search-input');
    if (attSearch) {
        attSearch.addEventListener('input', () => {
            clearTimeout(AdminAttendees.searchDebounce);
            AdminAttendees.searchDebounce = setTimeout(() => AdminAttendees.loadAttendees(), 300);
        });
    }

    const attFilter = document.getElementById('attendees-event-filter');
    if (attFilter) {
        attFilter.addEventListener('change', (e) => {
            AdminAttendees.eventIdFilter = e.target.value;
            AdminAttendees.loadAttendees();
        });
    }

    // Tìm kiếm vé
    const ticketSearch = document.getElementById('tickets-search-input');
    if (ticketSearch) {
        ticketSearch.addEventListener('input', () => {
            clearTimeout(AdminTickets.searchDebounce);
            AdminTickets.searchDebounce = setTimeout(() => AdminTickets.loadTickets(), 300);
        });
    }

    // Form Check-in
    const checkinForm = document.getElementById('checkin-form');
    if (checkinForm) {
        checkinForm.addEventListener('submit', (e) => AdminCheckin.handleCheckin(e));
    }

    // Form đổi mật khẩu
    const passForm = document.getElementById('password-form');
    if (passForm) {
        passForm.addEventListener('submit', (e) => AdminProfile.handleChangePassword(e));
    }
});

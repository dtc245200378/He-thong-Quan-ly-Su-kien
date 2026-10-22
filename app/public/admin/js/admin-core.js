// Admin Core System: Router, State, API Client, Audio Synthesizer, Toast
window.AdminApp = {
    currentUser: null,
    activeTab: 'dashboard',

    async init() {
        // Kiểm tra thông tin người dùng hiện tại
        try {
            const res = await fetch('/api/admin/auth/me');
            if (res.status === 401) {
                window.location.href = '/admin/login';
                return;
            }
            const data = await res.json();
            if (data.success && data.user) {
                this.currentUser = data.user;
                this.renderUserInfo();
            } else {
                window.location.href = '/admin/login';
                return;
            }
        } catch (err) {
            console.error('Auth check error:', err);
            window.location.href = '/admin/login';
            return;
        }

        // Khởi tạo điều hướng theo hash hoặc mặc định dashboard
        const initialTab = window.location.hash ? window.location.hash.substring(1) : 'dashboard';
        this.switchTab(initialTab);

        window.addEventListener('hashchange', () => {
            const tab = window.location.hash ? window.location.hash.substring(1) : 'dashboard';
            this.switchTab(tab, false);
        });
    },

    renderUserInfo() {
        if (!this.currentUser) return;
        const nameElems = document.querySelectorAll('.admin-full-name');
        nameElems.forEach(el => el.innerText = this.currentUser.full_name || this.currentUser.username);

        const emailElems = document.querySelectorAll('.admin-email');
        emailElems.forEach(el => el.innerText = this.currentUser.email || '');

        const roleElems = document.querySelectorAll('.admin-role-badge');
        roleElems.forEach(el => {
            el.innerText = (this.currentUser.role || 'ADMIN').toUpperCase();
        });

        const avatarElems = document.querySelectorAll('.user-avatar-initials');
        const initials = (this.currentUser.full_name || this.currentUser.username || 'A')
            .split(' ')
            .map(n => n[0])
            .join('')
            .substring(0, 2)
            .toUpperCase();
        avatarElems.forEach(el => el.innerText = initials);
    },

    switchTab(tabName, updateHash = true) {
        const allowedTabs = ['dashboard', 'events', 'attendees', 'tickets', 'checkin', 'reports', 'audit', 'profile'];
        if (!allowedTabs.includes(tabName)) {
            tabName = 'dashboard';
        }

        this.activeTab = tabName;
        if (updateHash) {
            window.location.hash = tabName;
        }

        // Cập nhật giao diện menu sidebar
        document.querySelectorAll('.nav-item-btn').forEach(btn => {
            if (btn.dataset.tab === tabName) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Cập nhật tiêu đề trang
        const titleMap = {
            dashboard: 'Tổng Quan Hệ Thống',
            events: 'Quản Lý Sự Kiện',
            attendees: 'Quản Lý Người Tham Dự',
            tickets: 'Quản Lý Vé Điện Tử',
            checkin: 'Trạm Check-in Soát Vé',
            reports: 'Báo Cáo & Thống Kê',
            audit: 'Nhật Ký Quản Trị (Audit Log)',
            profile: 'Hồ Sơ & Bảo Mật Tài Khoản'
        };
        const titleElem = document.getElementById('current-page-title');
        if (titleElem) {
            titleElem.innerText = titleMap[tabName] || 'Quản Trị';
        }

        // Hiển thị nội dung view tương ứng
        document.querySelectorAll('.admin-tab-view').forEach(view => {
            if (view.id === `view-${tabName}`) {
                view.classList.remove('d-none');
            } else {
                view.classList.add('d-none');
            }
        });

        // Đóng sidebar trên màn hình điện thoại
        this.closeMobileSidebar();

        // Kích hoạt hàm tải dữ liệu tương ứng của module
        if (tabName === 'dashboard' && window.AdminDashboard) {
            window.AdminDashboard.loadData();
        } else if (tabName === 'events' && window.AdminEvents) {
            window.AdminEvents.loadEvents();
        } else if (tabName === 'attendees' && window.AdminAttendees) {
            window.AdminAttendees.loadAttendees();
        } else if (tabName === 'tickets' && window.AdminTickets) {
            window.AdminTickets.loadTickets();
        } else if (tabName === 'checkin' && window.AdminCheckin) {
            window.AdminCheckin.initStation();
        } else if (tabName === 'reports' && window.AdminReports) {
            window.AdminReports.loadReports();
        } else if (tabName === 'audit' && window.AdminAudit) {
            window.AdminAudit.loadLogs();
        } else if (tabName === 'profile' && window.AdminProfile) {
            window.AdminProfile.loadProfile();
        }
    },

    toggleMobileSidebar() {
        const sidebar = document.getElementById('admin-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar && overlay) {
            sidebar.classList.toggle('show');
            overlay.classList.toggle('show');
        }
    },

    closeMobileSidebar() {
        const sidebar = document.getElementById('admin-sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        if (sidebar && overlay) {
            sidebar.classList.remove('show');
            overlay.classList.remove('show');
        }
    },

    async logout() {
        if (!confirm('Bạn có chắc chắn muốn đăng xuất khỏi phiên làm việc quản trị?')) {
            return;
        }
        try {
            await fetch('/api/admin/auth/logout', { method: 'POST' });
        } catch (e) {}
        window.location.href = '/admin/login';
    },

    // Hiển thị thông báo Toast nổi
    showToast(message, type = 'info', duration = 3500) {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast-custom toast-${type}`;

        const iconMap = {
            success: 'fa-circle-check text-success',
            error: 'fa-circle-exclamation text-danger',
            warning: 'fa-triangle-exclamation text-warning',
            info: 'fa-circle-info text-primary'
        };

        toast.innerHTML = `
            <i class="fa-solid ${iconMap[type] || 'fa-bell'} fs-5 mt-1"></i>
            <div class="flex-grow-1">
                <div class="fw-semibold small">${message}</div>
            </div>
            <button type="button" class="btn-close btn-close-sm" onclick="this.parentElement.remove()"></button>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            if (toast.parentElement) {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(100%)';
                toast.style.transition = 'all 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }
        }, duration);
    },

    // Tổng hợp âm thanh bằng Web Audio API không phụ thuộc file ngoài
    playAudioFeedback(type = 'success') {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const now = ctx.currentTime;

            if (type === 'success') {
                // Âm thanh Ping vui tai hai nốt cao
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(587.33, now); // D5
                osc.frequency.setValueAtTime(880, now + 0.1); // A5
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.35);
            } else if (type === 'duplicate') {
                // Âm thanh cảnh báo hai nốt trầm
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(320, now);
                osc.frequency.setValueAtTime(260, now + 0.15);
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.4);
            } else {
                // Âm thanh thất bại trầm
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(180, now);
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.3);
            }
        } catch (e) {
            // Audio context có thể bị chặn nếu chưa tương tác
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    AdminApp.init();
});

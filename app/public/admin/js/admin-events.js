// Admin Events Management Logic
window.AdminEvents = {
    currentPage: 1,
    searchQuery: '',
    statusFilter: 'all',
    deleteTargetId: null,

    init() {
        const searchInput = document.getElementById('events-search-input');
        if (searchInput) {
            let debounceTimer;
            searchInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    this.searchQuery = e.target.value;
                    this.currentPage = 1;
                    this.loadEvents();
                }, 300);
            });
        }

        const filterSelect = document.getElementById('events-status-filter');
        if (filterSelect) {
            filterSelect.addEventListener('change', (e) => {
                this.statusFilter = e.target.value;
                this.currentPage = 1;
                this.loadEvents();
            });
        }
    },

    async loadEvents() {
        const tbody = document.getElementById('events-table-tbody');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4"><span class="spinner-border spinner-border-sm text-primary me-2"></span> Đang tải sự kiện...</td></tr>';

        try {
            const url = `/api/admin/events?page=${this.currentPage}&limit=10&search=${encodeURIComponent(this.searchQuery)}&status=${this.statusFilter}`;
            const res = await fetch(url);
            if (res.status === 401) {
                window.location.href = '/admin/login';
                return;
            }
            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            this.renderTable(result.data);
            this.renderPagination(result.pagination);
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">Lỗi tải dữ liệu: ${err.message}</td></tr>`;
            AdminApp.showToast('Lỗi tải danh sách sự kiện: ' + err.message, 'error');
        }
    },

    renderTable(events) {
        const tbody = document.getElementById('events-table-tbody');
        if (!tbody) return;

        if (!events || events.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted">Không tìm thấy sự kiện nào phù hợp.</td></tr>';
            return;
        }

        const todayStr = new Date().toISOString().split('T')[0];

        tbody.innerHTML = events.map(ev => {
            const dateStr = ev.date ? new Date(ev.date).toLocaleDateString('vi-VN') : '';
            const rawDate = ev.date ? new Date(ev.date).toISOString().split('T')[0] : '';
            const fillPct = ev.total_tickets > 0 ? Math.min(100, (ev.tickets_sold / ev.total_tickets) * 100).toFixed(1) : 0;

            // Xác định trạng thái
            let statusBadge = '<span class="badge-status badge-upcoming"><i class="fa-solid fa-clock"></i> Sắp diễn ra</span>';
            if (ev.tickets_sold >= ev.total_tickets) {
                statusBadge = '<span class="badge-status badge-soldout"><i class="fa-solid fa-ban"></i> Hết vé</span>';
            } else if (rawDate === todayStr) {
                statusBadge = '<span class="badge-status badge-open"><i class="fa-solid fa-bolt"></i> Đang diễn ra</span>';
            } else if (rawDate < todayStr) {
                statusBadge = '<span class="badge-status badge-ended"><i class="fa-solid fa-flag-checkered"></i> Đã kết thúc</span>';
            }

            return `
                <tr>
                    <td class="fw-bold text-muted ps-3">#${ev.id}</td>
                    <td>
                        <div class="d-flex align-items-center gap-3">
                            <img src="${ev.image_url || 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800'}" alt="${ev.name}" class="rounded-3 shadow-sm" style="width: 48px; height: 48px; object-fit: cover;">
                            <div>
                                <div class="fw-bold text-dark">${ev.name}</div>
                                <div class="small text-muted text-truncate" style="max-width: 280px;" title="${ev.description || ''}">
                                    ${ev.description || 'Chưa có mô tả'}
                                </div>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div class="fw-semibold text-dark"><i class="fa-regular fa-calendar me-1 text-primary"></i> ${dateStr}</div>
                        <div class="small text-muted"><i class="fa-regular fa-clock me-1"></i> ${ev.event_time || '08:30'}</div>
                    </td>
                    <td>
                        <div class="small text-dark fw-semibold"><i class="fa-solid fa-location-dot me-1 text-danger"></i> ${ev.location || 'Hội trường'}</div>
                    </td>
                    <td>
                        <div class="d-flex justify-content-between align-items-center small mb-1">
                            <span class="fw-bold text-primary">${ev.tickets_sold}</span>
                            <span class="text-muted">/ ${ev.total_tickets} vé</span>
                        </div>
                        <div class="progress" style="height: 6px; border-radius: 4px; background: #e2e8f0;">
                            <div class="progress-bar ${fillPct >= 100 ? 'bg-danger' : 'bg-primary'}" style="width: ${fillPct}%"></div>
                        </div>
                        <div class="text-end small text-muted mt-1" style="font-size: 0.75rem;">
                            Đã check-in: <b class="text-success">${ev.checked_in_count || 0}</b>
                        </div>
                    </td>
                    <td>${statusBadge}</td>
                    <td class="text-end pe-3">
                        <div class="btn-group btn-group-sm">
                            <button class="btn btn-outline-primary" onclick="AdminEvents.openEditModal(${ev.id})" title="Chỉnh sửa sự kiện">
                                <i class="fa-solid fa-pen-to-square"></i> Sửa
                            </button>
                            <button class="btn btn-outline-info" onclick="AdminEvents.viewAttendees(${ev.id})" title="Xem danh sách người tham dự">
                                <i class="fa-solid fa-users"></i>
                            </button>
                            <button class="btn btn-outline-danger" onclick="AdminEvents.confirmDelete(${ev.id}, '${ev.name.replace(/'/g, "\\'")}', ${ev.tickets_sold})" title="Xóa / Ẩn sự kiện">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    },

    renderPagination(p) {
        const container = document.getElementById('events-pagination');
        if (!container) return;

        if (p.totalPages <= 1) {
            container.innerHTML = `<span class="small text-muted">Hiển thị toàn bộ ${p.total} sự kiện</span>`;
            return;
        }

        let html = `
            <div class="d-flex justify-content-between align-items-center w-100">
                <span class="small text-muted">Hiển thị trang ${p.page} / ${p.totalPages} (Tổng ${p.total} sự kiện)</span>
                <ul class="pagination pagination-sm mb-0">
                    <li class="page-item ${p.page <= 1 ? 'disabled' : ''}">
                        <button class="page-link" onclick="AdminEvents.changePage(${p.page - 1})">Trước</button>
                    </li>
        `;

        for (let i = 1; i <= p.totalPages; i++) {
            html += `
                <li class="page-item ${i === p.page ? 'active' : ''}">
                    <button class="page-link" onclick="AdminEvents.changePage(${i})">${i}</button>
                </li>
            `;
        }

        html += `
                    <li class="page-item ${p.page >= p.totalPages ? 'disabled' : ''}">
                        <button class="page-link" onclick="AdminEvents.changePage(${p.page + 1})">Tiếp</button>
                    </li>
                </ul>
            </div>
        `;

        container.innerHTML = html;
    },

    changePage(page) {
        this.currentPage = page;
        this.loadEvents();
    },

    openCreateModal() {
        document.getElementById('createEventForm').reset();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        document.getElementById('new-event-date').value = tomorrow.toISOString().split('T')[0];
        document.getElementById('new-event-time').value = '08:30';

        const modal = new bootstrap.Modal(document.getElementById('createEventModal'));
        modal.show();
    },

    async submitCreate(e) {
        e.preventDefault();
        const btn = document.getElementById('btn-submit-create-event');
        btn.disabled = true;

        const payload = {
            name: document.getElementById('new-event-name').value.trim(),
            date: document.getElementById('new-event-date').value,
            event_time: document.getElementById('new-event-time').value,
            location: document.getElementById('new-event-location').value.trim(),
            total_tickets: parseInt(document.getElementById('new-event-capacity').value, 10),
            description: document.getElementById('new-event-desc').value.trim(),
            image_url: document.getElementById('new-event-image').value.trim() || undefined
        };

        try {
            const res = await fetch('/api/admin/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            AdminApp.showToast('Tạo sự kiện mới thành công!', 'success');
            bootstrap.Modal.getInstance(document.getElementById('createEventModal')).hide();
            this.loadEvents();
        } catch (err) {
            AdminApp.showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    },

    async openEditModal(id) {
        try {
            const res = await fetch(`/api/admin/events/${id}`);
            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            const ev = result.event;
            document.getElementById('edit-event-id').value = ev.id;
            document.getElementById('edit-event-name').value = ev.name;
            document.getElementById('edit-event-date').value = ev.date ? new Date(ev.date).toISOString().split('T')[0] : '';
            document.getElementById('edit-event-time').value = ev.event_time || '08:30';
            document.getElementById('edit-event-location').value = ev.location || '';
            document.getElementById('edit-event-capacity').value = ev.total_tickets;
            document.getElementById('edit-event-capacity').min = ev.tickets_sold; // Không cho hạ thấp hơn số vé đã bán
            document.getElementById('edit-event-sold-info').innerText = `Đã bán: ${ev.tickets_sold} vé (Tổng vé không được nhỏ hơn ${ev.tickets_sold})`;
            document.getElementById('edit-event-desc').value = ev.description || '';
            document.getElementById('edit-event-image').value = ev.image_url || '';
            document.getElementById('edit-event-status').value = ev.status || 'published';

            const modal = new bootstrap.Modal(document.getElementById('editEventModal'));
            modal.show();
        } catch (err) {
            AdminApp.showToast('Lỗi lấy thông tin sự kiện: ' + err.message, 'error');
        }
    },

    async submitEdit(e) {
        e.preventDefault();
        const id = document.getElementById('edit-event-id').value;
        const btn = document.getElementById('btn-submit-edit-event');
        btn.disabled = true;

        const payload = {
            name: document.getElementById('edit-event-name').value.trim(),
            date: document.getElementById('edit-event-date').value,
            event_time: document.getElementById('edit-event-time').value,
            location: document.getElementById('edit-event-location').value.trim(),
            total_tickets: parseInt(document.getElementById('edit-event-capacity').value, 10),
            description: document.getElementById('edit-event-desc').value.trim(),
            image_url: document.getElementById('edit-event-image').value.trim(),
            status: document.getElementById('edit-event-status').value
        };

        try {
            const res = await fetch(`/api/admin/events/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            AdminApp.showToast('Cập nhật sự kiện thành công!', 'success');
            bootstrap.Modal.getInstance(document.getElementById('editEventModal')).hide();
            this.loadEvents();
        } catch (err) {
            AdminApp.showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    },

    confirmDelete(id, name, sold) {
        this.deleteTargetId = id;
        document.getElementById('delete-event-name').innerText = name;
        document.getElementById('delete-event-warning').innerText = sold > 0
            ? `Sự kiện này đã có ${sold} vé đăng ký. Hệ thống sẽ áp dụng XÓA MỀM (Soft-delete) để bảo lưu toàn bộ lịch sử vé và người tham dự.`
            : 'Sự kiện này chưa có người đăng ký, bạn hoàn toàn có thể xóa an toàn.';

        const modal = new bootstrap.Modal(document.getElementById('deleteEventModal'));
        modal.show();
    },

    async executeDelete() {
        if (!this.deleteTargetId) return;
        const btn = document.getElementById('btn-execute-delete-event');
        btn.disabled = true;

        try {
            const res = await fetch(`/api/admin/events/${this.deleteTargetId}`, {
                method: 'DELETE'
            });
            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            AdminApp.showToast(result.message, 'success');
            bootstrap.Modal.getInstance(document.getElementById('deleteEventModal')).hide();
            this.loadEvents();
        } catch (err) {
            AdminApp.showToast('Lỗi xóa sự kiện: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
            this.deleteTargetId = null;
        }
    },

    viewAttendees(eventId) {
        // Chuyển sang tab attendees và lọc theo sự kiện này
        AdminApp.switchTab('attendees');
        const filterSelect = document.getElementById('attendees-event-filter');
        if (filterSelect) {
            filterSelect.value = eventId;
            if (window.AdminAttendees) {
                window.AdminAttendees.eventIdFilter = eventId;
                window.AdminAttendees.loadAttendees();
            }
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    AdminEvents.init();
});

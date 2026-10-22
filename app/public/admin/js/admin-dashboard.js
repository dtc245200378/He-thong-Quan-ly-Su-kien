// Admin Dashboard Logic
window.AdminDashboard = {
    async loadData() {
        try {
            const res = await fetch('/api/admin/dashboard');
            if (res.status === 401) {
                window.location.href = '/admin/login';
                return;
            }
            const result = await res.json();
            if (!result.success) throw new Error(result.error);

            this.renderMetrics(result.data.metrics);
            this.renderEventsChart(result.data.eventsBreakdown);
            this.renderUpcomingEvents(result.data.upcomingEvents);
            this.renderRecentCheckins(result.data.recentCheckins);
        } catch (err) {
            console.error('Dashboard error:', err);
            AdminApp.showToast('Lỗi tải dữ liệu Dashboard: ' + err.message, 'error');
        }
    },

    renderMetrics(m) {
        document.getElementById('dash-total-events').innerText = m.totalEvents.toLocaleString('vi-VN');
        document.getElementById('dash-total-issued').innerText = m.totalTicketsIssued.toLocaleString('vi-VN');
        document.getElementById('dash-total-registered').innerText = m.totalTicketsSold.toLocaleString('vi-VN');
        document.getElementById('dash-total-checkin').innerText = m.totalCheckedIn.toLocaleString('vi-VN');
        document.getElementById('dash-remaining-tickets').innerText = m.remainingTickets.toLocaleString('vi-VN');
        document.getElementById('dash-fill-rate').innerText = m.fillRate + '%';
        document.getElementById('dash-checkin-rate').innerText = m.checkinRate + '%';
    },

    renderEventsChart(events) {
        const container = document.getElementById('dash-chart-container');
        if (!container) return;

        if (!events || events.length === 0) {
            container.innerHTML = '<div class="text-muted text-center py-4">Chưa có dữ liệu sự kiện.</div>';
            return;
        }

        let html = '<div class="d-flex flex-column gap-3 py-2">';
        events.forEach(ev => {
            const pct = ev.totalTickets > 0 ? Math.min(100, (ev.ticketsSold / ev.totalTickets) * 100).toFixed(1) : 0;
            const checkinPct = ev.ticketsSold > 0 ? Math.min(100, (ev.checkedIn / ev.ticketsSold) * 100).toFixed(1) : 0;

            html += `
                <div>
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="fw-bold text-dark small text-truncate" style="max-width: 60%;" title="${ev.name}">
                            ${ev.name}
                        </span>
                        <span class="small text-muted">
                            <b class="text-primary">${ev.ticketsSold}</b> / ${ev.totalTickets} vé (${pct}%)
                            <span class="mx-1">•</span>
                            <span class="text-success"><i class="fa-solid fa-check-circle me-1"></i>${ev.checkedIn} check-in (${checkinPct}%)</span>
                        </span>
                    </div>
                    <div class="progress" style="height: 10px; border-radius: 6px; background-color: #e2e8f0;">
                        <div class="progress-bar bg-primary" role="progressbar" style="width: ${pct}%" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        container.innerHTML = html;
    },

    renderUpcomingEvents(list) {
        const tbody = document.getElementById('dash-upcoming-events-tbody');
        if (!tbody) return;

        if (!list || list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-muted">Không có sự kiện sắp diễn ra.</td></tr>';
            return;
        }

        tbody.innerHTML = list.map(ev => {
            const dateStr = ev.date ? new Date(ev.date).toLocaleDateString('vi-VN') : '';
            return `
                <tr>
                    <td class="fw-bold text-primary">#${ev.id}</td>
                    <td class="fw-semibold text-dark">${ev.name}</td>
                    <td><i class="fa-regular fa-calendar text-muted me-1"></i> ${dateStr} (${ev.event_time || '08:30'})</td>
                    <td><i class="fa-solid fa-location-dot text-danger me-1"></i> ${ev.location || 'Hội trường'}</td>
                    <td>
                        <span class="badge bg-light text-dark border">
                            <b>${ev.tickets_sold}</b> / ${ev.total_tickets} vé
                        </span>
                    </td>
                </tr>
            `;
        }).join('');
    },

    renderRecentCheckins(list) {
        const container = document.getElementById('dash-recent-checkins-list');
        if (!container) return;

        if (!list || list.length === 0) {
            container.innerHTML = '<div class="text-muted text-center py-4">Chưa có lượt check-in nào.</div>';
            return;
        }

        container.innerHTML = list.map(item => {
            const timeStr = item.checked_in_at ? new Date(item.checked_in_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
            return `
                <div class="d-flex align-items-center gap-3 py-2 border-bottom border-light">
                    <div class="bg-success bg-opacity-10 text-success rounded-circle p-2 d-flex align-items-center justify-content-center" style="width: 36px; height: 36px;">
                        <i class="fa-solid fa-qrcode"></i>
                    </div>
                    <div class="flex-grow-1 min-w-0">
                        <div class="d-flex justify-content-between align-items-center">
                            <span class="fw-bold text-dark small text-truncate">${item.attendee_name}</span>
                            <span class="badge bg-light text-muted small">${timeStr}</span>
                        </div>
                        <div class="small text-muted text-truncate">${item.event_name} • <span class="font-monospace">${item.ticket_code}</span></div>
                    </div>
                </div>
            `;
        }).join('');
    }
};

        const DROPPR_ACCESS_TOKEN_KEY = "droppr_access_token";
        const DROPPR_REFRESH_TOKEN_KEY = "droppr_refresh_token";
        const DROPPR_OTP_KEY = "droppr_otp_code";

        function getJwtToken() {
            try {
                const t = localStorage.getItem('jwt');
                return t ? String(t) : null;
            } catch (e) {
                return null;
            }
        }

        function decodeJwtPayload(token) {
            if (!token) return null;
            try {
                const parts = String(token).split('.');
                if (parts.length !== 3) return null;
                const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                const pad = payload.length % 4 ? '===='.slice(payload.length % 4) : '';
                return JSON.parse(atob(payload + pad));
            } catch (e) {
                return null;
            }
        }

        function getStoredDropprTokens() {
            try {
                const access = localStorage.getItem(DROPPR_ACCESS_TOKEN_KEY);
                const refresh = localStorage.getItem(DROPPR_REFRESH_TOKEN_KEY);
                const accessPayload = decodeJwtPayload(access);
                const refreshPayload = decodeJwtPayload(refresh);
                return {
                    access,
                    refresh,
                    accessExp: accessPayload && accessPayload.exp ? accessPayload.exp * 1000 : 0,
                    refreshExp: refreshPayload && refreshPayload.exp ? refreshPayload.exp * 1000 : 0,
                };
            } catch (e) {
                return { access: null, refresh: null, accessExp: 0, refreshExp: 0 };
            }
        }

        function getOtpCode() {
            try {
                return sessionStorage.getItem(DROPPR_OTP_KEY) || '';
            } catch (e) {
                return '';
            }
        }

        function promptForOtp() {
            const code = window.prompt("Enter your 2FA code:");
            if (code) {
                try { sessionStorage.setItem(DROPPR_OTP_KEY, String(code)); } catch {}
                return code;
            }
            return '';
        }

        async function refreshDropprToken(refreshToken, allowPrompt = true) {
            if (!refreshToken) return null;
            const headers = { Authorization: `Bearer ${refreshToken}` };
            const otp = getOtpCode();
            if (otp) headers['X-Droppr-OTP'] = otp;
            const res = await fetch('/api/droppr/auth/refresh', { method: 'POST', headers });
            const text = await res.text().catch(() => '');
            let data = null;
            if (text) {
                try { data = JSON.parse(text); } catch {}
            }
            if (res.status === 401 && data && data.otp_required && allowPrompt) {
                const code = promptForOtp();
                if (!code) return null;
                return refreshDropprToken(refreshToken, false);
            }
            if (!res.ok || !data || !data.access_token) return null;
            try {
                localStorage.setItem(DROPPR_ACCESS_TOKEN_KEY, data.access_token);
                if (data.refresh_token) localStorage.setItem(DROPPR_REFRESH_TOKEN_KEY, data.refresh_token);
            } catch {}
            return data.access_token;
        }

        async function ensureDropprAccessToken() {
            const state = getStoredDropprTokens();
            const now = Date.now();
            if (state.access && state.accessExp > now + 60000) return state.access;
            if (state.refresh && state.refreshExp > now + 60000) {
                return await refreshDropprToken(state.refresh, true);
            }
            return null;
        }

        // Prefer droppr access token if available; fall back to File Browser JWT.
        const token = getJwtToken();

        const els = {
            rangeLabel: document.getElementById('rangeLabel'),
            rangeSelect: document.getElementById('rangeSelect'),
            refresh: document.getElementById('refreshBtn'),
            search: document.getElementById('searchInput'),
            includeEmpty: document.getElementById('includeEmpty'),
            sharesBody: document.getElementById('sharesBody'),
            sharesCount: document.getElementById('sharesCount'),
            status: document.getElementById('status'),
            metricDownloads: document.getElementById('metricDownloads'),
            metricZip: document.getElementById('metricZip'),
            metricFiles: document.getElementById('metricFiles'),
            metricViews: document.getElementById('metricViews'),
            modal: document.getElementById('detailModal'),
            modalClose: document.getElementById('detailClose'),
            detailTitle: document.getElementById('detailTitle'),
            detailSub: document.getElementById('detailSub'),
            detailMetrics: document.getElementById('detailMetrics'),
            ipsBody: document.getElementById('ipsBody'),
            eventsBody: document.getElementById('eventsBody'),
            exportCsv: document.getElementById('exportCsvBtn'),
            openGallery: document.getElementById('openGalleryBtn'),
            themeToggle: document.getElementById('themeToggle'),
        };

        const state = {
            days: 30,
            includeEmpty: true,
            search: '',
            shares: [],
            selectedHash: null,
        };

        // ============ THEME FUNCTIONS ============
        const PREFS_KEY = 'droppr_gallery_prefs';

        function loadPrefs() {
            try {
                return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
            } catch { return {}; }
        }

        function savePrefs(prefs) {
            try {
                localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...prefs }));
            } catch {}
        }

        function getTheme() {
            const prefs = loadPrefs();
            return prefs.theme || 'dark';
        }

        function setTheme(theme) {
            const isDark = theme === 'dark';
            document.documentElement.setAttribute('data-theme', theme);
            if (els.themeToggle) {
                els.themeToggle.textContent = isDark ? '🌙' : '☀️';
                els.themeToggle.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
            }
            savePrefs({ theme });
        }

        function toggleTheme() {
            const current = getTheme();
            setTheme(current === 'dark' ? 'light' : 'dark');
        }

        function initTheme() {
            const theme = getTheme();
            setTheme(theme);
            if (els.themeToggle) {
                els.themeToggle.addEventListener('click', toggleTheme);
            }
        }

        // Initialize theme immediately
        initTheme();

        function fmtInt(n) {
            if (n === null || n === undefined) return '—';
            return Intl.NumberFormat().format(n);
        }

        function fmtTime(ts) {
            if (!ts) return '—';
            const d = new Date(ts * 1000);
            return d.toLocaleString();
        }

        function showStatus(text, { error = false } = {}) {
            els.status.textContent = text || '';
            els.status.className = 'status' + (error ? ' error' : '');
        }

        function reportError(err) {
            const message = err && err.message ? err.message : String(err || 'Unknown error');
            showStatus(message, { error: true });
        }

        window.addEventListener('error', (e) => {
            if (!e || !e.message) return;
            reportError(new Error(e.message));
        });

        window.addEventListener('unhandledrejection', (e) => {
            if (!e) return;
            const reason = e.reason;
            reportError(reason instanceof Error ? reason : new Error(String(reason || 'Unhandled promise rejection')));
        });

        async function apiJson(path) {
            const headers = {};
            const dropprToken = await ensureDropprAccessToken();
            if (dropprToken) headers['Authorization'] = `Bearer ${dropprToken}`;
            else if (token) headers['X-Auth'] = token;

            const res = await fetch(path, {
                headers,
                cache: 'no-store',
            });
            if (res.status === 401) {
                window.location.href = '/login?redirect=' + encodeURIComponent('/analytics');
                return null;
            }
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
            }
            return await res.json();
        }

        function applyFilterAndRender() {
            const q = state.search.trim().toLowerCase();
            const filtered = state.shares.filter(s => {
                if (!state.includeEmpty && (s.downloads === 0 && s.gallery_views === 0)) return false;
                if (!q) return true;
                return (s.hash || '').toLowerCase().includes(q) || (s.path || '').toLowerCase().includes(q);
            });

            els.sharesCount.textContent = `${fmtInt(filtered.length)} shares`;
            els.sharesBody.innerHTML = '';

            if (filtered.length === 0) {
                els.sharesBody.innerHTML = `<tr><td colspan="6" class="muted">No shares match your filters.</td></tr>`;
                return;
            }

            for (const share of filtered) {
                const shareLabel = share.path ? `<div>${escapeHtml(share.path)}</div><div class="muted mono">${escapeHtml(share.hash)}</div>`
                                             : `<div class="mono">${escapeHtml(share.hash)}</div>`;
                const deletedTag = share.deleted ? `<span class="tag warn">deleted</span>` : '';
                const downloadsTag = share.downloads > 0 ? `<span class="tag good">${fmtInt(share.downloads)}</span>` : `<span class="tag">${fmtInt(share.downloads)}</span>`;

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${shareLabel}<div style="margin-top:0.35rem;">${deletedTag}</div></td>
                    <td>${downloadsTag}<div class="muted" style="margin-top:0.25rem;">ZIP ${fmtInt(share.zip_downloads)} • Files ${fmtInt(share.file_downloads)}</div></td>
                    <td>${fmtInt(share.gallery_views)}</td>
                    <td>${fmtInt(share.unique_ips)}</td>
                    <td>${fmtTime(share.last_seen)}</td>
                    <td>
                        <div class="row-actions">
                            <a class="btn secondary" href="${share.url}" target="_blank" rel="noopener">Open</a>
                            <button class="btn secondary" type="button" data-detail="${escapeHtml(share.hash)}">Details</button>
                        </div>
                    </td>
                `;
                els.sharesBody.appendChild(tr);
            }
        }

        function escapeHtml(value) {
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/\"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function setMetrics(totals) {
            els.metricDownloads.textContent = fmtInt(totals.downloads ?? 0);
            els.metricZip.textContent = fmtInt(totals.zip_downloads ?? 0);
            els.metricFiles.textContent = fmtInt(totals.file_downloads ?? 0);
            els.metricViews.textContent = fmtInt(totals.gallery_views ?? 0);
        }

        async function loadShares() {
            showStatus('');
            els.sharesBody.innerHTML = `<tr><td colspan="6" class="muted">Loading…</td></tr>`;
            const days = state.days;
            const includeEmpty = state.includeEmpty;
            const data = await apiJson(`/api/analytics/shares?days=${encodeURIComponent(days)}&include_empty=${includeEmpty ? '1' : '0'}`);
            if (!data) return;

            state.shares = Array.isArray(data.shares) ? data.shares : [];
            setMetrics(data.totals || {});

            const since = data.range?.since;
            const until = data.range?.until;
            els.rangeLabel.textContent = since && until ? `${fmtTime(since)} → ${fmtTime(until)}` : '—';

            applyFilterAndRender();
        }

        function openModal() {
            els.modal.classList.add('show');
        }

        function closeModal() {
            els.modal.classList.remove('show');
            state.selectedHash = null;
        }

        function renderDetailMetrics(detail) {
            const counts = detail.counts || {};
            const downloads = (counts.file_download || 0) + (counts.zip_download || 0);
            const views = counts.gallery_view || 0;

            els.detailMetrics.innerHTML = `
                <div class="detail-card"><div class="label">Downloads</div><div class="value">${fmtInt(downloads)}</div></div>
                <div class="detail-card"><div class="label">ZIP Downloads</div><div class="value">${fmtInt(counts.zip_download || 0)}</div></div>
                <div class="detail-card"><div class="label">File Downloads</div><div class="value">${fmtInt(counts.file_download || 0)}</div></div>
                <div class="detail-card"><div class="label">Gallery Views</div><div class="value">${fmtInt(views)}</div></div>
                <div class="detail-card"><div class="label">Unique IPs</div><div class="value">${fmtInt((detail.ips || []).length)}</div></div>
                <div class="detail-card"><div class="label">Last Event</div><div class="value">${fmtTime((detail.events && detail.events[0] && detail.events[0].created_at) || null)}</div></div>
            `;
        }

        function renderIps(detail) {
            const ips = Array.isArray(detail.ips) ? detail.ips : [];
            if (ips.length === 0) {
                els.ipsBody.innerHTML = `<tr><td colspan="5" class="muted">No IP data (or IP logging disabled).</td></tr>`;
                return;
            }
            els.ipsBody.innerHTML = '';
            for (const row of ips) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="mono">${escapeHtml(row.ip)}</td>
                    <td>${fmtInt(row.downloads)}</td>
                    <td>${fmtInt(row.zip_downloads)}</td>
                    <td>${fmtInt(row.file_downloads)}</td>
                    <td>${fmtTime(row.last_seen)}</td>
                `;
                els.ipsBody.appendChild(tr);
            }
        }

        function renderEvents(detail) {
            const events = Array.isArray(detail.events) ? detail.events : [];
            if (events.length === 0) {
                els.eventsBody.innerHTML = `<tr><td colspan="5" class="muted">No events yet.</td></tr>`;
                return;
            }
            els.eventsBody.innerHTML = '';
            for (const ev of events.slice(0, 200)) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${fmtTime(ev.created_at)}</td>
                    <td class="mono">${escapeHtml(ev.event_type)}</td>
                    <td class="mono">${escapeHtml(ev.ip || '')}</td>
                    <td class="mono">${escapeHtml(ev.file_path || '')}</td>
                    <td class="muted">${escapeHtml(ev.user_agent || '')}</td>
                `;
                els.eventsBody.appendChild(tr);
            }
        }

        async function loadShareDetail(shareHash) {
            showStatus('');
            state.selectedHash = shareHash;
            els.detailTitle.textContent = 'Loading…';
            els.detailSub.textContent = '';
            els.ipsBody.innerHTML = `<tr><td colspan="5" class="muted">Loading…</td></tr>`;
            els.eventsBody.innerHTML = `<tr><td colspan="5" class="muted">Loading…</td></tr>`;
            openModal();

            const detail = await apiJson(`/api/analytics/shares/${encodeURIComponent(shareHash)}?days=${encodeURIComponent(state.days)}`);
            if (!detail) return;

            const share = detail.share || {};
            els.detailTitle.textContent = share.path ? `${share.path}` : `${share.hash}`;
            els.detailSub.textContent = share.path ? share.hash : '';
            els.openGallery.href = share.url || `/gallery/${shareHash}`;

            renderDetailMetrics(detail);
            renderIps(detail);
            renderEvents(detail);
        }

        async function exportCsv(hash) {
            const headers = {};
            const dropprToken = await ensureDropprAccessToken();
            if (dropprToken) headers['Authorization'] = `Bearer ${dropprToken}`;
            else if (token) headers['X-Auth'] = token;

            const res = await fetch(`/api/analytics/shares/${encodeURIComponent(hash)}/export.csv?days=${encodeURIComponent(state.days)}`, {
                headers,
                cache: 'no-store',
            });
            if (res.status === 401) {
                window.location.href = '/login?redirect=' + encodeURIComponent('/analytics');
                return;
            }
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Export failed (${res.status}): ${text || res.statusText}`);
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `droppr-share-${hash}-analytics.csv`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }

        // Event wiring
        els.rangeSelect.addEventListener('change', () => {
            state.days = parseInt(els.rangeSelect.value, 10);
            loadShares().catch(reportError);
        });

        els.refresh.addEventListener('click', () => loadShares().catch(reportError));

        // Debounced search
        let searchTimeout = null;
        els.search.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                state.search = els.search.value;
                applyFilterAndRender();
            }, 150);
        });

        els.includeEmpty.addEventListener('change', () => {
            state.includeEmpty = els.includeEmpty.checked;
            loadShares().catch(reportError);
        });

        els.sharesBody.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-detail]');
            if (!btn) return;
            const hash = btn.getAttribute('data-detail');
            if (!hash) return;
            loadShareDetail(hash).catch(reportError);
        });

        els.modalClose.addEventListener('click', closeModal);
        els.modal.addEventListener('click', (e) => {
            if (e.target === els.modal) closeModal();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeModal();
        });

        els.exportCsv.addEventListener('click', () => {
            if (!state.selectedHash) return;
            exportCsv(state.selectedHash).catch(reportError);
        });

        loadShares().catch(reportError);

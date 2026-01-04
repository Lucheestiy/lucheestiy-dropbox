interface DropprTokens {
  access: string | null;
  refresh: string | null;
  accessExp: number;
  refreshExp: number;
}

interface JwtPayload {
  exp?: number;
  [key: string]: unknown;
}

interface ShareData {
  hash: string;
  path?: string;
  downloads: number;
  zip_downloads: number;
  file_downloads: number;
  gallery_views: number;
  unique_ips: number;
  last_seen: number | null;
  deleted?: boolean;
  shareUrl: string;
}

interface ShareListResponse {
  shares: ShareData[];
  totals: {
    downloads?: number;
    zip_downloads?: number;
    file_downloads?: number;
    gallery_views?: number;
  };
  range?: {
    since?: number;
    until?: number;
  };
}

interface ShareDetailResponse {
  share: ShareData;
  counts: {
    file_download?: number;
    zip_download?: number;
    gallery_view?: number;
  };
  ips: IpData[];
  events: EventData[];
}

interface IpData {
  ip: string;
  downloads: number;
  zip_downloads: number;
  file_downloads: number;
  last_seen: number;
}

interface EventData {
  created_at: number;
  event_type: string;
  ip?: string;
  file_path?: string;
  user_agent?: string;
}

interface AuditData {
  id: number;
  action: string;
  target?: string;
  detail?: string;
  ip?: string;
  user_agent?: string;
  created_at: number;
}

interface AuditResponse {
  events: AuditData[];
  range?: {
    since?: number;
    until?: number;
  };
}

interface AnalyticsState {
  days: number;
  includeEmpty: boolean;
  search: string;
  shares: ShareData[];
  selectedHash: string | null;
  activeTab: "shares" | "audit";
  autoRefresh: boolean;
  refreshTimer: ReturnType<typeof setInterval> | null;
}

interface AnalyticsElements {
  rangeLabel: HTMLElement | null;
  rangeSelect: HTMLSelectElement | null;
  refresh: HTMLElement | null;
  search: HTMLInputElement | null;
  includeEmpty: HTMLInputElement | null;
  sharesBody: HTMLElement | null;
  sharesCount: HTMLElement | null;
  status: HTMLElement | null;
  metricDownloads: HTMLElement | null;
  metricZip: HTMLElement | null;
  metricFiles: HTMLElement | null;
  metricViews: HTMLElement | null;
  modal: HTMLElement | null;
  modalClose: HTMLElement | null;
  detailTitle: HTMLElement | null;
  detailSub: HTMLElement | null;
  detailMetrics: HTMLElement | null;
  ipsBody: HTMLElement | null;
  eventsBody: HTMLElement | null;
  exportCsv: HTMLElement | null;
  openGallery: HTMLAnchorElement | null;
  themeToggle: HTMLElement | null;
  autoRefresh: HTMLInputElement | null;
  tabShares: HTMLElement | null;
  tabAudit: HTMLElement | null;
  sharesPanel: HTMLElement | null;
  auditPanel: HTMLElement | null;
  auditBody: HTMLElement | null;
  auditCount: HTMLElement | null;
}

interface GalleryPrefs {
  theme?: "dark" | "light";
  [key: string]: unknown;
}

const DROPPR_ACCESS_TOKEN_KEY = "droppr_access_token";
const DROPPR_REFRESH_TOKEN_KEY = "droppr_refresh_token";
const DROPPR_OTP_KEY = "droppr_otp_code";

function getJwtToken(): string | null {
  try {
    const t = localStorage.getItem("jwt");
    return t ? String(t) : null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(token: string | null): JwtPayload | null {
  if (!token) return null;
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4 ? "====".slice(payload.length % 4) : "";
    return JSON.parse(atob(payload + pad)) as JwtPayload;
  } catch {
    return null;
  }
}

function getStoredDropprTokens(): DropprTokens {
  try {
    const access = localStorage.getItem(DROPPR_ACCESS_TOKEN_KEY);
    const refresh = localStorage.getItem(DROPPR_REFRESH_TOKEN_KEY);
    const accessPayload = decodeJwtPayload(access);
    const refreshPayload = decodeJwtPayload(refresh);
    return {
      access,
      refresh,
      accessExp: accessPayload?.exp ? accessPayload.exp * 1000 : 0,
      refreshExp: refreshPayload?.exp ? refreshPayload.exp * 1000 : 0,
    };
  } catch {
    return { access: null, refresh: null, accessExp: 0, refreshExp: 0 };
  }
}

function getOtpCode(): string {
  try {
    return sessionStorage.getItem(DROPPR_OTP_KEY) || "";
  } catch {
    return "";
  }
}

function promptForOtp(): string {
  const code = window.prompt("Enter your 2FA code:");
  if (code) {
    try {
      sessionStorage.setItem(DROPPR_OTP_KEY, String(code));
    } catch {
      /* ignore */
    }
    return code;
  }
  return "";
}

interface RefreshResponse {
  access_token?: string;
  refresh_token?: string;
  otp_required?: boolean;
}

async function refreshDropprToken(
  refreshToken: string,
  allowPrompt = true
): Promise<string | null> {
  if (!refreshToken) return null;
  const headers: Record<string, string> = { Authorization: `Bearer ${refreshToken}` };
  const otp = getOtpCode();
  if (otp) headers["X-Droppr-OTP"] = otp;
  const res = await fetch("/api/droppr/auth/refresh", { method: "POST", headers });
  const text = await res.text().catch(() => "");
  let data: RefreshResponse | null = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      /* ignore */
    }
  }
  if (res.status === 401 && data?.otp_required && allowPrompt) {
    const code = promptForOtp();
    if (!code) return null;
    return refreshDropprToken(refreshToken, false);
  }
  if (!res.ok || !data?.access_token) return null;
  try {
    localStorage.setItem(DROPPR_ACCESS_TOKEN_KEY, data.access_token);
    if (data.refresh_token) localStorage.setItem(DROPPR_REFRESH_TOKEN_KEY, data.refresh_token);
  } catch {
    /* ignore */
  }
  return data.access_token;
}

async function ensureDropprAccessToken(): Promise<string | null> {
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

const els: AnalyticsElements = {
  rangeLabel: document.getElementById("rangeLabel"),
  rangeSelect: document.getElementById("rangeSelect") as HTMLSelectElement | null,
  refresh: document.getElementById("refreshBtn"),
  search: document.getElementById("searchInput") as HTMLInputElement | null,
  includeEmpty: document.getElementById("includeEmpty") as HTMLInputElement | null,
  sharesBody: document.getElementById("sharesBody"),
  sharesCount: document.getElementById("sharesCount"),
  status: document.getElementById("status"),
  metricDownloads: document.getElementById("metricDownloads"),
  metricZip: document.getElementById("metricZip"),
  metricFiles: document.getElementById("metricFiles"),
  metricViews: document.getElementById("metricViews"),
  modal: document.getElementById("detailModal"),
  modalClose: document.getElementById("detailClose"),
  detailTitle: document.getElementById("detailTitle"),
  detailSub: document.getElementById("detailSub"),
  detailMetrics: document.getElementById("detailMetrics"),
  ipsBody: document.getElementById("ipsBody"),
  eventsBody: document.getElementById("eventsBody"),
  exportCsv: document.getElementById("exportCsvBtn"),
  openGallery: document.getElementById("openGalleryBtn") as HTMLAnchorElement | null,
  themeToggle: document.getElementById("themeToggle"),
  autoRefresh: document.getElementById("autoRefresh") as HTMLInputElement | null,
  tabShares: document.getElementById("tabShares"),
  tabAudit: document.getElementById("tabAudit"),
  sharesPanel: document.getElementById("sharesPanel"),
  auditPanel: document.getElementById("auditPanel"),
  auditBody: document.getElementById("auditBody"),
  auditCount: document.getElementById("auditCount"),
};

const state: AnalyticsState = {
  days: 30,
  includeEmpty: true,
  search: "",
  shares: [],
  selectedHash: null,
  activeTab: "shares",
  autoRefresh: false,
  refreshTimer: null,
};

// ============ THEME FUNCTIONS ============
const PREFS_KEY = "droppr_gallery_prefs";

function loadPrefs(): GalleryPrefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as GalleryPrefs;
  } catch {
    return {};
  }
}

function savePrefs(prefs: Partial<GalleryPrefs>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...prefs }));
  } catch {
    /* ignore */
  }
}

function getTheme(): "dark" | "light" {
  const prefs = loadPrefs();
  return prefs.theme || "dark";
}

function setTheme(theme: "dark" | "light"): void {
  const isDark = theme === "dark";
  document.documentElement.setAttribute("data-theme", theme);
  if (els.themeToggle) {
    els.themeToggle.textContent = isDark ? "🌙" : "☀️";
    els.themeToggle.title = isDark ? "Switch to light theme" : "Switch to dark theme";
  }
  savePrefs({ theme });
}

function toggleTheme(): void {
  const current = getTheme();
  setTheme(current === "dark" ? "light" : "dark");
}

function initTheme(): void {
  const theme = getTheme();
  setTheme(theme);
  if (els.themeToggle) {
    els.themeToggle.addEventListener("click", toggleTheme);
  }
}

// Initialize theme immediately
initTheme();

function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return Intl.NumberFormat().format(n);
}

function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleString();
}

function showStatus(text: string, { error = false } = {}): void {
  if (els.status) {
    els.status.textContent = text || "";
    els.status.className = "status" + (error ? " error" : "");
  }
}

function reportError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err || "Unknown error");
  showStatus(message, { error: true });
}

window.addEventListener("error", (e: ErrorEvent) => {
  if (!e?.message) return;
  reportError(new Error(e.message));
});

window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
  if (!e) return;
  const reason = e.reason;
  reportError(
    reason instanceof Error ? reason : new Error(String(reason || "Unhandled promise rejection"))
  );
});

async function apiJson<T>(path: string): Promise<T | null> {
  const headers: Record<string, string> = {};
  const dropprToken = await ensureDropprAccessToken();
  if (dropprToken) headers["Authorization"] = `Bearer ${dropprToken}`;
  else if (token) headers["X-Auth"] = token;

  const res = await fetch(path, {
    headers,
    cache: "no-store",
  });
  if (res.status === 401) {
    window.location.href = "/login?redirect=" + encodeURIComponent("/analytics");
    return null;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Request failed (${res.status}): ${text || res.statusText}`);
  }
  return (await res.json()) as T;
}

function applyFilterAndRender(): void {
  const q = state.search.trim().toLowerCase();
  const filtered = state.shares.filter((s: ShareData) => {
    if (!state.includeEmpty && s.downloads === 0 && s.gallery_views === 0) return false;
    if (!q) return true;
    return (s.hash || "").toLowerCase().includes(q) || (s.path || "").toLowerCase().includes(q);
  });

  if (els.sharesCount) {
    els.sharesCount.textContent = `${fmtInt(filtered.length)} shares`;
  }
  if (els.sharesBody) {
    els.sharesBody.innerHTML = "";
  }

  if (filtered.length === 0) {
    if (els.sharesBody) {
      els.sharesBody.innerHTML = `<tr><td colspan="6" class="muted">No shares match your filters.</td></tr>`;
    }
    return;
  }

  for (const share of filtered) {
    const shareLabel = share.path
      ? `<div>${escapeHtml(share.path)}</div><div class="muted mono">${escapeHtml(share.hash)}</div>`
      : `<div class="mono">${escapeHtml(share.hash)}</div>`;
    const deletedTag = share.deleted ? `<span class="tag warn">deleted</span>` : "";
    const downloadsTag =
      share.downloads > 0
        ? `<span class="tag good">${fmtInt(share.downloads)}</span>`
        : `<span class="tag">${fmtInt(share.downloads)}</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
        <td>${shareLabel}<div style="margin-top:0.35rem;">${deletedTag}</div></td>
        <td>${downloadsTag}<div class="muted" style="margin-top:0.25rem;">ZIP ${fmtInt(share.zip_downloads)} • Files ${fmtInt(share.file_downloads)}</div></td>
        <td>${fmtInt(share.gallery_views)}</td>
        <td>${fmtInt(share.unique_ips)}</td>
        <td>${fmtTime(share.last_seen)}</td>
        <td>
            <div class="row-actions">
                <a class="btn secondary" href="${share.shareUrl}" target="_blank" rel="noopener">Open</a>
                <button class="btn secondary" type="button" data-detail="${escapeHtml(share.hash)}">Details</button>
            </div>
        </td>
    `;
    els.sharesBody?.appendChild(tr);
  }
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setMetrics(totals: ShareListResponse["totals"]): void {
  if (els.metricDownloads) els.metricDownloads.textContent = fmtInt(totals.downloads ?? 0);
  if (els.metricZip) els.metricZip.textContent = fmtInt(totals.zip_downloads ?? 0);
  if (els.metricFiles) els.metricFiles.textContent = fmtInt(totals.file_downloads ?? 0);
  if (els.metricViews) els.metricViews.textContent = fmtInt(totals.gallery_views ?? 0);
}

async function loadShares(): Promise<void> {
  if (state.activeTab !== "shares") return;
  showStatus("");
  if (els.sharesBody && state.shares.length === 0) {
    els.sharesBody.innerHTML = `<tr><td colspan="6" class="muted">Loading…</td></tr>`;
  }
  const days = state.days;
  const includeEmpty = state.includeEmpty;
  const data = await apiJson<ShareListResponse>(
    `/api/analytics/shares?days=${encodeURIComponent(days)}&include_empty=${includeEmpty ? "1" : "0"}`
  );
  if (!data) return;

  state.shares = Array.isArray(data.shares) ? data.shares : [];
  setMetrics(data.totals || {});

  const since = data.range?.since;
  const until = data.range?.until;
  if (els.rangeLabel) {
    els.rangeLabel.textContent = since && until ? `${fmtTime(since)} → ${fmtTime(until)}` : "—";
  }

  applyFilterAndRender();
}

async function loadAuditLog(): Promise<void> {
  if (state.activeTab !== "audit") return;
  showStatus("");
  if (els.auditBody && els.auditBody.innerHTML.includes("Loading")) {
    els.auditBody.innerHTML = `<tr><td colspan="5" class="muted">Loading…</td></tr>`;
  }

  const data = await apiJson<AuditResponse>(
    `/api/analytics/audit?days=${encodeURIComponent(state.days)}&limit=200`
  );
  if (!data) return;

  if (els.auditCount) {
    els.auditCount.textContent = `${fmtInt(data.events.length)} events`;
  }

  if (els.auditBody) {
    els.auditBody.innerHTML = "";
    if (data.events.length === 0) {
      els.auditBody.innerHTML = `<tr><td colspan="5" class="muted">No audit events found.</td></tr>`;
    } else {
      for (const ev of data.events) {
        const tr = document.createElement("tr");
        const actionTag = `<span class="tag ${ev.action.includes("error") ? "warn" : "good"}">${escapeHtml(ev.action)}</span>`;
        let detailHtml = "—";
        if (ev.detail) {
          try {
            const detailObj = JSON.parse(ev.detail);
            detailHtml = `<pre class="mono" style="font-size:0.75rem; margin:0; max-width:300px; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(JSON.stringify(detailObj))}</pre>`;
          } catch {
            detailHtml = `<span class="muted">${escapeHtml(ev.detail)}</span>`;
          }
        }

        tr.innerHTML = `
            <td>${fmtTime(ev.created_at)}</td>
            <td>${actionTag}</td>
            <td class="mono">${escapeHtml(ev.target || "—")}</td>
            <td>
                <div class="mono">${escapeHtml(ev.ip || "—")}</div>
                <div class="muted" style="font-size:0.75rem; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(ev.user_agent || "")}">${escapeHtml(ev.user_agent || "—")}</div>
            </td>
            <td>${detailHtml}</td>
        `;
        els.auditBody.appendChild(tr);
      }
    }
  }
}

function toggleTab(tab: "shares" | "audit"): void {
  state.activeTab = tab;
  if (els.tabShares) {
    els.tabShares.classList.toggle("active", tab === "shares");
    els.tabShares.setAttribute("aria-selected", String(tab === "shares"));
  }
  if (els.tabAudit) {
    els.tabAudit.classList.toggle("active", tab === "audit");
    els.tabAudit.setAttribute("aria-selected", String(tab === "audit"));
  }
  if (els.sharesPanel) els.sharesPanel.style.display = tab === "shares" ? "block" : "none";
  if (els.auditPanel) els.auditPanel.style.display = tab === "audit" ? "block" : "none";

  if (tab === "shares") loadShares().catch(reportError);
  else loadAuditLog().catch(reportError);
}

function startAutoRefresh(): void {
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    if (state.activeTab === "shares") loadShares().catch(reportError);
    else loadAuditLog().catch(reportError);
  }, 10000);
}

function stopAutoRefresh(): void {
  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }
}

function openDetailsModal(): void {
  els.modal?.classList.add("show");
}

function closeModal(): void {
  els.modal?.classList.remove("show");
  state.selectedHash = null;
}

function renderDetailMetrics(detail: ShareDetailResponse): void {
  const counts = detail.counts || {};
  const downloads = (counts.file_download || 0) + (counts.zip_download || 0);
  const views = counts.gallery_view || 0;

  if (els.detailMetrics) {
    els.detailMetrics.innerHTML = `
        <div class="detail-card"><div class="label">Downloads</div><div class="value">${fmtInt(downloads)}</div></div>
        <div class="detail-card"><div class="label">ZIP Downloads</div><div class="value">${fmtInt(counts.zip_download || 0)}</div></div>
        <div class="detail-card"><div class="label">File Downloads</div><div class="value">${fmtInt(counts.file_download || 0)}</div></div>
        <div class="detail-card"><div class="label">Gallery Views</div><div class="value">${fmtInt(views)}</div></div>
        <div class="detail-card"><div class="label">Unique IPs</div><div class="value">${fmtInt((detail.ips || []).length)}</div></div>
        <div class="detail-card"><div class="label">Last Event</div><div class="value">${fmtTime(detail.events?.[0]?.created_at || null)}</div></div>
    `;
  }
}

function renderIps(detail: ShareDetailResponse): void {
  const ips = Array.isArray(detail.ips) ? detail.ips : [];
  if (ips.length === 0) {
    if (els.ipsBody) {
      els.ipsBody.innerHTML = `<tr><td colspan="5" class="muted">No IP data (or IP logging disabled).</td></tr>`;
    }
    return;
  }
  if (els.ipsBody) {
    els.ipsBody.innerHTML = "";
    for (const row of ips) {
      const tr = document.createElement("tr");
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
}

function renderEvents(detail: ShareDetailResponse): void {
  const events = Array.isArray(detail.events) ? detail.events : [];
  if (events.length === 0) {
    if (els.eventsBody) {
      els.eventsBody.innerHTML = `<tr><td colspan="5" class="muted">No events yet.</td></tr>`;
    }
    return;
  }
  if (els.eventsBody) {
    els.eventsBody.innerHTML = "";
    for (const ev of events.slice(0, 200)) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
          <td>${fmtTime(ev.created_at)}</td>
          <td class="mono">${escapeHtml(ev.event_type)}</td>
          <td class="mono">${escapeHtml(ev.ip || "")}</td>
          <td class="mono">${escapeHtml(ev.file_path || "")}</td>
          <td class="muted">${escapeHtml(ev.user_agent || "")}</td>
      `;
      els.eventsBody.appendChild(tr);
    }
  }
}

async function loadShareDetail(shareHash: string): Promise<void> {
  showStatus("");
  state.selectedHash = shareHash;
  if (els.detailTitle) els.detailTitle.textContent = "Loading…";
  if (els.detailSub) els.detailSub.textContent = "";
  if (els.ipsBody) els.ipsBody.innerHTML = `<tr><td colspan="5" class="muted">Loading…</td></tr>`;
  if (els.eventsBody)
    els.eventsBody.innerHTML = `<tr><td colspan="5" class="muted">Loading…</td></tr>`;
  openDetailsModal();

  const detail = await apiJson<ShareDetailResponse>(
    `/api/analytics/shares/${encodeURIComponent(shareHash)}?days=${encodeURIComponent(state.days)}`
  );
  if (!detail) return;

  const share = detail.share || ({} as ShareData);
  if (els.detailTitle) els.detailTitle.textContent = share.path ? `${share.path}` : `${share.hash}`;
  if (els.detailSub) els.detailSub.textContent = share.path ? share.hash : "";
  if (els.openGallery) els.openGallery.href = share.shareUrl || `/gallery/${shareHash}`;

  renderDetailMetrics(detail);
  renderIps(detail);
  renderEvents(detail);
}

async function exportCsv(hash: string): Promise<void> {
  const headers: Record<string, string> = {};
  const dropprToken = await ensureDropprAccessToken();
  if (dropprToken) headers["Authorization"] = `Bearer ${dropprToken}`;
  else if (token) headers["X-Auth"] = token;

  const res = await fetch(
    `/api/analytics/shares/${encodeURIComponent(hash)}/export.csv?days=${encodeURIComponent(state.days)}`,
    {
      headers,
      cache: "no-store",
    }
  );
  if (res.status === 401) {
    window.location.href = "/login?redirect=" + encodeURIComponent("/analytics");
    return;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Export failed (${res.status}): ${text || res.statusText}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `droppr-share-${hash}-analytics.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Event wiring
els.tabShares?.addEventListener("click", () => toggleTab("shares"));
els.tabAudit?.addEventListener("click", () => toggleTab("audit"));

els.autoRefresh?.addEventListener("change", () => {
  state.autoRefresh = els.autoRefresh!.checked;
  if (state.autoRefresh) startAutoRefresh();
  else stopAutoRefresh();
});

els.rangeSelect?.addEventListener("change", () => {
  state.days = parseInt(els.rangeSelect!.value, 10);
  if (state.activeTab === "shares") loadShares().catch(reportError);
  else loadAuditLog().catch(reportError);
});

els.refresh?.addEventListener("click", () => {
  if (state.activeTab === "shares") loadShares().catch(reportError);
  else loadAuditLog().catch(reportError);
});

// Debounced search
let searchTimeout: ReturnType<typeof setTimeout> | null = null;
els.search?.addEventListener("input", () => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    state.search = els.search!.value;
    applyFilterAndRender();
  }, 150);
});

els.includeEmpty?.addEventListener("change", () => {
  state.includeEmpty = els.includeEmpty!.checked;
  loadShares().catch(reportError);
});

els.sharesBody?.addEventListener("click", (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  const btn = target.closest("button[data-detail]") as HTMLElement | null;
  if (!btn) return;
  const hash = btn.getAttribute("data-detail");
  if (!hash) return;
  loadShareDetail(hash).catch(reportError);
});

els.modalClose?.addEventListener("click", closeModal);
els.modal?.addEventListener("click", (e: MouseEvent) => {
  if (e.target === els.modal) closeModal();
});

document.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape") closeModal();
});

els.exportCsv?.addEventListener("click", () => {
  if (!state.selectedHash) return;
  exportCsv(state.selectedHash).catch(reportError);
});

loadShares().catch(reportError);

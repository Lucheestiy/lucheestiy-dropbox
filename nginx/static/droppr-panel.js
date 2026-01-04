var $e = Object.defineProperty;
var Ie = (a, e, t) =>
  e in a ? $e(a, e, { enumerable: !0, configurable: !0, writable: !0, value: t }) : (a[e] = t);
var g = (a, e, t) => Ie(a, typeof e != "symbol" ? e + "" : e, t);
function Pe(a) {
  const e = (document.cookie || "").match(new RegExp("(?:^|;\\s*)" + a + "=([^;]+)"));
  return e ? e[1] : null;
}
function X(a) {
  if (!a) return null;
  try {
    const e = String(a).split(".");
    if (e.length !== 3) return null;
    const t = e[1].replace(/-/g, "+").replace(/_/g, "/"),
      r = t.length % 4 ? "====".slice(t.length % 4) : "",
      n = atob(t + r);
    return JSON.parse(n);
  } catch {
    return null;
  }
}
const ge = "droppr_access_token",
  be = "droppr_refresh_token",
  V = "droppr_otp_code";
function z() {
  try {
    const e = localStorage.getItem("jwt");
    if (e) return e;
  } catch {}
  const a = Pe("auth");
  if (a)
    try {
      return decodeURIComponent(a);
    } catch {
      return a;
    }
  return null;
}
function B() {
  return !!z();
}
function xe() {
  let a = null,
    e = null;
  try {
    ((a = localStorage.getItem(ge)), (e = localStorage.getItem(be)));
  } catch {
    ((a = null), (e = null));
  }
  const t = X(a),
    r = X(e);
  return {
    access: a,
    refresh: e,
    accessExp: t && t.exp ? t.exp * 1e3 : 0,
    refreshExp: r && r.exp ? r.exp * 1e3 : 0,
  };
}
function ye(a, e) {
  try {
    (a && localStorage.setItem(ge, a), e && localStorage.setItem(be, e));
  } catch {}
  window.dispatchEvent(new Event("droppr:tokens-updated"));
}
function we() {
  try {
    return sessionStorage.getItem(V) || "";
  } catch {
    return "";
  }
}
function Le(a) {
  try {
    a ? sessionStorage.setItem(V, a) : sessionStorage.removeItem(V);
  } catch {}
}
function ve() {
  const a = window.prompt("Enter your 2FA code:");
  return a ? (Le(a), a) : "";
}
async function Se(a) {
  const e = await a.text();
  let t = null;
  if (e)
    try {
      t = JSON.parse(e);
    } catch {
      t = null;
    }
  return { res: a, data: t };
}
async function Ee(a = !0) {
  const e = z();
  if (!e) return null;
  const t = { "X-Auth": e },
    r = we();
  r && (t["X-Droppr-OTP"] = r);
  try {
    const n = await fetch("/api/droppr/auth/login", { method: "POST", headers: t }),
      { res: o, data: s } = await Se(n);
    if (o.status === 401 && s && s.otp_required && a) return ve() ? Ee(!1) : null;
    if (!o.ok) return null;
    if (s && s.access_token) return (ye(s.access_token, s.refresh_token), s.access_token);
  } catch {}
  return null;
}
async function ke(a, e = !0) {
  if (!a) return null;
  const t = { Authorization: "Bearer " + a },
    r = we();
  r && (t["X-Droppr-OTP"] = r);
  try {
    const n = await fetch("/api/droppr/auth/refresh", { method: "POST", headers: t }),
      { res: o, data: s } = await Se(n);
    if (o.status === 401 && s && s.otp_required && e) return ve() ? ke(a, !1) : null;
    if (!o.ok) return null;
    if (s && s.access_token) return (ye(s.access_token, s.refresh_token), s.access_token);
  } catch {}
  return null;
}
async function _e(a = !1) {
  const e = xe(),
    t = Date.now();
  if (!a && e.access && e.accessExp > t + 6e4) return e.access;
  if (e.refresh && e.refreshExp > t + 6e4) {
    const r = await ke(e.refresh, !0);
    if (r) return r;
  }
  return await Ee(!0);
}
function Re() {
  const a = xe();
  if (a.access && a.accessExp) return a.accessExp;
  const e = z(),
    t = X(e);
  return t && t.exp ? t.exp * 1e3 : 0;
}
const H = "droppr-session-warning",
  K = "droppr-session-warning-style",
  Ne = 5 * 60 * 1e3;
class qe {
  constructor() {
    g(this, "el", null);
    g(this, "interval", null);
    (this.ensureStyles(),
      this.ensureElement(),
      this.start(),
      window.addEventListener("droppr:tokens-updated", () => this.update()));
  }
  ensureStyles() {
    if (document.getElementById(K)) return;
    const e = document.createElement("style");
    ((e.id = K),
      (e.textContent = `
      #${H} {
        position: fixed;
        top: 16px;
        right: 16px;
        z-index: 2147483001;
        background: rgba(15, 23, 42, 0.92);
        color: #e5e7eb;
        border: 1px solid rgba(255,255,255,0.15);
        border-radius: 12px;
        padding: 10px 12px;
        font: 12px/1.4 Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        box-shadow: 0 18px 40px -20px rgba(0,0,0,0.65);
        display: none;
        gap: 10px;
        align-items: center;
      }
      #${H} .btn {
        border: 0;
        background: rgba(99,102,241,0.95);
        color: #fff;
        font-weight: 700;
        border-radius: 10px;
        padding: 6px 10px;
        cursor: pointer;
      }
    `),
      document.head.appendChild(e));
  }
  ensureElement() {
    var t;
    let e = document.getElementById(H);
    (e ||
      ((e = document.createElement("div")),
      (e.id = H),
      (e.innerHTML =
        '<span class="msg">Session expiring soon.</span><button class="btn" type="button">Refresh</button>'),
      (t = e.querySelector(".btn")) == null ||
        t.addEventListener("click", () => {
          _e(!0);
        }),
      document.body.appendChild(e)),
      (this.el = e));
  }
  start() {
    this.interval ||
      (this.update(), (this.interval = window.setInterval(() => this.update(), 6e4)));
  }
  update() {
    if (!this.el) return;
    const e = Re();
    if (!e) {
      this.el.style.display = "none";
      return;
    }
    const t = e - Date.now();
    if (t > Ne) {
      this.el.style.display = "none";
      return;
    }
    const r = Math.max(1, Math.ceil(t / 6e4)),
      n = this.el.querySelector(".msg");
    (n && (n.textContent = `Session expires in ${r} min.`),
      (this.el.style.display = "inline-flex"));
  }
}
const L = "droppr-analytics-btn",
  Z = "droppr-analytics-style";
class Ue {
  constructor() {
    (this.ensureStyles(), this.ensureButton());
  }
  ensureStyles() {
    if (document.getElementById(Z)) return;
    const e = document.createElement("style");
    ((e.id = Z),
      (e.textContent = `
      #${L} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483000;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 999px;
        background: rgba(99, 102, 241, 0.95);
        color: #fff !important;
        text-decoration: none !important;
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        font-weight: 700;
        letter-spacing: -0.01em;
        box-shadow: 0 18px 40px -18px rgba(0,0,0,0.65);
        border: 1px solid rgba(255,255,255,0.18);
        user-select: none;
      }
      #${L}:hover {
        background: rgba(79, 70, 229, 0.98);
        transform: translateY(-1px);
      }
      #${L} .icon {
        width: 18px;
        height: 18px;
        display: inline-block;
      }
      #${L} .label {
        font-size: 14px;
        line-height: 1;
      }
    `),
      document.head.appendChild(e));
  }
  ensureButton() {
    const e = document.getElementById(L);
    if (!B()) {
      e && e.parentNode && e.parentNode.removeChild(e);
      return;
    }
    if (e) return;
    const t = document.createElement("a");
    ((t.id = L),
      (t.href = "/analytics"),
      (t.target = "_blank"),
      (t.rel = "noopener"),
      (t.title = "Dropbox Analytics"),
      (t.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 3h2v18H3V3zm4 10h2v8H7v-8zm4-6h2v14h-2V7zm4 4h2v10h-2V11zm4-7h2v17h-2V4z"/>
      </svg>
      <span class="label">Analytics</span>
    `),
      document.body.appendChild(t));
  }
}
async function D(a, e = {}) {
  const t = { ...e },
    r = new Headers(t.headers),
    n = await _e(!1);
  if (n) r.set("Authorization", "Bearer " + n);
  else {
    const o = z();
    o && r.set("X-Auth", o);
  }
  return ((t.headers = r), fetch(a, t));
}
const Q = "droppr-share-expire-style",
  M = "droppr-share-expire-btn",
  ee = "droppr_share_expire_hours";
class Be {
  constructor() {
    g(this, "aliasesState", { loading: !1, lastAppliedAt: 0, cache: [] });
    g(this, "observer", null);
    (this.ensureStyles(), this.startWatcher());
  }
  ensureStyles() {
    if (document.getElementById(Q)) return;
    const e = document.createElement("style");
    ((e.id = Q),
      (e.textContent = `
      .${M} { margin-left: 6px; }
      .${M}[disabled] { opacity: 0.55; cursor: not-allowed; }
    `),
      document.head.appendChild(e));
  }
  isSharesPage() {
    return (
      String((window.location && window.location.pathname) || "").indexOf("/settings/shares") !== -1
    );
  }
  extractShareHashFromHref(e) {
    const t = String(e || "");
    let r = t.match(/\/share\/([^/?#]+)/);
    return (r && r[1]) || ((r = t.match(/share\/([^/?#]+)/)), r && r[1]) ? r[1] : null;
  }
  getDefaultShareExpireHours() {
    let e = null;
    try {
      e = localStorage.getItem(ee);
    } catch {
      e = null;
    }
    const t = e ? parseInt(e, 10) : null;
    return t == null || t < 0 ? 30 : t;
  }
  async updateShareExpire(e, t, r) {
    const n = await D("/api/droppr/shares/" + encodeURIComponent(e) + "/expire", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours: t, path: r || "" }),
      }),
      o = await n.text();
    if (!n.ok) throw new Error("Update failed (" + n.status + "): " + (o || ""));
    if (!o) return {};
    try {
      return JSON.parse(o);
    } catch {
      return {};
    }
  }
  fmtRelativeExpire(e) {
    if (e == null) return "";
    const t = parseInt(String(e), 10);
    if (isNaN(t)) return "";
    if (t === 0) return "permanent";
    const r = Math.floor((t * 1e3 - Date.now()) / 1e3);
    if (r <= 0) return "expired";
    const n = Math.floor(r / 86400);
    if (n >= 2) return "in " + n + " days";
    if (n === 1) return "in 1 day";
    const o = Math.floor(r / 3600);
    if (o >= 2) return "in " + o + " hours";
    if (o === 1) return "in 1 hour";
    const s = Math.floor(r / 60);
    return s >= 2 ? "in " + s + " minutes" : s === 1 ? "in 1 minute" : "in " + r + " seconds";
  }
  async fetchShareAliases(e) {
    const t = typeof e == "number" ? "?limit=" + String(e) : "",
      r = await D("/api/droppr/shares/aliases" + t, { method: "GET", headers: {} }),
      n = await r.text();
    if (!r.ok) throw new Error("Aliases failed (" + r.status + "): " + (n || ""));
    if (!n) return { aliases: [] };
    try {
      return JSON.parse(n);
    } catch {
      return { aliases: [] };
    }
  }
  applyAliasToShareRow(e, t) {
    if (!e || !t) return;
    const r = e.querySelectorAll("td");
    if (!r || r.length < 2) return;
    const n = this.fmtRelativeExpire(t.target_expire),
      o = n ? "Aliased (" + n + ")" : "Aliased";
    r[1].textContent = o;
  }
  async ensureShareAliasesApplied() {
    if (!B() || !this.isSharesPage()) return;
    const e = Date.now();
    if (
      (this.aliasesState.lastAppliedAt && e - this.aliasesState.lastAppliedAt < 2500) ||
      this.aliasesState.loading
    )
      return;
    this.aliasesState.loading = !0;
    try {
      const n = await this.fetchShareAliases(2e3);
      this.aliasesState.cache = n && n.aliases ? n.aliases : [];
    } catch {
      this.aliasesState.cache = [];
    } finally {
      ((this.aliasesState.loading = !1), (this.aliasesState.lastAppliedAt = Date.now()));
    }
    const t = this.aliasesState.cache || [];
    if (!t || t.length === 0) return;
    document.querySelectorAll("tr").forEach((n) => {
      const o = n.querySelectorAll("td");
      if (!o || o.length < 1) return;
      const s = o[0].querySelector("a");
      if (!s) return;
      const l = s.getAttribute("href") || "",
        c = this.extractShareHashFromHref(l);
      if (!c) return;
      const i = t.find((m) => m.alias_id === c);
      i && this.applyAliasToShareRow(n, i);
    });
  }
  injectButtons() {
    if (!B() || !this.isSharesPage()) return;
    this.ensureShareAliasesApplied();
    const e = document.querySelectorAll(".card-content table tbody");
    e.length &&
      e.forEach((t) => {
        t.querySelectorAll("tr").forEach((n) => {
          const o = n.querySelectorAll("td");
          if (!o || o.length < 1) return;
          const s = o[o.length - 1];
          if (!s) return;
          const l = o[0].querySelector("a");
          if (!l) return;
          const c = l.getAttribute("href"),
            i = this.extractShareHashFromHref(c || "");
          if (!i) return;
          let m = "";
          try {
            const y = o[0].querySelector(".secondary");
            y && (m = y.textContent || "");
          } catch {}
          if (s.querySelector("." + M)) return;
          const h = document.createElement("button");
          ((h.textContent = "⏱"),
            (h.title = "Set expiration"),
            (h.className = "action " + M),
            (h.style.cursor = "pointer"),
            (h.onclick = async (y) => {
              (y.preventDefault(), y.stopPropagation());
              const f = this.getDefaultShareExpireHours(),
                p = prompt("Expire share in hours (0=permanent)?", String(f));
              if (p === null) return;
              const b = parseInt(p, 10);
              if (!(isNaN(b) || b < 0)) {
                try {
                  localStorage.setItem(ee, String(b));
                } catch {}
                h.disabled = !0;
                try {
                  (await this.updateShareExpire(i, b, m),
                    alert("Expiration set to " + b + " hours."),
                    (this.aliasesState.lastAppliedAt = 0),
                    this.ensureShareAliasesApplied());
                } catch (v) {
                  alert("Failed to set expiration: " + v);
                } finally {
                  h.disabled = !1;
                }
              }
            }),
            s.appendChild(h));
        });
      });
  }
  startWatcher() {
    (this.injectButtons(),
      (this.observer = new MutationObserver(() => {
        this.injectButtons();
      })),
      this.observer.observe(document.body, { childList: !0, subtree: !0 }));
  }
}
class De {
  constructor() {
    g(this, "isAdmin", null);
    g(this, "config", { root: "/users", password_min_length: 8 });
    g(this, "checkPromise", null);
  }
  async check() {
    return B()
      ? this.isAdmin !== null
        ? this.isAdmin
        : this.checkPromise
          ? this.checkPromise
          : ((this.checkPromise = D("/api/droppr/users", {})
              .then(async (e) => {
                if (!e.ok) return ((this.isAdmin = !1), !1);
                try {
                  const t = await e.json();
                  return ((this.config = { ...this.config, ...t }), (this.isAdmin = !0), !0);
                } catch {
                  return ((this.isAdmin = !1), !1);
                }
              })
              .catch(() => ((this.isAdmin = !1), !1))
              .finally(() => {
                this.checkPromise = null;
              })),
            this.checkPromise)
      : ((this.isAdmin = !1), !1);
  }
}
const te = new De(),
  u = "droppr-accounts-modal",
  re = "droppr-accounts-style",
  F = 8,
  Oe = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;
class ze {
  constructor() {}
  show() {
    (this.ensureStyles(), this.render());
  }
  ensureStyles() {
    if (document.getElementById(re)) return;
    const e = document.createElement("style");
    ((e.id = re),
      (e.textContent = `
      #${u} {
        position: fixed;
        inset: 0;
        z-index: 2147483002;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.6);
        padding: 24px;
        backdrop-filter: blur(4px);
      }
      #${u} .panel {
        width: 440px;
        max-width: calc(100vw - 48px);
        border-radius: 16px;
        background: var(--droppr-overlay-bg, rgba(17, 24, 39, 0.98));
        color: var(--text-primary, #e5e7eb);
        border: 1px solid var(--droppr-overlay-border, rgba(255,255,255,0.12));
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        overflow: hidden;
      }
      #${u} .hdr {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 20px 24px 16px 24px;
        border-bottom: 1px solid var(--droppr-overlay-border, rgba(255,255,255,0.08));
      }
      #${u} .title {
        font-size: 18px;
        font-weight: 700;
        color: var(--text-primary, #fff);
      }
      #${u} .subtitle {
        font-size: 13px;
        margin-top: 4px;
        color: var(--text-secondary, rgba(229,231,235,0.6));
      }
      #${u} .close {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--text-secondary, rgba(229,231,235,0.6));
        cursor: pointer;
        font-size: 24px;
        line-height: 1;
        padding: 4px;
        border-radius: 6px;
      }
      #${u} .close:hover {
        color: #fff;
        background: rgba(255,255,255,0.1);
      }
      #${u} .body {
        padding: 24px;
      }
      #${u} .label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 6px;
        color: var(--text-primary, #e5e7eb);
      }
      #${u} input[type="text"],
      #${u} input[type="password"] {
        display: block;
        width: 100%;
        margin-bottom: 16px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--border-color, rgba(255,255,255,0.15));
        background: var(--input-bg, rgba(0,0,0,0.3));
        color: var(--text-primary, #fff);
        font-size: 14px;
      }
      #${u} input:focus {
        border-color: rgba(99,102,241,0.8);
        outline: none;
        box-shadow: 0 0 0 2px rgba(99,102,241,0.25);
      }
      #${u} .password-meter {
        margin-bottom: 16px;
      }
      #${u} .password-meter .bar {
        height: 4px;
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
        margin-bottom: 6px;
        overflow: hidden;
      }
      #${u} .password-meter .bar span {
        display: block;
        height: 100%;
        width: 0%;
        transition: width 0.3s ease, background-color 0.3s ease;
      }
      #${u} .password-meter.weak .bar span { background: #ef4444; }
      #${u} .password-meter.medium .bar span { background: #f59e0b; }
      #${u} .password-meter.strong .bar span { background: #10b981; }
      #${u} .password-meter .label {
        font-size: 11px;
        color: var(--text-secondary, rgba(229,231,235,0.6));
        text-align: right;
        margin: 0;
        font-weight: 400;
      }
      #${u} .note {
        font-size: 13px;
        color: var(--text-secondary, rgba(229,231,235,0.7));
        margin-bottom: 20px;
        padding: 12px;
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
      }
      #${u} .status {
        font-size: 13px;
        margin-bottom: 16px;
        min-height: 20px;
      }
      #${u} .status.error { color: #ef4444; }
      #${u} .status.success { color: #10b981; }
      #${u} .actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }
      #${u} .btn {
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.2s;
      }
      #${u} .btn.secondary {
        background: transparent;
        color: var(--text-primary, #e5e7eb);
        border: 1px solid var(--border-color, rgba(255,255,255,0.15));
      }
      #${u} .btn.secondary:hover {
        background: rgba(255,255,255,0.05);
      }
      #${u} .btn.primary {
        background: rgba(99,102,241,0.95);
        color: white;
      }
      #${u} .btn.primary:hover {
        background: rgba(79,70,229,1);
        transform: translateY(-1px);
      }
      #${u} .btn[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none !important;
      }
    `),
      document.head.appendChild(e));
  }
  render() {
    const e = document.getElementById(u);
    e && e.parentNode && e.parentNode.removeChild(e);
    const t = document.createElement("div");
    t.id = u;
    const r = document.createElement("div");
    ((r.className = "panel"),
      (r.innerHTML = `
      <div class="hdr">
        <div>
          <div class="title">Create upload account</div>
          <div class="subtitle">Each account only sees its own folder.</div>
        </div>
        <button type="button" class="close" aria-label="Close">&times;</button>
      </div>
      <div class="body">
        <label class="label" for="droppr-account-username">Username</label>
        <input id="droppr-account-username" type="text" autocomplete="off" placeholder="letters, numbers, _ or -">
        
        <label class="label" for="droppr-account-password">Password</label>
        <input id="droppr-account-password" type="password" autocomplete="new-password" placeholder="at least ${F} characters">
        
        <div class="password-meter" id="droppr-account-meter">
          <div class="bar"><span></span></div>
          <div class="label" id="droppr-account-meter-label">Password strength</div>
        </div>
        
        <div class="note">Home folder: <span id="droppr-account-scope"></span></div>
        
        <div class="status" id="droppr-account-status" aria-live="polite"></div>
        
        <div class="actions">
          <button type="button" class="btn secondary" data-action="cancel">Cancel</button>
          <button type="button" class="btn primary" data-action="create">Create</button>
        </div>
      </div>
    `),
      t.appendChild(r),
      document.body.appendChild(t),
      this.bindEvents(r, t));
  }
  bindEvents(e, t) {
    const r = e.querySelector("#droppr-account-username"),
      n = e.querySelector("#droppr-account-password"),
      o = e.querySelector("#droppr-account-scope"),
      s = e.querySelector("#droppr-account-status"),
      l = e.querySelector(".close"),
      c = e.querySelector('[data-action="cancel"]'),
      i = e.querySelector('[data-action="create"]'),
      m = e.querySelector("#droppr-account-meter"),
      h = e.querySelector("#droppr-account-meter-label"),
      y = m ? m.querySelector(".bar span") : null,
      f = (x, E) => {
        s && ((s.textContent = x || ""), (s.className = "status" + (E ? " " + E : "")));
      },
      p = () => {
        if (!m || !h || !y || !n) return;
        const x = String(n.value || "");
        if (!x) {
          ((m.className = "password-meter"),
            (y.style.width = "0%"),
            (h.textContent = "Password strength"));
          return;
        }
        const E = [];
        (E.push({ ok: x.length >= F, label: "length" }),
          E.push({ ok: /[A-Z]/.test(x), label: "upper" }),
          E.push({ ok: /[a-z]/.test(x), label: "lower" }),
          E.push({ ok: /[0-9]/.test(x), label: "digit" }),
          E.push({ ok: /[^A-Za-z0-9]/.test(x), label: "symbol" }));
        const w = E.filter((C) => C.ok).length,
          S = E.length || 1,
          T = Math.round((w / S) * 100);
        y.style.width = T + "%";
        let _ = "Weak";
        ((m.className = "password-meter weak"),
          T >= 80
            ? ((_ = "Strong"), (m.className = "password-meter strong"))
            : T >= 50 && ((_ = "Medium"), (m.className = "password-meter medium")),
          (h.textContent = "Strength: " + _));
      },
      b = (x) => (x ? `/users/${x}` : "/users/..."),
      v = () => {
        !o || !r || (o.textContent = b(String(r.value || "").trim()));
      },
      $ = () => {
        t && t.parentNode && t.parentNode.removeChild(t);
      },
      P = async () => {
        if (!r || !n || !i) return;
        const x = String(r.value || "").trim(),
          E = String(n.value || "");
        if ((f("", ""), !Oe.test(x))) {
          f("Username must be 3-32 characters (letters, numbers, _ or -).", "error");
          return;
        }
        if (E.length < F) {
          f(`Password must be at least ${F} characters.`, "error");
          return;
        }
        i.disabled = !0;
        try {
          const w = await D("/api/droppr/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: x, password: E }),
          });
          let S = {};
          try {
            S = await w.json();
          } catch {}
          if (!w.ok) {
            const _ = S && S.error ? S.error : "Request failed (" + w.status + ")";
            throw new Error(_);
          }
          const T = S && S.scope ? S.scope : b(x);
          (f("Account created. Folder: " + T, "success"), (n.value = ""));
          try {
            r.select();
          } catch {}
        } catch (w) {
          const S = w instanceof Error ? w.message : String(w);
          f(S, "error");
        } finally {
          ((i.disabled = !0), (i.disabled = !1));
        }
      };
    (v(),
      p(),
      r == null || r.addEventListener("input", v),
      n == null || n.addEventListener("input", p),
      l == null || l.addEventListener("click", $),
      c == null || c.addEventListener("click", $),
      t.addEventListener("click", (x) => {
        x.target === t && $();
      }),
      e.addEventListener("keydown", (x) => {
        x.key === "Enter" && (x.preventDefault(), P());
      }),
      i == null || i.addEventListener("click", P));
    try {
      r == null || r.focus();
    } catch {}
  }
}
const d = "droppr-request-modal",
  ne = "droppr-request-style",
  He = "droppr_request_expire_hours";
class Me {
  constructor() {}
  show() {
    (this.ensureStyles(), this.render());
  }
  ensureStyles() {
    if (document.getElementById(ne)) return;
    const e = document.createElement("style");
    ((e.id = ne),
      (e.textContent = `
      #${d} {
        position: fixed;
        inset: 0;
        z-index: 2147483002;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(2, 6, 23, 0.6);
        padding: 24px;
        backdrop-filter: blur(4px);
      }
      #${d} .panel {
        width: 520px;
        max-width: calc(100vw - 48px);
        border-radius: 16px;
        background: var(--droppr-overlay-bg, rgba(17, 24, 39, 0.98));
        color: var(--text-primary, #e5e7eb);
        border: 1px solid var(--droppr-overlay-border, rgba(255,255,255,0.12));
        box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        overflow: hidden;
      }
      #${d} .hdr {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 20px 24px 16px 24px;
        border-bottom: 1px solid var(--droppr-overlay-border, rgba(255,255,255,0.08));
      }
      #${d} .title {
        font-size: 18px;
        font-weight: 700;
        color: var(--text-primary, #fff);
      }
      #${d} .subtitle {
        font-size: 13px;
        margin-top: 4px;
        color: var(--text-secondary, rgba(229,231,235,0.6));
      }
      #${d} .close {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--text-secondary, rgba(229,231,235,0.6));
        cursor: pointer;
        font-size: 24px;
        line-height: 1;
        padding: 4px;
        border-radius: 6px;
      }
      #${d} .close:hover {
        color: #fff;
        background: rgba(255,255,255,0.1);
      }
      #${d} .body {
        padding: 24px;
      }
      #${d} .label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 6px;
        color: var(--text-primary, #e5e7eb);
      }
      #${d} input[type="text"],
      #${d} input[type="password"],
      #${d} input[type="number"] {
        display: block;
        width: 100%;
        margin-bottom: 16px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--border-color, rgba(255,255,255,0.15));
        background: var(--input-bg, rgba(0,0,0,0.3));
        color: var(--text-primary, #fff);
        font-size: 14px;
      }
      #${d} input:focus {
        border-color: rgba(99,102,241,0.8);
        outline: none;
        box-shadow: 0 0 0 2px rgba(99,102,241,0.25);
      }
      #${d} .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }
      #${d} .switch {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
      }
      #${d} .switch input { opacity: 0; width: 0; height: 0; }
      #${d} .slider {
        position: absolute;
        cursor: pointer;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(255,255,255,0.1);
        transition: .4s;
        border-radius: 24px;
      }
      #${d} .slider:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: .4s;
        border-radius: 50%;
      }
      #${d} input:checked + .slider { background-color: #6366f1; }
      #${d} input:checked + .slider:before { transform: translateX(20px); }
      #${d} .password-wrap {
        display: none;
      }
      #${d} .password-wrap.show {
        display: block;
      }
      #${d} .status {
        font-size: 13px;
        margin-bottom: 16px;
        min-height: 20px;
      }
      #${d} .status.error { color: #ef4444; }
      #${d} .status.success { color: #10b981; }
      #${d} .result {
        display: none;
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--border-color, rgba(255,255,255,0.1));
      }
      #${d} .result.show { display: block; }
      #${d} .link-row {
        display: flex;
        gap: 8px;
      }
      #${d} .link-row input { margin-bottom: 0; }
      #${d} .actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 24px;
      }
      #${d} .btn {
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.2s;
      }
      #${d} .btn.secondary {
        background: transparent;
        color: var(--text-primary, #e5e7eb);
        border: 1px solid var(--border-color, rgba(255,255,255,0.15));
      }
      #${d} .btn.secondary:hover {
        background: rgba(255,255,255,0.05);
      }
      #${d} .btn.primary {
        background: rgba(99,102,241,0.95);
        color: white;
      }
      #${d} .btn.primary:hover {
        background: rgba(79,70,229,1);
        transform: translateY(-1px);
      }
      #${d} .btn[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `),
      document.head.appendChild(e));
  }
  render() {
    const e = document.getElementById(d);
    e && e.parentNode && e.parentNode.removeChild(e);
    const t = document.createElement("div");
    t.id = d;
    const r = document.createElement("div");
    ((r.className = "panel"),
      (r.innerHTML = `
      <div class="hdr">
        <div>
          <div class="title">Create file request</div>
          <div class="subtitle">Recipients can upload without seeing other files.</div>
        </div>
        <button type="button" class="close" aria-label="Close">&times;</button>
      </div>
      <div class="body">
        <label class="label" for="droppr-request-path">Folder path</label>
        <input id="droppr-request-path" type="text" autocomplete="off" placeholder="/uploads/team-a">
        
        <label class="label" for="droppr-request-expire">Expires in hours (0 = never)</label>
        <input id="droppr-request-expire" type="number" min="0" step="1" inputmode="numeric">
        
        <div class="row">
          <span class="label">Password protection</span>
          <label class="switch">
            <input id="droppr-request-password-toggle" type="checkbox">
            <span class="slider"></span>
          </label>
        </div>
        
        <div class="password-wrap" id="droppr-request-password-wrap">
          <input id="droppr-request-password" type="password" autocomplete="new-password" placeholder="Optional password">
        </div>
        
        <div class="status" id="droppr-request-status" aria-live="polite"></div>
        
        <div class="result" id="droppr-request-result">
          <div class="label">Request link</div>
          <div class="link-row">
            <input id="droppr-request-link" type="text" readonly>
            <button type="button" class="btn secondary" data-action="copy">Copy</button>
            <button type="button" class="btn secondary" data-action="open">Open</button>
          </div>
        </div>
        
        <div class="actions">
          <button type="button" class="btn secondary" data-action="cancel">Cancel</button>
          <button type="button" class="btn primary" data-action="create">Create link</button>
        </div>
      </div>
    `),
      t.appendChild(r),
      document.body.appendChild(t),
      this.bindEvents(r, t));
  }
  bindEvents(e, t) {
    const r = e.querySelector("#droppr-request-path"),
      n = e.querySelector("#droppr-request-expire"),
      o = e.querySelector("#droppr-request-password-toggle"),
      s = e.querySelector("#droppr-request-password-wrap"),
      l = e.querySelector("#droppr-request-password"),
      c = e.querySelector("#droppr-request-status"),
      i = e.querySelector("#droppr-request-result"),
      m = e.querySelector("#droppr-request-link"),
      h = e.querySelector(".close"),
      y = e.querySelector('[data-action="cancel"]'),
      f = e.querySelector('[data-action="create"]'),
      p = e.querySelector('[data-action="copy"]'),
      b = e.querySelector('[data-action="open"]'),
      v = (w, S) => {
        c && ((c.textContent = w || ""), (c.className = "status" + (S ? " " + S : "")));
      },
      $ = (w) => {
        !i || !m || ((m.value = w || ""), i.classList.add("show"));
      },
      P = () => {
        t && t.parentNode && t.parentNode.removeChild(t);
      },
      x = () => {
        !o || !s || (o.checked ? s.classList.add("show") : s.classList.remove("show"));
      },
      E = async () => {
        if (!r || !n || !f) return;
        let w = String(r.value || "").trim();
        if (!w) {
          v("Folder path is required.", "error");
          return;
        }
        w.charAt(0) !== "/" && (w = "/" + w);
        const S = String(n.value || "0").trim(),
          T = parseInt(S, 10);
        if (isNaN(T) || T < 0) {
          v("Expiration must be 0 or a positive number.", "error");
          return;
        }
        let _ = "";
        if (o && o.checked && ((_ = String(l.value || "")), !_)) {
          v("Password cannot be empty when enabled.", "error");
          return;
        }
        try {
          localStorage.setItem(He, String(T));
        } catch {}
        ((f.disabled = !0), v("Creating request link...", ""));
        try {
          const C = await D("/api/droppr/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: w, expires_hours: T, password: _ }),
          });
          let A = {};
          try {
            A = await C.json();
          } catch {}
          if (!C.ok) {
            const J = A && A.error ? A.error : "Request failed (" + C.status + ")";
            throw new Error(J);
          }
          const Ce = A && A.url ? A.url : "/request/" + (A.hash || ""),
            Ae = window.location.origin + Ce;
          (v("Request link ready.", "success"), $(Ae));
        } catch (C) {
          const A = C instanceof Error ? C.message : String(C);
          v(A, "error");
        } finally {
          f.disabled = !1;
        }
      };
    (o == null || o.addEventListener("change", x),
      h == null || h.addEventListener("click", P),
      y == null || y.addEventListener("click", P),
      p == null ||
        p.addEventListener("click", async () => {
          try {
            (await navigator.clipboard.writeText(m.value),
              (p.textContent = "Copied"),
              setTimeout(() => (p.textContent = "Copy"), 1500));
          } catch {
            (m.select(), document.execCommand("copy"));
          }
        }),
      b == null ||
        b.addEventListener("click", () => {
          window.open(m.value, "_blank");
        }),
      f == null || f.addEventListener("click", E),
      t.addEventListener("click", (w) => {
        w.target === t && P();
      }));
  }
}
const R = "droppr-stream-btn",
  oe = "droppr-stream-style",
  N = "droppr-accounts-btn",
  se = "droppr-accounts-style",
  q = "droppr-request-btn",
  ae = "droppr-request-style";
class Fe {
  constructor() {
    g(this, "accountsModal", new ze());
    g(this, "requestModal", new Me());
    g(this, "observer", null);
    (this.ensureStreamStyles(),
      this.ensureAccountsStyles(),
      this.ensureRequestStyles(),
      this.startWatcher());
  }
  startWatcher() {
    this.checkButtons();
    let e = window.location.pathname;
    ((this.observer = new MutationObserver(() => {
      window.location.pathname !== e
        ? ((e = window.location.pathname), this.checkButtons())
        : this.checkButtons();
    })),
      this.observer.observe(document.body, { childList: !0, subtree: !0 }));
  }
  checkButtons() {
    (this.ensureStreamButton(), this.ensureAccountsButton(), this.ensureRequestButton());
  }
  ensureStreamStyles() {
    if (document.getElementById(oe)) return;
    const e = document.createElement("style");
    ((e.id = oe),
      (e.textContent = `
      #${R} {
        position: fixed;
        bottom: 76px;
        right: 16px;
        z-index: 9999;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 10px 14px;
        background: #6366f1;
        color: #fff;
        border: none;
        border-radius: 24px;
        font-size: 13px;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
        transition: all 0.2s ease;
      }
      #${R}:hover {
        background: #818cf8;
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(99, 102, 241, 0.5);
      }
      #${R} .icon {
        width: 18px;
        height: 18px;
      }
      #${R} .label {
        line-height: 1;
      }
    `),
      document.head.appendChild(e));
  }
  getShareHashFromUrl() {
    const t = (window.location.pathname || "").match(/^\/(?:gallery|media)\/([A-Za-z0-9_-]+)/);
    if (t) return t[1];
    const n = new URLSearchParams(window.location.search).get("share");
    return n && /^[A-Za-z0-9_-]+$/.test(n) ? n : null;
  }
  ensureStreamButton() {
    const e = document.getElementById(R),
      t = this.getShareHashFromUrl();
    if (!t) {
      e && e.parentNode && e.parentNode.removeChild(e);
      return;
    }
    if (e) {
      e.href = "/stream/" + t;
      return;
    }
    const r = document.createElement("a");
    ((r.id = R),
      (r.href = "/stream/" + t),
      (r.target = "_blank"),
      (r.rel = "noopener"),
      (r.title = "Open Stream Gallery (optimized video player for large files)"),
      (r.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M8 5v14l11-7z"/>
      </svg>
      <span class="label">Stream</span>
    `),
      document.body.appendChild(r));
  }
  ensureAccountsStyles() {
    if (document.getElementById(se)) return;
    const e = document.createElement("style");
    ((e.id = se),
      (e.textContent = `
      #${N} {
        position: fixed;
        right: 18px;
        bottom: 66px;
        z-index: 2147483000;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 999px;
        background: rgba(16, 185, 129, 0.95);
        color: #fff !important;
        text-decoration: none !important;
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        font-weight: 700;
        letter-spacing: -0.01em;
        box-shadow: 0 18px 40px -18px rgba(0,0,0,0.65);
        border: 1px solid rgba(255,255,255,0.18);
        user-select: none;
        cursor: pointer;
      }
      #${N}:hover {
        background: rgba(5, 150, 105, 0.98);
        transform: translateY(-1px);
      }
      #${N} .icon {
        width: 18px;
        height: 18px;
        display: inline-block;
      }
      #${N} .label {
        font-size: 14px;
        line-height: 1;
      }
    `),
      document.head.appendChild(e));
  }
  isFilesPage() {
    return window.location.pathname.startsWith("/files");
  }
  async ensureAccountsButton() {
    const e = document.getElementById(N);
    if (!B() || !this.isFilesPage()) {
      e && e.parentNode && e.parentNode.removeChild(e);
      return;
    }
    if (!(await te.check())) {
      e && e.parentNode && e.parentNode.removeChild(e);
      return;
    }
    if (e) return;
    const r = document.createElement("button");
    ((r.id = N),
      (r.type = "button"),
      (r.title = "Create upload account"),
      r.setAttribute("aria-label", "Create upload account"),
      (r.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M15 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm-6 0c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm6 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4zm-6 0c-.3 0-.8 0-1.3.1 1.8 1.2 2.3 2.7 2.3 3.9v2H2v-2c0-2 3.6-4 7-4zm11-2v-2h-2V8h-2v2h-2v2h2v2h2v-2h2z"/>
      </svg>
      <span class="label">Accounts</span>
    `),
      r.addEventListener("click", () => this.accountsModal.show()),
      document.body.appendChild(r));
  }
  ensureRequestStyles() {
    if (document.getElementById(ae)) return;
    const e = document.createElement("style");
    ((e.id = ae),
      (e.textContent = `
      #${q} {
        position: fixed;
        right: 18px;
        bottom: 114px;
        z-index: 2147483000;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-radius: 999px;
        background: rgba(0, 97, 255, 0.95);
        color: #fff !important;
        text-decoration: none !important;
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        font-weight: 700;
        letter-spacing: -0.01em;
        box-shadow: 0 18px 40px -18px rgba(0,97,255,0.55);
        border: 1px solid rgba(255,255,255,0.18);
        user-select: none;
        cursor: pointer;
      }
      #${q}:hover {
        background: rgba(11, 95, 255, 0.98);
        transform: translateY(-1px);
      }
      #${q} .icon {
        width: 18px;
        height: 18px;
        display: inline-block;
      }
      #${q} .label {
        font-size: 14px;
        line-height: 1;
      }
    `),
      document.head.appendChild(e));
  }
  async ensureRequestButton() {
    const e = document.getElementById(q);
    if (!B() || !this.isFilesPage()) {
      e && e.parentNode && e.parentNode.removeChild(e);
      return;
    }
    if (!(await te.check())) {
      e && e.parentNode && e.parentNode.removeChild(e);
      return;
    }
    if (e) return;
    const r = document.createElement("button");
    ((r.id = q),
      (r.type = "button"),
      (r.title = "Create file request"),
      r.setAttribute("aria-label", "Create file request"),
      (r.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12 3l4 4h-3v7h-2V7H8l4-4zm-7 9h2v7h10v-7h2v9H5v-9z"/>
      </svg>
      <span class="label">Request</span>
    `),
      r.addEventListener("click", () => this.requestModal.show()),
      document.body.appendChild(r));
  }
}
function je(a) {
  return navigator.clipboard && navigator.clipboard.writeText
    ? navigator.clipboard.writeText(a).catch(() => ie(a))
    : ie(a);
}
function ie(a) {
  return new Promise((e, t) => {
    try {
      const r = document.createElement("textarea");
      if (
        ((r.value = a),
        r.setAttribute("readonly", ""),
        (r.style.cssText =
          "position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent;font-size:16px;"),
        document.body.appendChild(r),
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
      ) {
        const s = document.createRange();
        s.selectNodeContents(r);
        const l = window.getSelection();
        (l == null || l.removeAllRanges(),
          l == null || l.addRange(s),
          r.setSelectionRange(0, a.length));
      } else (r.focus(), r.select());
      const o = document.execCommand("copy");
      if ((document.body.removeChild(r), !o)) return t(new Error("Copy failed"));
      e();
    } catch (r) {
      t(r);
    }
  });
}
const le = "droppr-auto-share-style",
  k = "droppr-auto-share-modal";
class Ye {
  constructor() {
    this.ensureStyles();
  }
  ensureStyles() {
    if (document.getElementById(le)) return;
    const e = document.createElement("style");
    ((e.id = le),
      (e.textContent = `
      #${k} {
        position: fixed;
        right: 18px;
        bottom: 74px;
        z-index: 2147483001;
        width: 460px;
        max-width: calc(100vw - 36px);
        border-radius: 14px;
        background: var(--droppr-overlay-bg, rgba(17, 24, 39, 0.98));
        color: var(--text-primary, #e5e7eb);
        border: 1px solid var(--droppr-overlay-border, rgba(255,255,255,0.12));
        box-shadow: 0 26px 60px -30px rgba(0,0,0,0.85);
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        overflow: hidden;
      }
      #${k} .hdr {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 14px 8px 14px;
      }
      #${k} .title {
        font-size: 14px;
        font-weight: 800;
        line-height: 1.2;
        color: var(--text-primary, #fff);
      }
      #${k} .subtitle {
        font-size: 12px;
        line-height: 1.2;
        margin-top: 4px;
        color: var(--droppr-overlay-muted, rgba(229,231,235,0.8));
        word-break: break-word;
      }
      #${k} .close {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--droppr-overlay-muted, rgba(229,231,235,0.85));
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 6px 8px;
        border-radius: 10px;
      }
      #${k} .close:hover {
        background: var(--hover-bg, rgba(255,255,255,0.08));
      }
      #${k} .body {
        padding: 0 14px 14px 14px;
      }
      #${k} .row {
        display: flex;
        gap: 10px;
        align-items: center;
      }
      #${k} input {
        flex: 1 1 auto;
        width: 100%;
        border-radius: 10px;
        border: 1px solid var(--border-color, rgba(255,255,255,0.12));
        background: var(--input-bg, rgba(0,0,0,0.22));
        padding: 10px 10px;
        color: var(--text-primary, #fff);
        font-size: 13px;
        outline: none;
      }
      #${k} .btn {
        flex: 0 0 auto;
        cursor: pointer;
        border: 1px solid var(--border-color, rgba(255,255,255,0.12));
        background: var(--accent-color, rgba(99, 102, 241, 0.95));
        color: #fff;
        font-weight: 800;
        font-size: 13px;
        padding: 10px 12px;
        border-radius: 10px;
      }
      #${k} .btn.secondary {
        background: var(--hover-bg, rgba(255,255,255,0.08));
        color: var(--text-primary, #fff);
      }
      #${k} .note {
        margin-top: 10px;
        font-size: 12px;
        color: var(--text-secondary, rgba(229,231,235,0.72));
      }
    `),
      document.head.appendChild(e));
  }
  show(e) {
    this.dismiss();
    const t = e.url || e.streamUrl || e.openUrl || "",
      r = e.openUrl || t,
      n = document.createElement("div");
    ((n.id = k),
      (n.innerHTML = `
      <div class="hdr">
        <div>
          <div class="title">${e.title || "Share link ready"}</div>
          ${e.subtitle ? `<div class="subtitle">${e.subtitle}</div>` : ""}
        </div>
        <button type="button" class="close" aria-label="Close">&times;</button>
      </div>
      <div class="body">
        ${e.urlLabel ? `<div style="font-size:0.8rem; color:var(--text-muted, #888); margin-bottom:0.35rem;">${e.urlLabel}</div>` : ""}
        <div class="row">
          <input type="text" readonly value="${t}">
          <button type="button" class="btn" data-action="copy">Copy</button>
          <button type="button" class="btn secondary" data-action="open">Open</button>
        </div>
        ${e.note ? `<div class="note">${e.note}</div>` : ""}
      </div>
    `),
      document.body.appendChild(n));
    const o = n.querySelector(".close"),
      s = n.querySelector('[data-action="copy"]'),
      l = n.querySelector('[data-action="open"]'),
      c = n.querySelector("input");
    (o == null || o.addEventListener("click", () => this.dismiss()),
      c == null || c.addEventListener("focus", () => c.select()),
      s == null ||
        s.addEventListener("click", async () => {
          try {
            (await je(c.value),
              (s.textContent = "Copied"),
              setTimeout(() => {
                document.body.contains(s) && (s.textContent = "Copy");
              }, 1200));
          } catch {
            (c.focus(), c.select());
          }
        }),
      l == null ||
        l.addEventListener("click", () => {
          window.open(r, "_blank", "noopener");
        }),
      e.autoCopy && s.click());
  }
  dismiss() {
    const e = document.getElementById(k);
    e && e.parentNode && e.parentNode.removeChild(e);
  }
}
class We {
  constructor() {
    g(this, "uploadBatch", null);
    g(this, "lastAutoSharedPath", null);
    g(this, "lastAutoSharedAt", 0);
    g(this, "autoShareModal", new Ye());
  }
  recordUploadStart(e) {
    this.startUploadBatch();
    const t = { path: e, ok: !1, done: !1 };
    return (
      this.uploadBatch && ((this.uploadBatch.pending += 1), this.uploadBatch.items.push(t)),
      t
    );
  }
  recordUploadDone(e, t) {
    if (
      this.uploadBatch &&
      ((e.done = !0),
      (e.ok = t),
      (this.uploadBatch.pending = Math.max(0, this.uploadBatch.pending - 1)),
      this.uploadBatch.pending === 0)
    ) {
      const r = this.uploadBatch;
      this.uploadBatch.timer = window.setTimeout(() => {
        this.finalizeUploadBatch(r);
      }, 700);
    }
  }
  startUploadBatch() {
    if (!this.uploadBatch) {
      this.uploadBatch = { pending: 0, items: [], timer: null };
      return;
    }
    this.uploadBatch.timer &&
      (clearTimeout(this.uploadBatch.timer), (this.uploadBatch.timer = null));
  }
  async finalizeUploadBatch(e) {
    if (!e || this.uploadBatch !== e) return;
    this.uploadBatch = null;
    const t = {},
      r = {};
    e.items.forEach((c) => {
      c.path && ((t[c.path] = !0), c.ok && (r[c.path] = !0));
    });
    const n = Object.keys(t),
      o = Object.keys(r);
    if (n.length !== 1 || o.length !== 1) return;
    const s = o[0],
      l = Date.now();
    if (!(this.lastAutoSharedPath === s && l - this.lastAutoSharedAt < 5e3)) {
      ((this.lastAutoSharedPath = s), (this.lastAutoSharedAt = l));
      try {
        const c = await this.createShare(s),
          i = window.location.origin + "/stream/" + c.hash,
          m = decodeURIComponent(String(s).split("/").pop() || "");
        this.autoShareModal.show({
          title: "Share link ready",
          subtitle: m ? `Uploaded: ${m}` : "",
          urlLabel: "Stream Gallery (best for big videos):",
          url: i,
          openUrl: i,
          note: "Recipients can view without logging in.",
          autoCopy: !0,
        });
      } catch (c) {
        const i = c instanceof Error ? c.message : String(c);
        this.autoShareModal.show({
          title: "Upload complete",
          subtitle: "Could not create share link",
          url: "",
          note: i,
          autoCopy: !1,
        });
      }
    }
  }
  async createShare(e) {
    const t = z();
    if (!t) throw new Error("Not logged in");
    const r = (o) => {
        let s = String(o || "");
        return (
          s && s.charAt(0) !== "/" && (s = "/" + s),
          (s = s.replace(/^\/+/, "/")),
          s
            .split("/")
            .map((c) => (c === "" ? "" : encodeURIComponent(c)))
            .join("/")
        );
      },
      n = async (o) => {
        const s = await fetch("/api/share" + o, {
            method: "POST",
            headers: { "X-Auth": t, "Content-Type": "application/json" },
            body: JSON.stringify({ expires: "", password: "" }),
          }),
          l = await s.text();
        if (!s.ok) throw new Error("Share API failed (" + s.status + "): " + (l || ""));
        const c = JSON.parse(l);
        if (!c || !c.hash) throw new Error("Share response missing hash");
        return c;
      };
    try {
      return await n(e);
    } catch (o) {
      if (String(e || "").indexOf("%2F") === -1) throw o;
      let s;
      try {
        s = decodeURIComponent(String(e));
      } catch {
        throw o;
      }
      const l = r(s);
      if (!l || l === e) throw o;
      return await n(l);
    }
  }
}
const I = new We();
function Xe(a) {
  try {
    return new URL(a, window.location.href);
  } catch {
    return null;
  }
}
function Te(a, e) {
  const t = Xe(a);
  return t
    ? t.pathname === e
      ? ""
      : t.pathname.indexOf(e + "/") !== 0
        ? null
        : t.pathname.substring(e.length)
    : null;
}
function O(a) {
  let e = String(a || "");
  return e === ""
    ? "/"
    : (e.charAt(0) !== "/" && (e = "/" + e),
      e.length > 1 && e.charAt(e.length - 1) === "/" && (e = e.slice(0, -1)),
      e);
}
function Ve(a) {
  let e = String(a || "");
  return ((e = e.split("/").pop() || e), (e = e.split("\\").pop() || e), e);
}
function Ge(a, e) {
  if (!a || !e) return !1;
  const t = String(a).split("/").pop() || "";
  try {
    if (decodeURIComponent(t) === e) return !0;
  } catch {}
  return t === encodeURIComponent(e);
}
function Je(a, e) {
  const t = O(a),
    r = Ve(e),
    n = encodeURIComponent(r);
  return t === "/" ? "/" + n : t + "/" + n;
}
function Ke(a) {
  return Te(a, "/api/resources");
}
function Ze(a) {
  return Te(a, "/api/tus");
}
function Qe(a) {
  return a
    ? (typeof FormData < "u" && a instanceof FormData) ||
        (typeof Blob < "u" && a instanceof Blob) ||
        (typeof ArrayBuffer < "u" && a instanceof ArrayBuffer) ||
        (typeof Uint8Array < "u" && a instanceof Uint8Array)
    : !1;
}
function et(a) {
  const e = [],
    t = {},
    r = (n) => {
      n && (t[n] || ((t[n] = !0), e.push(n)));
    };
  if (!a) return e;
  if (typeof FormData < "u" && a instanceof FormData) {
    try {
      const n = a.entries();
      let o = n.next();
      for (; !o.done; ) {
        const s = o.value && o.value[1];
        (s && typeof s == "object" && typeof s.name == "string" && r(s.name), (o = n.next()));
      }
    } catch {}
    return e;
  }
  return (a && typeof a == "object" && typeof a.name == "string" && r(a.name), e);
}
class tt {
  constructor() {
    g(this, "tusUploads", {});
    (this.interceptXhr(), this.interceptFetch());
  }
  interceptFetch() {
    if (!window.fetch) return;
    const e = window.fetch;
    window.fetch = (t, r) => {
      let n = "",
        o = "GET",
        s = null,
        l = null;
      (typeof t == "string"
        ? (n = t)
        : t instanceof URL
          ? (n = t.href)
          : t && typeof t == "object" && ((n = t.url), (o = t.method || o), (l = t.headers || l)),
        r && (r.method && (o = r.method), r.body && (s = r.body), r.headers && (l = r.headers)));
      const c = String(o || "GET").toUpperCase();
      let i = null;
      const m = this.getTusUploadPath(n);
      if (
        m &&
        (c === "POST" || c === "PATCH") &&
        ((i = this.ensureTusEntry(m)), i && c === "POST" && i.uploadLength == null)
      ) {
        const p = this.getHeaderValue(l, "Upload-Length");
        i.uploadLength = p ? parseInt(p, 10) : null;
      }
      const h = [],
        y = this.getResourceUploadPaths(n, o, s);
      for (let p = 0; p < y.length; p++) h.push(I.recordUploadStart(y[p]));
      const f = e(t, r);
      return !i && h.length === 0
        ? f
        : f.then(
            (p) => {
              if (i)
                return !p || !p.ok
                  ? (this.finishTusEntry(i, !1), p)
                  : c === "POST"
                    ? (i.uploadLength === 0 && this.finishTusEntry(i, !0), p)
                    : (c === "PATCH" &&
                        this.handleTusPatchProgress(
                          i,
                          p.headers ? p.headers.get("Upload-Offset") : null,
                          p.headers ? p.headers.get("Upload-Length") : null
                        ),
                      p);
              for (let b = 0; b < h.length; b++) I.recordUploadDone(h[b], p && p.ok);
              return p;
            },
            (p) => {
              if (i) this.finishTusEntry(i, !1);
              else for (let b = 0; b < h.length; b++) I.recordUploadDone(h[b], !1);
              throw p;
            }
          );
    };
  }
  getHeaderValue(e, t) {
    if (!e) return null;
    const r = t.toLowerCase();
    if (e instanceof Headers) return e.get(r);
    if (Array.isArray(e)) {
      for (const [n, o] of e) if (n.toLowerCase() === r) return o;
    }
    if (typeof e == "object") {
      for (const n in e) if (n.toLowerCase() === r) return e[n];
    }
    return null;
  }
  interceptXhr() {
    const e = window.XMLHttpRequest.prototype.open,
      t = window.XMLHttpRequest.prototype.send,
      r = window.XMLHttpRequest.prototype.setRequestHeader,
      n = this;
    ((window.XMLHttpRequest.prototype.open = function (o, s, ...l) {
      return (
        (this.__dropprMethod = o),
        (this.__dropprUrl = s),
        (this.__dropprHeaders = {}),
        e.apply(this, [o, s, ...l])
      );
    }),
      (window.XMLHttpRequest.prototype.setRequestHeader = function (o, s) {
        try {
          this.__dropprHeaders && o && (this.__dropprHeaders[String(o).toLowerCase()] = s);
        } catch {}
        return r.apply(this, [o, s]);
      }),
      (window.XMLHttpRequest.prototype.send = function (o) {
        const s = this.__dropprMethod || "GET",
          l = String(this.__dropprUrl || ""),
          c = String(s).toUpperCase();
        let i = null;
        const m = n.getTusUploadPath(l);
        if (
          m &&
          (c === "POST" || c === "PATCH") &&
          ((i = n.ensureTusEntry(m)), i && c === "POST" && i.uploadLength == null)
        ) {
          const f = this.__dropprHeaders && this.__dropprHeaders["upload-length"];
          i.uploadLength = f ? parseInt(f, 10) : null;
        }
        const h = [],
          y = n.getResourceUploadPaths(l, s, o);
        for (let f = 0; f < y.length; f++) h.push(I.recordUploadStart(y[f]));
        if (i || h.length) {
          const f = this,
            p = function () {
              f.removeEventListener("loadend", p);
              const b = f.status >= 200 && f.status < 300;
              if (i) {
                if (!b) {
                  n.finishTusEntry(i, !1);
                  return;
                }
                if (c === "POST") {
                  i.uploadLength === 0 && n.finishTusEntry(i, !0);
                  return;
                }
                if (c === "PATCH") {
                  const v = f.getResponseHeader("Upload-Offset"),
                    $ = f.getResponseHeader("Upload-Length");
                  n.handleTusPatchProgress(i, v, $);
                }
                return;
              }
              for (let v = 0; v < h.length; v++) I.recordUploadDone(h[v], b);
            };
          f.addEventListener("loadend", p);
        }
        return t.apply(this, [o]);
      }));
  }
  getTusUploadPath(e) {
    const t = Ze(e);
    if (t == null) return null;
    const r = O(t);
    return !r || r === "/" ? null : r;
  }
  ensureTusEntry(e) {
    const t = O(e);
    if (!t || t === "/") return null;
    const r = this.tusUploads[t];
    if (r && r.item && !r.item.done) return r;
    const n = I.recordUploadStart(t),
      o = { path: t, item: n, uploadLength: null, lastSeenAt: 0, timer: null };
    return ((this.tusUploads[t] = o), o);
  }
  finishTusEntry(e, t) {
    !e ||
      !e.item ||
      e.item.done ||
      (e.timer && (clearTimeout(e.timer), (e.timer = null)),
      delete this.tusUploads[e.path],
      I.recordUploadDone(e.item, t));
  }
  handleTusPatchProgress(e, t, r) {
    if (!e || !e.item || e.item.done) return;
    const n = t ? parseInt(t, 10) : null,
      o = r ? parseInt(r, 10) : null;
    o != null && (e.uploadLength = o);
    const s = o ?? e.uploadLength;
    if (n != null && s != null && s >= 0 && n >= s) {
      this.finishTusEntry(e, !0);
      return;
    }
    this.scheduleTusIdleComplete(e);
  }
  scheduleTusIdleComplete(e) {
    if (!e || !e.item || e.item.done) return;
    const t = 1800;
    ((e.lastSeenAt = Date.now()),
      e.timer && clearTimeout(e.timer),
      (e.timer = window.setTimeout(() => {
        if (!e || !e.item || e.item.done) return;
        if (Date.now() - e.lastSeenAt < t) {
          this.scheduleTusIdleComplete(e);
          return;
        }
        this.finishTusEntry(e, !0);
      }, t)));
  }
  getResourceUploadPaths(e, t, r) {
    const n = String(t).toUpperCase();
    if (n !== "POST" && n !== "PUT") return [];
    const o = Ke(e);
    if (o == null) return [];
    if (!Qe(r)) return [];
    const s = et(r),
      l = O(o);
    return s.length
      ? s.length === 1 && o && o !== "/" && Ge(o, s[0])
        ? [O(o)]
        : s.map((c) => Je(l, c))
      : l === "/"
        ? []
        : [l];
  }
}
function G() {
  try {
    return /(?:^|[?&])dropprDebug=1(?:&|$)/.test(
      String(window.location && window.location.search) || ""
    );
  } catch {
    return !1;
  }
}
class rt {
  constructor() {
    g(this, "cache", {});
    g(this, "inFlight", {});
    g(this, "debugStats", { ok: 0, notFound: 0, unauth: 0, other: 0 });
  }
  async fetch(e) {
    if (this.cache[e] !== void 0) return this.cache[e];
    if (this.inFlight[e]) return null;
    this.inFlight[e] = !0;
    try {
      const t = await D(`/api/droppr/video-meta?path=${encodeURIComponent(e)}`, {
        cache: "no-store",
      });
      if (
        (G() &&
          (t.status === 200
            ? this.debugStats.ok++
            : t.status === 404
              ? this.debugStats.notFound++
              : t.status === 401 || t.status === 403
                ? this.debugStats.unauth++
                : this.debugStats.other++),
        !t.ok)
      )
        return ((this.cache[e] = null), null);
      const r = await t.json();
      return ((this.cache[e] = r), r);
    } catch {
      return ((this.cache[e] = null), null);
    } finally {
      delete this.inFlight[e];
    }
  }
  getCached(e) {
    return this.cache[e];
  }
  isInFlight(e) {
    return !!this.inFlight[e];
  }
}
const j = new rt(),
  ce = "droppr-debug-badge",
  nt = "30";
class ot {
  constructor() {
    g(this, "el", null);
    this.el = this.ensureElement();
  }
  ensureElement() {
    if (!G()) return null;
    const e = document.getElementById(ce);
    if (e) return e;
    const t = document.createElement("div");
    return (
      (t.id = ce),
      (t.style.cssText =
        "position:fixed;left:10px;bottom:10px;z-index:2147483647;max-width:min(92vw, 520px);padding:8px 10px;border-radius:12px;background:rgba(2,6,23,0.88);border:1px solid rgba(255,255,255,0.14);color:rgba(241,245,249,0.96);font:12px/1.35 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 18px 40px -18px rgba(0,0,0,0.75);user-select:text;cursor:text;"),
      (t.textContent = `Dropbox enhancements v${nt} loading…`),
      document.body.appendChild(t),
      t
    );
  }
  setText(e) {
    this.el && (this.el.textContent = e);
  }
}
const st = new ot(),
  de = "droppr-video-meta-style",
  U = "droppr-video-meta-inline",
  at = "droppr-video-details-row",
  pe = "droppr-video-thumb-style",
  Y = "droppr-video-thumb",
  ue = 96;
class it {
  constructor() {
    g(this, "hydrateTimer", null);
    g(this, "lastPathname", null);
    g(this, "observer", null);
    (this.ensureStyles(), this.startWatcher());
  }
  ensureStyles() {
    if (document.getElementById(de)) return;
    const e = document.createElement("style");
    if (
      ((e.id = de),
      (e.textContent = `
      .${U} {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px 8px;
        font-size: 11px;
        line-height: 1.3;
        color: var(--text-secondary, rgba(229,231,235,0.6));
        background: rgba(255,255,255,0.03);
        border-radius: 4px;
        margin-top: 4px;
        pointer-events: none;
      }
      .${U} .line {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .${U} .line.muted { opacity: 0.6; }
      
      /* Grid view adjustments */
      .item.item-grid .${U} {
        position: absolute;
        bottom: 0; left: 0; right: 0;
        background: rgba(0,0,0,0.65);
        backdrop-filter: blur(4px);
        margin: 0;
        border-radius: 0;
        padding: 6px 8px;
      }
    `),
      document.head.appendChild(e),
      !document.getElementById(pe))
    ) {
      const t = document.createElement("style");
      ((t.id = pe),
        (t.textContent = `
        .${Y} {
          width: 40px; height: 40px;
          object-fit: cover;
          border-radius: 4px;
          background: #000;
          margin-right: 12px;
          flex: 0 0 40px;
        }
        .item-grid .${Y} {
          width: 100%; height: 100%;
          margin: 0;
          position: absolute; inset: 0;
          z-index: -1;
        }
      `),
        document.head.appendChild(t));
    }
  }
  isFilesPage() {
    return window.location.pathname.startsWith("/files");
  }
  startWatcher() {
    (this.scheduleHydrate(),
      (this.observer = new MutationObserver(() => {
        if (this.isFilesPage()) {
          const e = window.location.pathname;
          e !== this.lastPathname
            ? ((this.lastPathname = e), this.scheduleHydrate())
            : this.scheduleHydrate();
        }
      })),
      this.observer.observe(document.body, { childList: !0, subtree: !0 }));
  }
  scheduleHydrate() {
    this.isFilesPage() &&
      (this.hydrateTimer && clearTimeout(this.hydrateTimer),
      (this.hydrateTimer = window.setTimeout(() => {
        ((this.hydrateTimer = null), this.hydrate());
      }, 250)));
  }
  hydrate() {
    if (!this.isFilesPage()) return;
    const e = this.getLayout(),
      t = document.querySelectorAll(".row.list-item, tr, .item, .file");
    let r = 0;
    const n = 8;
    if (
      (t.forEach((o) => {
        var h;
        if (o.classList.contains(at)) return;
        const s = this.findNameEl(o);
        if (!s) return;
        const l = ((h = s.textContent) == null ? void 0 : h.trim()) || "";
        if (!this.isLikelyVideo(l)) return;
        const c = this.extractPath(o, l);
        if (!c) return;
        this.applyThumbnail(o, c);
        const i = this.ensureDetailsBox(o, s);
        if (!i) return;
        const m = j.getCached(c);
        if (m !== void 0) {
          this.renderDetails(i, l, m, e === "list");
          return;
        }
        j.isInFlight(c) ||
          r >= n ||
          (r++,
          j.fetch(c).then((y) => {
            (i.dataset.path === c && this.renderDetails(i, l, y, e === "list"),
              this.scheduleHydrate());
          }));
      }),
      G())
    ) {
      const o = j.debugStats;
      st.setText(`Hydrated: ok:${o.ok} 404:${o.notFound} row:${t.length}`);
    }
  }
  getLayout() {
    const e = document.getElementById("listing");
    return e != null && e.classList.contains("list")
      ? "list"
      : e != null && e.classList.contains("grid")
        ? "grid"
        : "list";
  }
  findNameEl(e) {
    return e.querySelector(".name, .title, [data-name]");
  }
  isLikelyVideo(e) {
    var r;
    const t = ((r = e.split(".").pop()) == null ? void 0 : r.toLowerCase()) || "";
    return ["mp4", "mkv", "mov", "avi", "webm"].includes(t);
  }
  extractPath(e, t) {
    const r = e.querySelector("a[href]");
    if (r) {
      const o = r.getAttribute("href") || "";
      if (o.startsWith("/files/")) return decodeURIComponent(o.substring(6));
    }
    let n = window.location.pathname.replace("/files", "");
    return (n.startsWith("/") || (n = "/" + n), n.endsWith("/") || (n += "/"), n + t);
  }
  ensureDetailsBox(e, t) {
    var n;
    let r = e.querySelector(`.${U}`);
    return (
      r ||
        ((r = document.createElement("div")),
        (r.className = U),
        (n = t.parentNode) == null || n.insertBefore(r, t.nextSibling)),
      r
    );
  }
  renderDetails(e, t, r, n) {
    ((e.dataset.path = e.dataset.path || ""), (e.innerHTML = ""));
    const o = [];
    if ((n && o.push(t), r)) {
      if (r.uploaded_at) {
        const s = new Date(r.uploaded_at * 1e3).toISOString().slice(0, 16).replace("T", " ");
        o.push(`Uploaded: ${s}`);
      }
      (r.processed_size && o.push(`Size: ${(r.processed_size / 1024 / 1024).toFixed(1)} MB`),
        r.status && o.push(`Status: ${r.status}`));
    } else o.push("No metadata available");
    o.forEach((s) => {
      const l = document.createElement("span");
      ((l.className = "line"), (l.textContent = s), e.appendChild(l));
    });
  }
  applyThumbnail(e, t) {
    const r = e.querySelector(".material-icons, .icon, i"),
      n = this.findNameEl(e);
    if (!r || !n) return;
    const o = this.findThumbContainer(e, r, n);
    if (!o) return;
    const s = o.querySelector(`.${Y}`);
    if (s && s.dataset.failed === "1") return;
    const l = this.buildPreviewUrl(t, ue),
      c = this.buildPreviewUrl(t, ue * 2);
    if (s && s.dataset.src === l) return;
    r.style.display = "none";
    let i = s;
    (i ||
      ((i = document.createElement("img")),
      (i.className = Y),
      (i.alt = ""),
      (i.loading = "lazy"),
      (i.decoding = "async"),
      i.addEventListener("error", () => {
        ((i.dataset.failed = "1"), (i.style.display = "none"), (r.style.display = ""));
      }),
      o.insertBefore(i, o.firstChild)),
      (i.dataset.src = l),
      (i.src = l),
      (i.srcset = `${l} 1x, ${c} 2x`),
      (i.sizes = "40px"));
  }
  findThumbContainer(e, t, r) {
    return e.classList.contains("item") ? e : t.parentElement;
  }
  buildPreviewUrl(e, t) {
    let r = e;
    r.startsWith("/") || (r = "/" + r);
    let n = `/api/share/__files__/preview${encodeURI(r)}?v=1`;
    return (t && (n += `&w=${t}`), n);
  }
}
const he = "droppr_gallery_prefs";
class lt {
  constructor() {
    g(this, "currentTheme", "light");
    ((this.currentTheme = this.getThemeFromPrefs()), this.applyTheme(this.currentTheme));
  }
  getTheme() {
    return this.currentTheme;
  }
  toggle() {
    const e = this.currentTheme === "dark" ? "light" : "dark";
    this.setTheme(e);
  }
  setTheme(e) {
    ((this.currentTheme = e),
      this.applyTheme(e),
      this.saveThemePrefs({ theme: e }),
      window.dispatchEvent(new CustomEvent("droppr:theme-changed", { detail: { theme: e } })));
  }
  getThemeFromPrefs() {
    try {
      const e = localStorage.getItem(he);
      if (e) {
        const t = JSON.parse(e);
        if (t.theme === "dark" || t.theme === "light") return t.theme;
      }
    } catch {}
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  saveThemePrefs(e) {
    try {
      localStorage.setItem(he, JSON.stringify(e));
    } catch {}
  }
  applyTheme(e) {
    const t = e === "dark";
    (t
      ? (document.documentElement.classList.add("dark"),
        document.body && document.body.classList.add("dark"))
      : (document.documentElement.classList.remove("dark"),
        document.body && document.body.classList.remove("dark")),
      this.fixPlaceholderColors(t));
  }
  fixPlaceholderColors(e) {
    const t = "droppr-placeholder-fix";
    let r = document.getElementById(t);
    r && r.parentNode && r.parentNode.removeChild(r);
    const n = e ? "#94a3b8" : "#475569";
    ((r = document.createElement("style")),
      (r.id = t),
      (r.textContent = `
      input::placeholder, input::-webkit-input-placeholder {
        color: ${n} !important;
        opacity: 1 !important;
        -webkit-text-fill-color: ${n} !important;
      }
      input::-moz-placeholder {
        color: ${n} !important;
        opacity: 1 !important;
      }
      input:-ms-input-placeholder {
        color: ${n} !important;
      }
    `),
      document.head.appendChild(r));
  }
}
const fe = new lt(),
  W = "droppr-theme-toggle";
class ct {
  constructor() {
    (this.ensureButton(),
      window.addEventListener("droppr:theme-changed", (e) => {
        this.updateButtonState(e.detail.theme);
      }));
  }
  ensureButton() {
    if (document.getElementById(W)) return;
    const e = fe.getTheme(),
      t = document.createElement("button");
    ((t.id = W),
      (t.type = "button"),
      (t.style.cssText = `
      position: fixed;
      right: 18px;
      bottom: 70px;
      z-index: 2147483000;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      font-size: 20px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      border: 1px solid var(--border-color, rgba(255,255,255,0.1));
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      user-select: none;
      transition: all 0.2s ease;
    `),
      t.addEventListener("click", (r) => {
        (r.preventDefault(), fe.toggle());
      }),
      document.body.appendChild(t),
      this.updateButtonState(e));
  }
  updateButtonState(e) {
    const t = document.getElementById(W);
    if (!t) return;
    const r = e === "dark";
    ((t.textContent = r ? "🌙" : "☀️"),
      (t.title = r ? "Switch to light theme" : "Switch to dark theme"),
      (t.style.background = r ? "#1e293b" : "#ffffff"),
      (t.style.color = r ? "#f1f5f9" : "#1e293b"),
      (t.style.borderColor = r ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)"));
  }
}
const me = "33";
window.__dropprPanelBooted ||
  ((window.__dropprPanelBooted = !0),
  (window.DROPPR_PANEL_VERSION = me),
  console.log(`Droppr Panel v${me} booting...`),
  new tt(),
  new qe(),
  new Ue(),
  new Be(),
  new Fe(),
  new it(),
  new ct());
//# sourceMappingURL=droppr-panel.js.map

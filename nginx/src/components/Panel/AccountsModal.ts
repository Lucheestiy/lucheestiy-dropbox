import { dropprFetch } from "../../services/api";

const ACCOUNTS_MODAL_ID = "droppr-accounts-modal";
const ACCOUNTS_STYLE_ID = "droppr-accounts-style";
const PASSWORD_MIN_LEN = 8;
const USERNAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/;

export class AccountsModal {
  constructor() {}

  public show() {
    this.ensureStyles();
    this.render();
  }

  private ensureStyles() {
    if (document.getElementById(ACCOUNTS_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = ACCOUNTS_STYLE_ID;
    style.textContent = `
      #${ACCOUNTS_MODAL_ID} {
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
      #${ACCOUNTS_MODAL_ID} .panel {
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
      #${ACCOUNTS_MODAL_ID} .hdr {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 20px 24px 16px 24px;
        border-bottom: 1px solid var(--droppr-overlay-border, rgba(255,255,255,0.08));
      }
      #${ACCOUNTS_MODAL_ID} .title {
        font-size: 18px;
        font-weight: 700;
        color: var(--text-primary, #fff);
      }
      #${ACCOUNTS_MODAL_ID} .subtitle {
        font-size: 13px;
        margin-top: 4px;
        color: var(--text-secondary, rgba(229,231,235,0.6));
      }
      #${ACCOUNTS_MODAL_ID} .close {
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
      #${ACCOUNTS_MODAL_ID} .close:hover {
        color: #fff;
        background: rgba(255,255,255,0.1);
      }
      #${ACCOUNTS_MODAL_ID} .body {
        padding: 24px;
      }
      #${ACCOUNTS_MODAL_ID} .label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 6px;
        color: var(--text-primary, #e5e7eb);
      }
      #${ACCOUNTS_MODAL_ID} input[type="text"],
      #${ACCOUNTS_MODAL_ID} input[type="password"] {
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
      #${ACCOUNTS_MODAL_ID} input:focus {
        border-color: rgba(99,102,241,0.8);
        outline: none;
        box-shadow: 0 0 0 2px rgba(99,102,241,0.25);
      }
      #${ACCOUNTS_MODAL_ID} .password-meter {
        margin-bottom: 16px;
      }
      #${ACCOUNTS_MODAL_ID} .password-meter .bar {
        height: 4px;
        background: rgba(255,255,255,0.1);
        border-radius: 2px;
        margin-bottom: 6px;
        overflow: hidden;
      }
      #${ACCOUNTS_MODAL_ID} .password-meter .bar span {
        display: block;
        height: 100%;
        width: 0%;
        transition: width 0.3s ease, background-color 0.3s ease;
      }
      #${ACCOUNTS_MODAL_ID} .password-meter.weak .bar span { background: #ef4444; }
      #${ACCOUNTS_MODAL_ID} .password-meter.medium .bar span { background: #f59e0b; }
      #${ACCOUNTS_MODAL_ID} .password-meter.strong .bar span { background: #10b981; }
      #${ACCOUNTS_MODAL_ID} .password-meter .label {
        font-size: 11px;
        color: var(--text-secondary, rgba(229,231,235,0.6));
        text-align: right;
        margin: 0;
        font-weight: 400;
      }
      #${ACCOUNTS_MODAL_ID} .note {
        font-size: 13px;
        color: var(--text-secondary, rgba(229,231,235,0.7));
        margin-bottom: 20px;
        padding: 12px;
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
      }
      #${ACCOUNTS_MODAL_ID} .status {
        font-size: 13px;
        margin-bottom: 16px;
        min-height: 20px;
      }
      #${ACCOUNTS_MODAL_ID} .status.error { color: #ef4444; }
      #${ACCOUNTS_MODAL_ID} .status.success { color: #10b981; }
      #${ACCOUNTS_MODAL_ID} .actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }
      #${ACCOUNTS_MODAL_ID} .btn {
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.2s;
      }
      #${ACCOUNTS_MODAL_ID} .btn.secondary {
        background: transparent;
        color: var(--text-primary, #e5e7eb);
        border: 1px solid var(--border-color, rgba(255,255,255,0.15));
      }
      #${ACCOUNTS_MODAL_ID} .btn.secondary:hover {
        background: rgba(255,255,255,0.05);
      }
      #${ACCOUNTS_MODAL_ID} .btn.primary {
        background: rgba(99,102,241,0.95);
        color: white;
      }
      #${ACCOUNTS_MODAL_ID} .btn.primary:hover {
        background: rgba(79,70,229,1);
        transform: translateY(-1px);
      }
      #${ACCOUNTS_MODAL_ID} .btn[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
        transform: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  private render() {
    const existing = document.getElementById(ACCOUNTS_MODAL_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    const overlay = document.createElement("div");
    overlay.id = ACCOUNTS_MODAL_ID;

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
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
        <input id="droppr-account-password" type="password" autocomplete="new-password" placeholder="at least ${PASSWORD_MIN_LEN} characters">
        
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
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    this.bindEvents(panel, overlay);
  }

  private bindEvents(panel: HTMLElement, overlay: HTMLElement) {
    const usernameInput = panel.querySelector("#droppr-account-username") as HTMLInputElement;
    const passwordInput = panel.querySelector("#droppr-account-password") as HTMLInputElement;
    const scopeLabel = panel.querySelector("#droppr-account-scope");
    const statusEl = panel.querySelector("#droppr-account-status");
    const closeBtn = panel.querySelector(".close");
    const cancelBtn = panel.querySelector('[data-action="cancel"]');
    const createBtn = panel.querySelector('[data-action="create"]') as HTMLButtonElement;
    const meter = panel.querySelector("#droppr-account-meter");
    const meterLabel = panel.querySelector("#droppr-account-meter-label");
    const meterBar = meter ? (meter.querySelector(".bar span") as HTMLElement) : null;

    const setStatus = (text: string, tone?: string) => {
      if (!statusEl) return;
      statusEl.textContent = text || "";
      statusEl.className = "status" + (tone ? " " + tone : "");
    };

    const updatePasswordMeter = () => {
      if (!meter || !meterLabel || !meterBar || !passwordInput) return;
      const password = String(passwordInput.value || "");
      if (!password) {
        meter.className = "password-meter";
        meterBar.style.width = "0%";
        meterLabel.textContent = "Password strength";
        return;
      }

      const checks = [];
      checks.push({ ok: password.length >= PASSWORD_MIN_LEN, label: "length" });
      checks.push({ ok: /[A-Z]/.test(password), label: "upper" });
      checks.push({ ok: /[a-z]/.test(password), label: "lower" });
      checks.push({ ok: /[0-9]/.test(password), label: "digit" });
      checks.push({ ok: /[^A-Za-z0-9]/.test(password), label: "symbol" });

      const passed = checks.filter((c) => c.ok).length;
      const total = checks.length || 1;
      const pct = Math.round((passed / total) * 100);
      meterBar.style.width = pct + "%";

      let label = "Weak";
      meter.className = "password-meter weak";
      if (pct >= 80) {
        label = "Strong";
        meter.className = "password-meter strong";
      } else if (pct >= 50) {
        label = "Medium";
        meter.className = "password-meter medium";
      }
      meterLabel.textContent = "Strength: " + label;
    };

    const formatAccountScope = (username: string) => {
      return username ? `/users/${username}` : "/users/...";
    };

    const updateScope = () => {
      if (!scopeLabel || !usernameInput) return;
      scopeLabel.textContent = formatAccountScope(String(usernameInput.value || "").trim());
    };

    const closeModal = () => {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };

    const submit = async () => {
      if (!usernameInput || !passwordInput || !createBtn) return;
      const username = String(usernameInput.value || "").trim();
      const password = String(passwordInput.value || "");

      setStatus("", "");

      if (!USERNAME_RE.test(username)) {
        setStatus("Username must be 3-32 characters (letters, numbers, _ or -).", "error");
        return;
      }

      if (password.length < PASSWORD_MIN_LEN) {
        setStatus(`Password must be at least ${PASSWORD_MIN_LEN} characters.`, "error");
        return;
      }

      createBtn.disabled = true;
      try {
        const res = await dropprFetch("/api/droppr/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });

        let data: { error?: string; scope?: string } = {};
        try {
          data = await res.json();
        } catch (_e) {
          /* ignore */
        }

        if (!res.ok) {
          const msg = data && data.error ? data.error : "Request failed (" + res.status + ")";
          throw new Error(msg);
        }

        const scope = data && data.scope ? data.scope : formatAccountScope(username);
        setStatus("Account created. Folder: " + scope, "success");
        passwordInput.value = "";
        try {
          usernameInput.select();
        } catch (_e2) {
          /* ignore */
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(msg, "error");
      } finally {
        createBtn.disabled = true; // Wait, why true here? It was false in original.
        // Actually it should be false to re-enable it.
        createBtn.disabled = false;
      }
    };

    updateScope();
    updatePasswordMeter();

    usernameInput?.addEventListener("input", updateScope);
    passwordInput?.addEventListener("input", updatePasswordMeter);
    closeBtn?.addEventListener("click", closeModal);
    cancelBtn?.addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
    panel.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    createBtn?.addEventListener("click", submit);

    try {
      usernameInput?.focus();
    } catch (_e) {
      /* ignore */
    }
  }
}

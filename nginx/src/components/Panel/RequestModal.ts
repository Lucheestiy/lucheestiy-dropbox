import { dropprFetch } from "../../services/api";

const REQUEST_MODAL_ID = "droppr-request-modal";
const REQUEST_STYLE_ID = "droppr-request-style";
const REQUEST_EXPIRE_STORAGE_KEY = "droppr_request_expire_hours";

export class RequestModal {
  constructor() {}

  public show() {
    this.ensureStyles();
    this.render();
  }

  private ensureStyles() {
    if (document.getElementById(REQUEST_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = REQUEST_STYLE_ID;
    style.textContent = `
      #${REQUEST_MODAL_ID} {
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
      #${REQUEST_MODAL_ID} .panel {
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
      #${REQUEST_MODAL_ID} .hdr {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 20px 24px 16px 24px;
        border-bottom: 1px solid var(--droppr-overlay-border, rgba(255,255,255,0.08));
      }
      #${REQUEST_MODAL_ID} .title {
        font-size: 18px;
        font-weight: 700;
        color: var(--text-primary, #fff);
      }
      #${REQUEST_MODAL_ID} .subtitle {
        font-size: 13px;
        margin-top: 4px;
        color: var(--text-secondary, rgba(229,231,235,0.6));
      }
      #${REQUEST_MODAL_ID} .close {
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
      #${REQUEST_MODAL_ID} .close:hover {
        color: #fff;
        background: rgba(255,255,255,0.1);
      }
      #${REQUEST_MODAL_ID} .body {
        padding: 24px;
      }
      #${REQUEST_MODAL_ID} .label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 6px;
        color: var(--text-primary, #e5e7eb);
      }
      #${REQUEST_MODAL_ID} input[type="text"],
      #${REQUEST_MODAL_ID} input[type="password"],
      #${REQUEST_MODAL_ID} input[type="number"] {
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
      #${REQUEST_MODAL_ID} input:focus {
        border-color: rgba(99,102,241,0.8);
        outline: none;
        box-shadow: 0 0 0 2px rgba(99,102,241,0.25);
      }
      #${REQUEST_MODAL_ID} .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }
      #${REQUEST_MODAL_ID} .switch {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
      }
      #${REQUEST_MODAL_ID} .switch input { opacity: 0; width: 0; height: 0; }
      #${REQUEST_MODAL_ID} .slider {
        position: absolute;
        cursor: pointer;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(255,255,255,0.1);
        transition: .4s;
        border-radius: 24px;
      }
      #${REQUEST_MODAL_ID} .slider:before {
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
      #${REQUEST_MODAL_ID} input:checked + .slider { background-color: #6366f1; }
      #${REQUEST_MODAL_ID} input:checked + .slider:before { transform: translateX(20px); }
      #${REQUEST_MODAL_ID} .password-wrap {
        display: none;
      }
      #${REQUEST_MODAL_ID} .password-wrap.show {
        display: block;
      }
      #${REQUEST_MODAL_ID} .status {
        font-size: 13px;
        margin-bottom: 16px;
        min-height: 20px;
      }
      #${REQUEST_MODAL_ID} .status.error { color: #ef4444; }
      #${REQUEST_MODAL_ID} .status.success { color: #10b981; }
      #${REQUEST_MODAL_ID} .result {
        display: none;
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--border-color, rgba(255,255,255,0.1));
      }
      #${REQUEST_MODAL_ID} .result.show { display: block; }
      #${REQUEST_MODAL_ID} .link-row {
        display: flex;
        gap: 8px;
      }
      #${REQUEST_MODAL_ID} .link-row input { margin-bottom: 0; }
      #${REQUEST_MODAL_ID} .actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 24px;
      }
      #${REQUEST_MODAL_ID} .btn {
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.2s;
      }
      #${REQUEST_MODAL_ID} .btn.secondary {
        background: transparent;
        color: var(--text-primary, #e5e7eb);
        border: 1px solid var(--border-color, rgba(255,255,255,0.15));
      }
      #${REQUEST_MODAL_ID} .btn.secondary:hover {
        background: rgba(255,255,255,0.05);
      }
      #${REQUEST_MODAL_ID} .btn.primary {
        background: rgba(99,102,241,0.95);
        color: white;
      }
      #${REQUEST_MODAL_ID} .btn.primary:hover {
        background: rgba(79,70,229,1);
        transform: translateY(-1px);
      }
      #${REQUEST_MODAL_ID} .btn[disabled] {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `;
    document.head.appendChild(style);
  }

  private render() {
    const existing = document.getElementById(REQUEST_MODAL_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    const overlay = document.createElement("div");
    overlay.id = REQUEST_MODAL_ID;

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `
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
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    this.bindEvents(panel, overlay);
  }

  private bindEvents(panel: HTMLElement, overlay: HTMLElement) {
    const pathInput = panel.querySelector("#droppr-request-path") as HTMLInputElement;
    const expireInput = panel.querySelector("#droppr-request-expire") as HTMLInputElement;
    const toggleInput = panel.querySelector("#droppr-request-password-toggle") as HTMLInputElement;
    const passwordWrap = panel.querySelector("#droppr-request-password-wrap");
    const passwordInput = panel.querySelector("#droppr-request-password") as HTMLInputElement;
    const statusEl = panel.querySelector("#droppr-request-status");
    const resultEl = panel.querySelector("#droppr-request-result");
    const linkInput = panel.querySelector("#droppr-request-link") as HTMLInputElement;
    const closeBtn = panel.querySelector(".close");
    const cancelBtn = panel.querySelector('[data-action="cancel"]');
    const createBtn = panel.querySelector('[data-action="create"]') as HTMLButtonElement;
    const copyBtn = panel.querySelector('[data-action="copy"]') as HTMLButtonElement;
    const openBtn = panel.querySelector('[data-action="open"]');

    const setStatus = (text: string, tone?: string) => {
      if (!statusEl) return;
      statusEl.textContent = text || "";
      statusEl.className = "status" + (tone ? " " + tone : "");
    };

    const setResult = (link: string) => {
      if (!resultEl || !linkInput) return;
      linkInput.value = link || "";
      resultEl.classList.add("show");
    };

    const closeModal = () => {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    };

    const updateToggle = () => {
      if (!toggleInput || !passwordWrap) return;
      if (toggleInput.checked) {
        passwordWrap.classList.add("show");
      } else {
        passwordWrap.classList.remove("show");
      }
    };

    const submit = async () => {
      if (!pathInput || !expireInput || !createBtn) return;
      let path = String(pathInput.value || "").trim();
      if (!path) {
        setStatus("Folder path is required.", "error");
        return;
      }
      if (path.charAt(0) !== "/") path = "/" + path;

      const hoursRaw = String(expireInput.value || "0").trim();
      const hours = parseInt(hoursRaw, 10);
      if (isNaN(hours) || hours < 0) {
        setStatus("Expiration must be 0 or a positive number.", "error");
        return;
      }

      let password = "";
      if (toggleInput && toggleInput.checked) {
        password = String(passwordInput.value || "");
        if (!password) {
          setStatus("Password cannot be empty when enabled.", "error");
          return;
        }
      }

      try {
        localStorage.setItem(REQUEST_EXPIRE_STORAGE_KEY, String(hours));
      } catch (_e1) {
        // ignore
      }

      createBtn.disabled = true;
      setStatus("Creating request link...", "");

      try {
        const res = await dropprFetch("/api/droppr/requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path, expires_hours: hours, password }),
        });

        let data: { error?: string; url?: string; hash?: string } = {};
        try {
          data = await res.json();
        } catch (_e) {
          /* ignore */
        }

        if (!res.ok) {
          const msg = data && data.error ? data.error : "Request failed (" + res.status + ")";
          throw new Error(msg);
        }

        const url = data && data.url ? data.url : "/request/" + (data.hash || "");
        const link = window.location.origin + url;
        setStatus("Request link ready.", "success");
        setResult(link);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(msg, "error");
      } finally {
        createBtn.disabled = false;
      }
    };

    toggleInput?.addEventListener("change", updateToggle);
    closeBtn?.addEventListener("click", closeModal);
    cancelBtn?.addEventListener("click", closeModal);

    copyBtn?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(linkInput.value);
        copyBtn.textContent = "Copied";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
      } catch (_e) {
        linkInput.select();
        document.execCommand("copy");
      }
    });

    openBtn?.addEventListener("click", () => {
      window.open(linkInput.value, "_blank");
    });

    createBtn?.addEventListener("click", submit);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
  }
}

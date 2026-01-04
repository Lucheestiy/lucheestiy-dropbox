const ICLOUD_WAIT_STYLE_ID = "droppr-icloud-wait-style";
const ICLOUD_WAIT_MODAL_ID = "droppr-icloud-wait";

export class IcloudWaitModal {
  private modal: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private cancelBtn: HTMLButtonElement | null = null;

  constructor() {
    this.ensureStyles();
  }

  private ensureStyles() {
    if (document.getElementById(ICLOUD_WAIT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = ICLOUD_WAIT_STYLE_ID;
    style.textContent = `
      #${ICLOUD_WAIT_MODAL_ID} {
        position: fixed;
        top: 18px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483002;
        width: 560px;
        max-width: calc(100vw - 36px);
        border-radius: 14px;
        background: var(--droppr-overlay-bg, rgba(17, 24, 39, 0.98));
        color: var(--text-primary, #e5e7eb);
        border: 1px solid var(--droppr-overlay-border, rgba(255,255,255,0.12));
        box-shadow: 0 26px 60px -30px rgba(0,0,0,0.85);
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        overflow: hidden;
      }
      #${ICLOUD_WAIT_MODAL_ID} .row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px;
      }
      #${ICLOUD_WAIT_MODAL_ID} .spinner {
        width: 18px;
        height: 18px;
        border-radius: 999px;
        border: 2px solid var(--border-color, rgba(255,255,255,0.25));
        border-top-color: rgba(99, 102, 241, 0.95);
        animation: droppr-spin 1s linear infinite;
        flex: 0 0 auto;
      }
      #${ICLOUD_WAIT_MODAL_ID} .txt {
        flex: 1 1 auto;
        min-width: 0;
      }
      #${ICLOUD_WAIT_MODAL_ID} .title {
        font-size: 13px;
        font-weight: 800;
        color: var(--text-primary, #fff);
        line-height: 1.15;
      }
      #${ICLOUD_WAIT_MODAL_ID} .status {
        margin-top: 4px;
        font-size: 12px;
        color: var(--droppr-overlay-muted, rgba(229,231,235,0.82));
        word-break: break-word;
        line-height: 1.2;
      }
      #${ICLOUD_WAIT_MODAL_ID} .note {
        margin-top: 6px;
        font-size: 12px;
        color: var(--text-secondary, rgba(229,231,235,0.65));
      }
      #${ICLOUD_WAIT_MODAL_ID} .btn {
        flex: 0 0 auto;
        cursor: pointer;
        border: 1px solid var(--border-color, rgba(255,255,255,0.12));
        background: var(--hover-bg, rgba(255,255,255,0.08));
        color: var(--text-primary, #fff);
        font-weight: 700;
        font-size: 12px;
        padding: 9px 11px;
        border-radius: 10px;
      }
      #${ICLOUD_WAIT_MODAL_ID} .btn:hover {
        filter: brightness(1.05);
      }
      @keyframes droppr-spin { to { transform: rotate(360deg); } }
    `;
    document.head.appendChild(style);
  }

  public show() {
    this.dismiss();

    const modal = document.createElement("div");
    modal.id = ICLOUD_WAIT_MODAL_ID;
    modal.innerHTML = `
      <div class="row">
        <div class="spinner"></div>
        <div class="txt">
          <div class="title">Waiting for iCloud download…</div>
          <div class="status">Preparing upload…</div>
          <div class="note">Keep this tab open. Upload starts automatically once the file is ready.</div>
        </div>
        <button type="button" class="btn">Cancel</button>
      </div>
    `;

    document.body.appendChild(modal);
    this.modal = modal;
    this.statusEl = modal.querySelector(".status");
    this.cancelBtn = modal.querySelector(".btn");
  }

  public setStatus(text: string) {
    if (this.statusEl) {
      this.statusEl.textContent = text || "Preparing upload…";
    }
  }

  public onCancel(fn: () => void) {
    this.cancelBtn?.addEventListener("click", fn);
  }

  public dismiss() {
    const el = document.getElementById(ICLOUD_WAIT_MODAL_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
    this.modal = null;
    this.statusEl = null;
    this.cancelBtn = null;
  }
}

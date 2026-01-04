import { copyText } from "../../utils/format";

const AUTO_SHARE_STYLE_ID = "droppr-auto-share-style";
const AUTO_SHARE_MODAL_ID = "droppr-auto-share-modal";

interface AutoShareOptions {
  title?: string;
  subtitle?: string;
  urlLabel?: string;
  url?: string;
  streamUrl?: string;
  openUrl?: string;
  note?: string;
  autoCopy?: boolean;
}

export class AutoShareModal {
  constructor() {
    this.ensureStyles();
  }

  private ensureStyles() {
    if (document.getElementById(AUTO_SHARE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = AUTO_SHARE_STYLE_ID;
    style.textContent = `
      #${AUTO_SHARE_MODAL_ID} {
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
      #${AUTO_SHARE_MODAL_ID} .hdr {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 14px 8px 14px;
      }
      #${AUTO_SHARE_MODAL_ID} .title {
        font-size: 14px;
        font-weight: 800;
        line-height: 1.2;
        color: var(--text-primary, #fff);
      }
      #${AUTO_SHARE_MODAL_ID} .subtitle {
        font-size: 12px;
        line-height: 1.2;
        margin-top: 4px;
        color: var(--droppr-overlay-muted, rgba(229,231,235,0.8));
        word-break: break-word;
      }
      #${AUTO_SHARE_MODAL_ID} .close {
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
      #${AUTO_SHARE_MODAL_ID} .close:hover {
        background: var(--hover-bg, rgba(255,255,255,0.08));
      }
      #${AUTO_SHARE_MODAL_ID} .body {
        padding: 0 14px 14px 14px;
      }
      #${AUTO_SHARE_MODAL_ID} .row {
        display: flex;
        gap: 10px;
        align-items: center;
      }
      #${AUTO_SHARE_MODAL_ID} input {
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
      #${AUTO_SHARE_MODAL_ID} .btn {
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
      #${AUTO_SHARE_MODAL_ID} .btn.secondary {
        background: var(--hover-bg, rgba(255,255,255,0.08));
        color: var(--text-primary, #fff);
      }
      #${AUTO_SHARE_MODAL_ID} .note {
        margin-top: 10px;
        font-size: 12px;
        color: var(--text-secondary, rgba(229,231,235,0.72));
      }
    `;
    document.head.appendChild(style);
  }

  public show(opts: AutoShareOptions) {
    this.dismiss();

    const primaryUrl = opts.url || opts.streamUrl || opts.openUrl || "";
    const openUrl = opts.openUrl || primaryUrl;

    const modal = document.createElement("div");
    modal.id = AUTO_SHARE_MODAL_ID;
    modal.innerHTML = `
      <div class="hdr">
        <div>
          <div class="title">${opts.title || "Share link ready"}</div>
          ${opts.subtitle ? `<div class="subtitle">${opts.subtitle}</div>` : ""}
        </div>
        <button type="button" class="close" aria-label="Close">&times;</button>
      </div>
      <div class="body">
        ${opts.urlLabel ? `<div style="font-size:0.8rem; color:var(--text-muted, #888); margin-bottom:0.35rem;">${opts.urlLabel}</div>` : ""}
        <div class="row">
          <input type="text" readonly value="${primaryUrl}">
          <button type="button" class="btn" data-action="copy">Copy</button>
          <button type="button" class="btn secondary" data-action="open">Open</button>
        </div>
        ${opts.note ? `<div class="note">${opts.note}</div>` : ""}
      </div>
    `;

    document.body.appendChild(modal);

    const closeBtn = modal.querySelector(".close");
    const copyBtn = modal.querySelector('[data-action="copy"]') as HTMLButtonElement;
    const openBtn = modal.querySelector('[data-action="open"]');
    const input = modal.querySelector("input") as HTMLInputElement;

    closeBtn?.addEventListener("click", () => this.dismiss());
    input?.addEventListener("focus", () => input.select());

    copyBtn?.addEventListener("click", async () => {
      try {
        await copyText(input.value);
        copyBtn.textContent = "Copied";
        setTimeout(() => {
          if (document.body.contains(copyBtn)) copyBtn.textContent = "Copy";
        }, 1200);
      } catch (e) {
        input.focus();
        input.select();
      }
    });

    openBtn?.addEventListener("click", () => {
      window.open(openUrl, "_blank", "noopener");
    });

    if (opts.autoCopy) {
      copyBtn.click();
    }
  }

  public dismiss() {
    const el = document.getElementById(AUTO_SHARE_MODAL_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
}

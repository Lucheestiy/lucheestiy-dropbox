import { isLoggedIn } from "../../services/auth";
import { adminService } from "../../services/admin";
import { AccountsModal } from "./AccountsModal";
import { RequestModal } from "./RequestModal";

const STREAM_BTN_ID = "droppr-stream-btn";
const STREAM_BTN_STYLE_ID = "droppr-stream-style";
const ACCOUNTS_BTN_ID = "droppr-accounts-btn";
const ACCOUNTS_STYLE_ID = "droppr-accounts-style";
const REQUEST_BTN_ID = "droppr-request-btn";
const REQUEST_STYLE_ID = "droppr-request-style";

export class HeaderButtons {
  private accountsModal = new AccountsModal();
  private requestModal = new RequestModal();
  private observer: MutationObserver | null = null;

  constructor() {
    this.ensureStreamStyles();
    this.ensureAccountsStyles();
    this.ensureRequestStyles();
    this.startWatcher();
  }

  private startWatcher() {
    this.checkButtons();
    // Watch for URL changes (SPA navigation)
    let lastPath = window.location.pathname;
    this.observer = new MutationObserver(() => {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        this.checkButtons();
      } else {
        // Also check periodically if buttons are missing but should be there (DOM redraws)
        this.checkButtons();
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  private checkButtons() {
    this.ensureStreamButton();
    this.ensureAccountsButton();
    this.ensureRequestButton();
  }

  // ============ STREAM BUTTON ============
  private ensureStreamStyles() {
    if (document.getElementById(STREAM_BTN_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STREAM_BTN_STYLE_ID;
    style.textContent = `
      #${STREAM_BTN_ID} {
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
      #${STREAM_BTN_ID}:hover {
        background: #818cf8;
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(99, 102, 241, 0.5);
      }
      #${STREAM_BTN_ID} .icon {
        width: 18px;
        height: 18px;
      }
      #${STREAM_BTN_ID} .label {
        line-height: 1;
      }
    `;
    document.head.appendChild(style);
  }

  private getShareHashFromUrl(): string | null {
    const path = window.location.pathname || "";
    // Match /gallery/<hash> or /media/<hash>
    const m = path.match(/^\/(?:gallery|media)\/([A-Za-z0-9_-]+)/);
    if (m) return m[1];
    // Match share param in query string
    const params = new URLSearchParams(window.location.search);
    const share = params.get("share");
    if (share && /^[A-Za-z0-9_-]+$/.test(share)) return share;
    return null;
  }

  private ensureStreamButton() {
    const existing = document.getElementById(STREAM_BTN_ID) as HTMLAnchorElement | null;
    const shareHash = this.getShareHashFromUrl();

    if (!shareHash) {
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
      return;
    }

    if (existing) {
      existing.href = "/stream/" + shareHash;
      return;
    }

    const a = document.createElement("a");
    a.id = STREAM_BTN_ID;
    a.href = "/stream/" + shareHash;
    a.target = "_blank";
    a.rel = "noopener";
    a.title = "Open Stream Gallery (optimized video player for large files)";
    a.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M8 5v14l11-7z"/>
      </svg>
      <span class="label">Stream</span>
    `;

    document.body.appendChild(a);
  }

  // ============ ACCOUNTS BUTTON ============
  private ensureAccountsStyles() {
    if (document.getElementById(ACCOUNTS_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = ACCOUNTS_STYLE_ID;
    style.textContent = `
      #${ACCOUNTS_BTN_ID} {
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
      #${ACCOUNTS_BTN_ID}:hover {
        background: rgba(5, 150, 105, 0.98);
        transform: translateY(-1px);
      }
      #${ACCOUNTS_BTN_ID} .icon {
        width: 18px;
        height: 18px;
        display: inline-block;
      }
      #${ACCOUNTS_BTN_ID} .label {
        font-size: 14px;
        line-height: 1;
      }
    `;
    document.head.appendChild(style);
  }

  private isFilesPage() {
    // Only show on file browser main list (usually /files)
    return window.location.pathname.startsWith("/files");
  }

  private async ensureAccountsButton() {
    const existing = document.getElementById(ACCOUNTS_BTN_ID);
    if (!isLoggedIn() || !this.isFilesPage()) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }

    // Check admin status
    const isAdmin = await adminService.check();
    if (!isAdmin) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }

    if (existing) return;

    const btn = document.createElement("button");
    btn.id = ACCOUNTS_BTN_ID;
    btn.type = "button";
    btn.title = "Create upload account";
    btn.setAttribute("aria-label", "Create upload account");
    btn.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M15 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm-6 0c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3zm6 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4zm-6 0c-.3 0-.8 0-1.3.1 1.8 1.2 2.3 2.7 2.3 3.9v2H2v-2c0-2 3.6-4 7-4zm11-2v-2h-2V8h-2v2h-2v2h2v2h2v-2h2z"/>
      </svg>
      <span class="label">Accounts</span>
    `;

    btn.addEventListener("click", () => this.accountsModal.show());
    document.body.appendChild(btn);
  }

  // ============ REQUEST BUTTON ============
  private ensureRequestStyles() {
    if (document.getElementById(REQUEST_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = REQUEST_STYLE_ID;
    style.textContent = `
      #${REQUEST_BTN_ID} {
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
      #${REQUEST_BTN_ID}:hover {
        background: rgba(11, 95, 255, 0.98);
        transform: translateY(-1px);
      }
      #${REQUEST_BTN_ID} .icon {
        width: 18px;
        height: 18px;
        display: inline-block;
      }
      #${REQUEST_BTN_ID} .label {
        font-size: 14px;
        line-height: 1;
      }
    `;
    document.head.appendChild(style);
  }

  private async ensureRequestButton() {
    const existing = document.getElementById(REQUEST_BTN_ID);
    if (!isLoggedIn() || !this.isFilesPage()) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }

    const isAdmin = await adminService.check();
    if (!isAdmin) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }

    if (existing) return;

    const btn = document.createElement("button");
    btn.id = REQUEST_BTN_ID;
    btn.type = "button";
    btn.title = "Create file request";
    btn.setAttribute("aria-label", "Create file request");
    btn.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12 3l4 4h-3v7h-2V7H8l4-4zm-7 9h2v7h10v-7h2v9H5v-9z"/>
      </svg>
      <span class="label">Request</span>
    `;

    btn.addEventListener("click", () => this.requestModal.show());
    document.body.appendChild(btn);
  }
}

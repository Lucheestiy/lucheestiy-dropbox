import { isDropprDebugEnabled } from "../../utils/debug";

const DEBUG_BADGE_ID = "droppr-debug-badge";
const DROPPR_PANEL_VERSION = "30"; // Synchronize with actual version

export class DebugBadge {
  private el: HTMLElement | null = null;

  constructor() {
    this.el = this.ensureElement();
  }

  private ensureElement(): HTMLElement | null {
    if (!isDropprDebugEnabled()) return null;

    const existing = document.getElementById(DEBUG_BADGE_ID);
    if (existing) return existing;

    const el = document.createElement("div");
    el.id = DEBUG_BADGE_ID;
    el.style.cssText =
      "position:fixed;left:10px;bottom:10px;z-index:2147483647;" +
      "max-width:min(92vw, 520px);" +
      "padding:8px 10px;border-radius:12px;" +
      "background:rgba(2,6,23,0.88);border:1px solid rgba(255,255,255,0.14);" +
      "color:rgba(241,245,249,0.96);" +
      "font:12px/1.35 Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;" +
      "box-shadow:0 18px 40px -18px rgba(0,0,0,0.75);" +
      "user-select:text;cursor:text;";
    el.textContent = `Dropbox enhancements v${DROPPR_PANEL_VERSION} loading…`;
    document.body.appendChild(el);
    return el;
  }

  public setText(text: string) {
    if (this.el) {
      this.el.textContent = text;
    }
  }
}

export const debugBadge = new DebugBadge();

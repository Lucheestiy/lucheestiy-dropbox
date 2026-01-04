import { isLoggedIn } from "../../services/auth";

const ANALYTICS_BTN_ID = "droppr-analytics-btn";
const ANALYTICS_STYLE_ID = "droppr-analytics-style";

export class AnalyticsButton {
  constructor() {
    this.ensureStyles();
    this.ensureButton();
  }

  private ensureStyles() {
    if (document.getElementById(ANALYTICS_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = ANALYTICS_STYLE_ID;
    style.textContent = `
      #${ANALYTICS_BTN_ID} {
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
      #${ANALYTICS_BTN_ID}:hover {
        background: rgba(79, 70, 229, 0.98);
        transform: translateY(-1px);
      }
      #${ANALYTICS_BTN_ID} .icon {
        width: 18px;
        height: 18px;
        display: inline-block;
      }
      #${ANALYTICS_BTN_ID} .label {
        font-size: 14px;
        line-height: 1;
      }
    `;
    document.head.appendChild(style);
  }

  private ensureButton() {
    const existing = document.getElementById(ANALYTICS_BTN_ID);
    if (!isLoggedIn()) {
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
      return;
    }

    if (existing) return;

    const a = document.createElement("a");
    a.id = ANALYTICS_BTN_ID;
    a.href = "/analytics";
    a.target = "_blank";
    a.rel = "noopener";
    a.title = "Dropbox Analytics";
    a.innerHTML = `
      <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 3h2v18H3V3zm4 10h2v8H7v-8zm4-6h2v14h-2V7zm4 4h2v10h-2V11zm4-7h2v17h-2V4z"/>
      </svg>
      <span class="label">Analytics</span>
    `;

    document.body.appendChild(a);
  }
}

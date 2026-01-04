import { ensureDropprAccessToken, getSessionExpiryMs } from "../../services/auth";

const SESSION_WARNING_ID = "droppr-session-warning";
const SESSION_WARNING_STYLE_ID = "droppr-session-warning-style";
const SESSION_WARNING_THRESHOLD_MS = 5 * 60 * 1000;

export class SessionWarning {
  private el: HTMLElement | null = null;
  private interval: number | null = null;

  constructor() {
    this.ensureStyles();
    this.ensureElement();
    this.start();
    window.addEventListener("droppr:tokens-updated", () => this.update());
  }

  private ensureStyles() {
    if (document.getElementById(SESSION_WARNING_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = SESSION_WARNING_STYLE_ID;
    style.textContent = `
      #${SESSION_WARNING_ID} {
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
      #${SESSION_WARNING_ID} .btn {
        border: 0;
        background: rgba(99,102,241,0.95);
        color: #fff;
        font-weight: 700;
        border-radius: 10px;
        padding: 6px 10px;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);
  }

  private ensureElement() {
    let el = document.getElementById(SESSION_WARNING_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = SESSION_WARNING_ID;
      el.innerHTML =
        '<span class="msg">Session expiring soon.</span><button class="btn" type="button">Refresh</button>';
      el.querySelector(".btn")?.addEventListener("click", () => {
        ensureDropprAccessToken(true);
      });
      document.body.appendChild(el);
    }
    this.el = el;
  }

  private start() {
    if (this.interval) return;
    this.update();
    this.interval = window.setInterval(() => this.update(), 60000); // Check every minute
  }

  private update() {
    if (!this.el) return;
    const exp = getSessionExpiryMs();
    if (!exp) {
      this.el.style.display = "none";
      return;
    }
    const remaining = exp - Date.now();
    if (remaining > SESSION_WARNING_THRESHOLD_MS) {
      this.el.style.display = "none";
      return;
    }
    const minutes = Math.max(1, Math.ceil(remaining / 60000));
    const msg = this.el.querySelector(".msg");
    if (msg) {
      msg.textContent = `Session expires in ${minutes} min.`;
    }
    this.el.style.display = "inline-flex";
  }
}

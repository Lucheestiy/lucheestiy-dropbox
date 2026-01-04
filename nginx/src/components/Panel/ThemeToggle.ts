import { themeService, Theme } from "../../services/theme";

const THEME_TOGGLE_BTN_ID = "droppr-theme-toggle";

export class ThemeToggle {
  constructor() {
    this.ensureButton();
    window.addEventListener("droppr:theme-changed", (e: any) => {
      this.updateButtonState(e.detail.theme);
    });
  }

  private ensureButton() {
    if (document.getElementById(THEME_TOGGLE_BTN_ID)) return;

    const theme = themeService.getTheme();
    const btn = document.createElement("button");
    btn.id = THEME_TOGGLE_BTN_ID;
    btn.type = "button";
    btn.style.cssText = `
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
    `;

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      themeService.toggle();
    });

    document.body.appendChild(btn);
    this.updateButtonState(theme);
  }

  private updateButtonState(theme: Theme) {
    const btn = document.getElementById(THEME_TOGGLE_BTN_ID);
    if (!btn) return;

    const isDark = theme === "dark";
    btn.textContent = isDark ? "🌙" : "☀️";
    btn.title = isDark ? "Switch to light theme" : "Switch to dark theme";

    // Manual overrides if CSS vars are not yet updated
    btn.style.background = isDark ? "#1e293b" : "#ffffff";
    btn.style.color = isDark ? "#f1f5f9" : "#1e293b";
    btn.style.borderColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
  }
}

const THEME_PREFS_KEY = "droppr_gallery_prefs";

export type Theme = "light" | "dark";

export interface ThemePrefs {
  theme: Theme;
}

class ThemeService {
  private currentTheme: Theme = "light";

  constructor() {
    this.currentTheme = this.getThemeFromPrefs();
    this.applyTheme(this.currentTheme);
  }

  public getTheme(): Theme {
    return this.currentTheme;
  }

  public toggle(): void {
    const next = this.currentTheme === "dark" ? "light" : "dark";
    this.setTheme(next);
  }

  public setTheme(theme: Theme): void {
    this.currentTheme = theme;
    this.applyTheme(theme);
    this.saveThemePrefs({ theme });
    window.dispatchEvent(new CustomEvent("droppr:theme-changed", { detail: { theme } }));
  }

  private getThemeFromPrefs(): Theme {
    try {
      const raw = localStorage.getItem(THEME_PREFS_KEY);
      if (raw) {
        const prefs = JSON.parse(raw) as ThemePrefs;
        if (prefs.theme === "dark" || prefs.theme === "light") {
          return prefs.theme;
        }
      }
    } catch (e) {
      // ignore
    }
    // Fallback to system preference if no manual setting
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }

  private saveThemePrefs(prefs: ThemePrefs): void {
    try {
      localStorage.setItem(THEME_PREFS_KEY, JSON.stringify(prefs));
    } catch (e) {
      // ignore
    }
  }

  private applyTheme(theme: Theme): void {
    const isDark = theme === "dark";
    if (isDark) {
      document.documentElement.classList.add("dark");
      if (document.body) document.body.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
      if (document.body) document.body.classList.remove("dark");
    }
    this.fixPlaceholderColors(isDark);
  }

  private fixPlaceholderColors(isDark: boolean): void {
    const styleId = "droppr-placeholder-fix";
    let style = document.getElementById(styleId);
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }

    const placeholderColor = isDark ? "#94a3b8" : "#475569";
    style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      input::placeholder, input::-webkit-input-placeholder {
        color: ${placeholderColor} !important;
        opacity: 1 !important;
        -webkit-text-fill-color: ${placeholderColor} !important;
      }
      input::-moz-placeholder {
        color: ${placeholderColor} !important;
        opacity: 1 !important;
      }
      input:-ms-input-placeholder {
        color: ${placeholderColor} !important;
      }
    `;
    document.head.appendChild(style);
  }
}

export const themeService = new ThemeService();

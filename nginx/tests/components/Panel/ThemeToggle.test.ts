import { describe, it, expect, vi, beforeEach } from "vitest";
import { ThemeToggle } from "../../../src/components/Panel/ThemeToggle";
import { themeService } from "../../../src/services/theme";

vi.mock("../../../src/services/theme", () => ({
  themeService: {
    getTheme: vi.fn(),
    toggle: vi.fn(),
  },
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("should create button and set initial state (Dark)", () => {
    vi.mocked(themeService.getTheme).mockReturnValue("dark");
    new ThemeToggle();
    const btn = document.getElementById("droppr-theme-toggle");
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toBe("🌙");
    expect(btn?.title).toBe("Switch to light theme");
  });

  it("should create button and set initial state (Light)", () => {
    vi.mocked(themeService.getTheme).mockReturnValue("light");
    new ThemeToggle();
    const btn = document.getElementById("droppr-theme-toggle");
    expect(btn).toBeTruthy();
    expect(btn?.textContent).toBe("☀️");
    expect(btn?.title).toBe("Switch to dark theme");
  });

  it("should toggle theme on click", () => {
    vi.mocked(themeService.getTheme).mockReturnValue("dark");
    new ThemeToggle();
    const btn = document.getElementById("droppr-theme-toggle");
    btn?.click();
    expect(themeService.toggle).toHaveBeenCalled();
  });

  it("should update button when theme changes", () => {
    vi.mocked(themeService.getTheme).mockReturnValue("light");
    new ThemeToggle();
    const btn = document.getElementById("droppr-theme-toggle");
    expect(btn?.textContent).toBe("☀️");

    // Simulate event
    const event = new CustomEvent("droppr:theme-changed", { detail: { theme: "dark" } });
    window.dispatchEvent(event);

    expect(btn?.textContent).toBe("🌙");
  });
});

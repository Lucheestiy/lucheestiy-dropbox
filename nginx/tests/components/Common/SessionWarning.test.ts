import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionWarning } from "../../../src/components/Common/SessionWarning";
import * as authService from "../../../src/services/auth";

// Mock the auth service
vi.mock("../../../src/services/auth", () => ({
  ensureDropprAccessToken: vi.fn(),
  getSessionExpiryMs: vi.fn(),
}));

describe("SessionWarning", () => {
  beforeEach(() => {
    // Clean up DOM
    document.body.innerHTML = "";
    // Remove style if exists (though document.head cleanup might be tricky if other tests rely on it, but here we are in isolation mostly)
    const style = document.getElementById("droppr-session-warning-style");
    if (style) style.remove();
    
    vi.useFakeTimers();
    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should inject styles and create element on instantiation", () => {
    new SessionWarning();
    expect(document.getElementById("droppr-session-warning-style")).toBeTruthy();
    expect(document.getElementById("droppr-session-warning")).toBeTruthy();
  });

  it("should be hidden if session is not expiring soon", () => {
    // 10 minutes remaining (threshold is 5 mins)
    vi.mocked(authService.getSessionExpiryMs).mockReturnValue(Date.now() + 10 * 60 * 1000);
    
    new SessionWarning();
    const el = document.getElementById("droppr-session-warning");
    expect(el?.style.display).toBe("none");
  });

  it("should be visible if session is expiring soon", () => {
    // 4 minutes remaining
    vi.mocked(authService.getSessionExpiryMs).mockReturnValue(Date.now() + 4 * 60 * 1000);
    
    new SessionWarning();
    const el = document.getElementById("droppr-session-warning");
    expect(el?.style.display).toBe("inline-flex");
    expect(el?.textContent).toContain("Session expires in 4 min.");
  });

  it("should update periodically", () => {
    // Initially not expiring
    vi.mocked(authService.getSessionExpiryMs).mockReturnValue(Date.now() + 10 * 60 * 1000);
    new SessionWarning();
    const el = document.getElementById("droppr-session-warning");
    expect(el?.style.display).toBe("none");

    // Advance time and mock expiry to be soon
    // Note: In the real world, getSessionExpiryMs returns a fixed timestamp. 
    // The component calculates remaining = exp - Date.now().
    // So if we keep exp fixed but advance time, it should work.
    
    const futureExp = Date.now() + 6 * 60 * 1000; // Expires in 6 mins from now
    vi.mocked(authService.getSessionExpiryMs).mockReturnValue(futureExp);
    
    // Force update immediately (constructor calls update)
    // Wait, constructor called update with the mock value above? No, we created new SessionWarning() with +10 mins.
    
    // Let's create a stable expiry time
    const expiryTime = Date.now() + 6 * 60 * 1000; // 6 mins from start
    vi.mocked(authService.getSessionExpiryMs).mockReturnValue(expiryTime);
    
    new SessionWarning();
    // At start: 6 mins remaining > 5 mins threshold -> hidden
    expect(el?.style.display).toBe("none");

    // Advance 2 minutes. Now remaining should be 4 minutes.
    vi.advanceTimersByTime(2 * 60 * 1000); 
    
    // The component calls update() every 60s.
    // Inside update(): remaining = expiryTime - Date.now()
    // Since we use fake timers, Date.now() should also advance? 
    // Vitest's vi.useFakeTimers() mocks Date.
    
    expect(el?.style.display).toBe("inline-flex");
    expect(el?.textContent).toContain("Session expires in 4 min.");
  });

  it("should call ensureDropprAccessToken on refresh click", () => {
    vi.mocked(authService.getSessionExpiryMs).mockReturnValue(Date.now() + 4 * 60 * 1000);
    new SessionWarning();
    
    const btn = document.querySelector("#droppr-session-warning .btn") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    
    btn.click();
    expect(authService.ensureDropprAccessToken).toHaveBeenCalledWith(true);
  });
});

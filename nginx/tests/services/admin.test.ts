import { describe, it, expect, vi, beforeEach } from "vitest";
import { adminService } from "../../src/services/admin";
import * as api from "../../src/services/api";
import * as auth from "../../src/services/auth";

vi.mock("../../src/services/api");
vi.mock("../../src/services/auth");

describe("AdminService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset internal state
    adminService.isAdmin = null;
    (adminService as any).checkPromise = null;
  });

  it("should return false if not logged in", async () => {
    vi.mocked(auth.isLoggedIn).mockReturnValue(false);
    const result = await adminService.check();
    expect(result).toBe(false);
    expect(adminService.isAdmin).toBe(false);
  });

  it("should return cached value if already checked", async () => {
    vi.mocked(auth.isLoggedIn).mockReturnValue(true);
    adminService.isAdmin = true;
    
    const result = await adminService.check();
    expect(result).toBe(true);
    expect(api.dropprFetch).not.toHaveBeenCalled();
  });

  it("should fetch user config and return true if successful", async () => {
    vi.mocked(auth.isLoggedIn).mockReturnValue(true);
    vi.mocked(api.dropprFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ root: "/custom" }),
    } as Response);

    const result = await adminService.check();
    expect(result).toBe(true);
    expect(adminService.isAdmin).toBe(true);
    expect(adminService.config.root).toBe("/custom");
  });

  it("should return false if fetch fails", async () => {
    vi.mocked(auth.isLoggedIn).mockReturnValue(true);
    vi.mocked(api.dropprFetch).mockResolvedValue({
      ok: false,
    } as Response);

    const result = await adminService.check();
    expect(result).toBe(false);
    expect(adminService.isAdmin).toBe(false);
  });

  it("should return false if fetch throws exception", async () => {
    vi.mocked(auth.isLoggedIn).mockReturnValue(true);
    vi.mocked(api.dropprFetch).mockRejectedValue(new Error("Network error"));

    const result = await adminService.check();
    expect(result).toBe(false);
    expect(adminService.isAdmin).toBe(false);
  });
});

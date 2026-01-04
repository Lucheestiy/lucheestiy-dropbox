import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HeaderButtons } from "../../../src/components/Panel/HeaderButtons";
import { isLoggedIn } from "../../../src/services/auth";
import { adminService } from "../../../src/services/admin";

// Mock dependencies
vi.mock("../../../src/services/auth");
vi.mock("../../../src/services/admin", () => ({
  adminService: {
    check: vi.fn(),
  },
}));

// Mock the modal classes
vi.mock("../../../src/components/Panel/AccountsModal", () => ({
  AccountsModal: vi.fn().mockImplementation(() => ({
    show: vi.fn(),
  })),
}));
vi.mock("../../../src/components/Panel/RequestModal", () => ({
  RequestModal: vi.fn().mockImplementation(() => ({
    show: vi.fn(),
  })),
}));

describe("HeaderButtons", () => {
  let originalMutationObserver: typeof MutationObserver;

  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();

    // Mock MutationObserver to prevent multiple observers piling up and to simplify testing
    originalMutationObserver = globalThis.MutationObserver;
    globalThis.MutationObserver = vi.fn().mockImplementation(() => ({
      observe: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn(),
    })) as unknown as typeof MutationObserver;

    // Default mocks
    vi.mocked(isLoggedIn).mockReturnValue(false);
    vi.mocked(adminService.check).mockResolvedValue(false);
  });

  afterEach(() => {
    globalThis.MutationObserver = originalMutationObserver;
  });

  it("should show Stream button if URL has share hash", () => {
    // Simulate URL with share hash
    window.history.pushState({}, "Test", "/gallery/somehash");

    new HeaderButtons();
    const btn = document.getElementById("droppr-stream-btn") as HTMLAnchorElement;
    expect(btn).toBeTruthy();
    expect(btn.href).toContain("/stream/somehash");
  });

  it("should NOT show Stream button if URL has no share hash", () => {
    window.history.pushState({}, "Test", "/files");
    new HeaderButtons();
    const btn = document.getElementById("droppr-stream-btn");
    expect(btn).toBeNull();
  });

  it("should show Accounts and Request buttons if logged in, admin, and on files page", async () => {
    window.history.pushState({}, "Test", "/files/something");
    vi.mocked(isLoggedIn).mockReturnValue(true);
    vi.mocked(adminService.check).mockResolvedValue(true);

    new HeaderButtons();

    // checkButtons calls ensureAccountsButton which is async
    // We need to wait for promises to resolve.
    // Since we mocked adminService.check with a resolved promise, we can wait a bit.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const accountsBtn = document.getElementById("droppr-accounts-btn");
    const requestBtn = document.getElementById("droppr-request-btn");

    expect(accountsBtn).toBeTruthy();
    expect(requestBtn).toBeTruthy();
  });

  it("should NOT show Accounts/Request buttons if not logged in", async () => {
    window.history.pushState({}, "Test", "/files");
    vi.mocked(isLoggedIn).mockReturnValue(false);
    vi.mocked(adminService.check).mockResolvedValue(true);

    new HeaderButtons();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(document.getElementById("droppr-accounts-btn")).toBeNull();
    expect(document.getElementById("droppr-request-btn")).toBeNull();
  });

  it("should NOT show Accounts/Request buttons if not admin", async () => {
    window.history.pushState({}, "Test", "/files");
    vi.mocked(isLoggedIn).mockReturnValue(true);
    vi.mocked(adminService.check).mockResolvedValue(false);

    new HeaderButtons();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(document.getElementById("droppr-accounts-btn")).toBeNull();
    expect(document.getElementById("droppr-request-btn")).toBeNull();
  });

  it("should NOT show Accounts/Request buttons if not on files page", async () => {
    window.history.pushState({}, "Test", "/settings"); // Not starting with /files
    vi.mocked(isLoggedIn).mockReturnValue(true);
    vi.mocked(adminService.check).mockResolvedValue(true);

    new HeaderButtons();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(document.getElementById("droppr-accounts-btn")).toBeNull();
    expect(document.getElementById("droppr-request-btn")).toBeNull();
  });
});

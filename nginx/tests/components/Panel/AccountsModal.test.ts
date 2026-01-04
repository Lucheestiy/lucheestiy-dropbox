import { describe, it, expect, vi, beforeEach } from "vitest";
import { AccountsModal } from "../../../src/components/Panel/AccountsModal";
import * as api from "../../../src/services/api";

vi.mock("../../../src/services/api", () => ({
  dropprFetch: vi.fn(),
}));

describe("AccountsModal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("should render the modal", () => {
    const modal = new AccountsModal();
    modal.show();

    expect(document.getElementById("droppr-accounts-modal")).toBeTruthy();
    expect(document.querySelector(".title")?.textContent).toBe("Create upload account");
  });

  it("should validate username", async () => {
    const modal = new AccountsModal();
    modal.show();

    const usernameInput = document.getElementById("droppr-account-username") as HTMLInputElement;
    const createBtn = document.querySelector('[data-action="create"]') as HTMLButtonElement;
    const statusEl = document.getElementById("droppr-account-status");

    usernameInput.value = "a"; // Too short
    createBtn.click();

    expect(statusEl?.textContent).toContain("Username must be 3-32 characters");
  });

  it("should validate password length", async () => {
    const modal = new AccountsModal();
    modal.show();

    const usernameInput = document.getElementById("droppr-account-username") as HTMLInputElement;
    const passwordInput = document.getElementById("droppr-account-password") as HTMLInputElement;
    const createBtn = document.querySelector('[data-action="create"]') as HTMLButtonElement;
    const statusEl = document.getElementById("droppr-account-status");

    usernameInput.value = "testuser";
    passwordInput.value = "short";
    createBtn.click();

    expect(statusEl?.textContent).toContain("Password must be at least 8 characters");
  });

  it("should call api on submit", async () => {
    const modal = new AccountsModal();
    modal.show();

    const usernameInput = document.getElementById("droppr-account-username") as HTMLInputElement;
    const passwordInput = document.getElementById("droppr-account-password") as HTMLInputElement;
    const createBtn = document.querySelector('[data-action="create"]') as HTMLButtonElement;

    usernameInput.value = "testuser";
    passwordInput.value = "password123";

    const mockResponse = new Response(JSON.stringify({ scope: "/users/testuser" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    vi.mocked(api.dropprFetch).mockResolvedValue(mockResponse);

    createBtn.click();

    // Wait for the async submit to complete and update the DOM
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(api.dropprFetch).toHaveBeenCalledWith(
      "/api/droppr/users",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ username: "testuser", password: "password123" }),
      })
    );

    const statusEl = document.getElementById("droppr-account-status");
    expect(statusEl?.textContent).toContain("Account created");
  });

  it("should close the modal on cancel", () => {
    const modal = new AccountsModal();
    modal.show();

    const cancelBtn = document.querySelector('[data-action="cancel"]') as HTMLButtonElement;
    cancelBtn.click();

    expect(document.getElementById("droppr-accounts-modal")).toBeNull();
  });
});

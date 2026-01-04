import { describe, it, expect, vi, beforeEach } from "vitest";
import { RequestModal } from "../../../src/components/Panel/RequestModal";
import * as api from "../../../src/services/api";

vi.mock("../../../src/services/api", () => ({
  dropprFetch: vi.fn(),
}));

describe("RequestModal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("should render the modal", () => {
    const modal = new RequestModal();
    modal.show();

    expect(document.getElementById("droppr-request-modal")).toBeTruthy();
    expect(document.querySelector(".title")?.textContent).toBe("Create file request");
  });

  it("should validate path", async () => {
    const modal = new RequestModal();
    modal.show();

    const pathInput = document.getElementById("droppr-request-path") as HTMLInputElement;
    const createBtn = document.querySelector('[data-action="create"]') as HTMLButtonElement;
    const statusEl = document.getElementById("droppr-request-status");

    pathInput.value = "";
    createBtn.click();

    expect(statusEl?.textContent).toContain("Folder path is required");
  });

  it("should toggle password field", () => {
    const modal = new RequestModal();
    modal.show();

    const toggle = document.getElementById("droppr-request-password-toggle") as HTMLInputElement;
    const wrap = document.getElementById("droppr-request-password-wrap");

    expect(wrap?.classList.contains("show")).toBe(false);
    
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change"));
    expect(wrap?.classList.contains("show")).toBe(true);
  });

  it("should call api on submit and show result", async () => {
    const modal = new RequestModal();
    modal.show();

    const pathInput = document.getElementById("droppr-request-path") as HTMLInputElement;
    const createBtn = document.querySelector('[data-action="create"]') as HTMLButtonElement;

    pathInput.value = "/uploads";

    const mockResponse = {
      ok: true,
      json: () => Promise.resolve({ url: "/request/abc", hash: "abc" }),
    };
    (api.dropprFetch as any).mockResolvedValue(mockResponse);

    createBtn.click();
    
    // Wait for the async submit to complete and update the DOM
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(api.dropprFetch).toHaveBeenCalledWith("/api/droppr/requests", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ path: "/uploads", expires_hours: 0, password: "" }),
    }));
    
    expect(document.getElementById("droppr-request-result")?.classList.contains("show")).toBe(true);
    const linkInput = document.getElementById("droppr-request-link") as HTMLInputElement;
    expect(linkInput.value).toContain("/request/abc");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutoShareModal } from "../../../src/components/Panel/AutoShareModal";
import * as format from "../../../src/utils/format";

vi.mock("../../../src/utils/format", () => ({
  copyText: vi.fn(() => Promise.resolve()),
}));

describe("AutoShareModal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("should render the modal with options", () => {
    const modal = new AutoShareModal();
    modal.show({
      title: "Test Title",
      subtitle: "Test Subtitle",
      url: "http://example.com",
    });

    expect(document.getElementById("droppr-auto-share-modal")).toBeTruthy();
    expect(document.querySelector(".title")?.textContent).toBe("Test Title");
    expect(document.querySelector(".subtitle")?.textContent).toBe("Test Subtitle");
    const input = document.querySelector("input") as HTMLInputElement;
    expect(input.value).toBe("http://example.com");
  });

  it("should call copyText on copy button click", async () => {
    const modal = new AutoShareModal();
    modal.show({ url: "http://example.com" });

    const copyBtn = document.querySelector('[data-action="copy"]') as HTMLButtonElement;
    copyBtn.click();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(format.copyText).toHaveBeenCalledWith("http://example.com");
    expect(copyBtn.textContent).toBe("Copied");
  });

  it("should auto-copy if option is set", () => {
    const modal = new AutoShareModal();
    modal.show({ url: "http://example.com", autoCopy: true });

    expect(format.copyText).toHaveBeenCalledWith("http://example.com");
  });

  it("should dismiss the modal", () => {
    const modal = new AutoShareModal();
    modal.show({ url: "http://example.com" });

    modal.dismiss();
    expect(document.getElementById("droppr-auto-share-modal")).toBeNull();
  });
});

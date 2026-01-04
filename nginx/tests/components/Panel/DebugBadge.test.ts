import { describe, it, expect, vi, beforeEach } from "vitest";
import { DebugBadge } from "../../../src/components/Panel/DebugBadge";
import * as debug from "../../../src/utils/debug";

vi.mock("../../../src/utils/debug", () => ({
  isDropprDebugEnabled: vi.fn(() => true),
}));

describe("DebugBadge", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("should render if debug is enabled", () => {
    vi.mocked(debug.isDropprDebugEnabled).mockReturnValue(true);
    new DebugBadge();
    expect(document.getElementById("droppr-debug-badge")).toBeTruthy();
  });

  it("should not render if debug is disabled", () => {
    vi.mocked(debug.isDropprDebugEnabled).mockReturnValue(false);
    new DebugBadge();
    expect(document.getElementById("droppr-debug-badge")).toBeNull();
  });

  it("should update text", () => {
    vi.mocked(debug.isDropprDebugEnabled).mockReturnValue(true);
    const badge = new DebugBadge();
    badge.setText("Updated Text");
    expect(document.getElementById("droppr-debug-badge")?.textContent).toBe("Updated Text");
  });
});

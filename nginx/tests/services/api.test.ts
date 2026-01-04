import { describe, it, expect, vi, beforeEach } from "vitest";
import { dropprFetch } from "../../src/services/api";
import * as authService from "../../src/services/auth";

vi.mock("../../src/services/auth", () => ({
  ensureDropprAccessToken: vi.fn(),
  getFileBrowserToken: vi.fn(),
}));

// Mock global fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("dropprFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(new Response("ok"));
  });

  it("should add Authorization header if access token is available", async () => {
    vi.mocked(authService.ensureDropprAccessToken).mockResolvedValue("test-token");

    await dropprFetch("/api/test");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({
        headers: expect.any(Headers),
      })
    );

    // Check headers from the call arguments
    const callArgs = fetchMock.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("should add X-Auth header if no access token but fb token exists", async () => {
    vi.mocked(authService.ensureDropprAccessToken).mockResolvedValue(null);
    vi.mocked(authService.getFileBrowserToken).mockReturnValue("fb-token");

    await dropprFetch("/api/test");

    const callArgs = fetchMock.mock.calls[0];
    const headers = callArgs[1].headers;
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("X-Auth")).toBe("fb-token");
  });

  it("should pass through other options", async () => {
    vi.mocked(authService.ensureDropprAccessToken).mockResolvedValue("token");

    await dropprFetch("/api/test", { method: "POST", body: "data" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/test",
      expect.objectContaining({
        method: "POST",
        body: "data",
      })
    );
  });
});

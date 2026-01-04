import { describe, it, expect, vi, beforeEach } from "vitest";
import { reportError, getRecoverySuggestion } from "../../src/utils/error";

describe("Error Utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.Sentry = {
      captureException: vi.fn(),
      captureMessage: vi.fn(),
    } as unknown as SentrySDK;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("reportError", () => {
    it("should log to console and call Sentry.captureException for Error objects", () => {
      const error = new Error("Test error");
      const context = { foo: "bar" };

      reportError(error, { context });

      expect(console.error).toHaveBeenCalled();
      expect(window.Sentry?.captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          extra: context,
        })
      );
    });

    it("should call Sentry.captureMessage for string errors", () => {
      const error = "Something went wrong";

      reportError(error);

      expect(window.Sentry?.captureMessage).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          level: "error",
        })
      );
    });
  });

  describe("getRecoverySuggestion", () => {
    it("should return timeout suggestion", () => {
      expect(getRecoverySuggestion("request timeout")).toContain("timed out");
    });

    it("should return auth suggestion", () => {
      expect(getRecoverySuggestion("401 Unauthorized")).toContain("Access denied");
    });

    it("should return expired suggestion", () => {
      expect(getRecoverySuggestion("410 Expired")).toContain("expired");
    });

    it("should return rate limit suggestion", () => {
      expect(getRecoverySuggestion("429 Too Many Requests")).toContain("Too many requests");
    });

    it("should return file too large suggestion", () => {
      expect(getRecoverySuggestion("413 Payload Too Large")).toContain("too large");
    });

    it("should return unsupported type suggestion", () => {
      expect(getRecoverySuggestion("415 Unsupported Media Type")).toContain("not allowed");
    });

    it("should return generic suggestion for unknown errors", () => {
      expect(getRecoverySuggestion("Some weird error")).toContain("Try refreshing the page");
    });
  });
});

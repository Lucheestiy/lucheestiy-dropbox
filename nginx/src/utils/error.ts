export interface ErrorOptions {
  message?: string;
  context?: Record<string, unknown>;
  level?: "info" | "warning" | "error" | "fatal";
}

/**
 * Reports an error to the console and to Sentry if available.
 *
 * @param {Error|string} error The error object or message to report.
 * @param {ErrorOptions} options Additional reporting options.
 */
export function reportError(error: Error | string, options: ErrorOptions = {}): void {
  const Sentry = window.Sentry;

  const errorMessage = typeof error === "string" ? error : error.message;
  console.error(`[Droppr Error] ${errorMessage}`, options.context || "", error);

  if (!Sentry) return;

  if (typeof error === "string") {
    Sentry.captureMessage?.(error, {
      level: options.level || "error",
      extra: options.context,
    });
    return;
  }

  Sentry.captureException?.(error, {
    level: options.level || "error",
    extra: options.context,
  });
}

/**
 * Returns a user-friendly recovery suggestion based on the error message.
 *
 * @param {Error|string} error The error object or message.
 * @returns {string} A string containing a recovery suggestion (e.g., "Try refreshing the page").
 */
export function getRecoverySuggestion(error: Error | string): string {
  const msg = (typeof error === "string" ? error : error.message).toLowerCase();

  if (msg.includes("timeout") || msg.includes("abort")) {
    return "The request timed out. Try refreshing the page or checking your internet connection.";
  }
  if (
    msg.includes("401") ||
    msg.includes("403") ||
    msg.includes("auth") ||
    msg.includes("unauthorized")
  ) {
    return "Access denied. Try clearing your browser cookies and logging in again.";
  }
  if (msg.includes("404") || msg.includes("not found")) {
    return "The resource was not found. It might have been deleted or moved.";
  }
  if (msg.includes("410") || msg.includes("expired")) {
    return "This link has expired. Please ask the sender for a new one.";
  }
  if (msg.includes("429") || msg.includes("too many attempts") || msg.includes("rate limit")) {
    return "Too many requests. Please wait a few minutes and try again.";
  }
  if (msg.includes("413") || msg.includes("too large") || msg.includes("exceeds")) {
    return "The file is too large to be uploaded via this link.";
  }
  if (msg.includes("415") || msg.includes("unsupported type") || msg.includes("extension")) {
    return "This file type is not allowed for upload.";
  }
  if (msg.includes("500") || msg.includes("server error")) {
    return "The server encountered an error. Please try again in a few minutes.";
  }
  if (msg.includes("network") || msg.includes("fetch")) {
    return "Network error. Please check if you are connected to the internet.";
  }

  return "Try refreshing the page or clearing your browser cache if the problem persists.";
}

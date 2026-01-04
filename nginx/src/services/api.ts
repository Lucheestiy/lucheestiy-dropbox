import { ensureDropprAccessToken, getFileBrowserToken } from "./auth";
import { reportError } from "../utils/error";

/**
 * Enhanced fetch wrapper that automatically adds Droppr access token or FileBrowser auth token to headers.
 * Also includes automatic error reporting to Sentry for network and server errors.
 * 
 * @param {string} url The URL to fetch.
 * @param {RequestInit} options Standard fetch options.
 * @returns {Promise<Response>} The fetch response.
 */
export async function dropprFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const opts = { ...options };
  const headers = new Headers(opts.headers);

  const accessToken = await ensureDropprAccessToken(false);

  if (accessToken) {
    headers.set("Authorization", "Bearer " + accessToken);
  } else {
    const fbToken = getFileBrowserToken();
    if (fbToken) {
      headers.set("X-Auth", fbToken);
    }
  }

  opts.headers = headers;
  try {
    const res = await fetch(url, opts);
    if (!res.ok && res.status >= 500) {
      reportError(`Server error ${res.status} on ${url}`, {
        level: "warning",
        context: { url, status: res.status }
      });
    }
    return res;
  } catch (err) {
    reportError(err as Error, {
      context: { url, method: opts.method || "GET" }
    });
    throw err;
  }
}

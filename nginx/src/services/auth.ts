import { getCookie } from "../utils/cookie";
import { decodeJwtPayload } from "../utils/jwt";

export const DROPPR_ACCESS_TOKEN_KEY = "droppr_access_token";
export const DROPPR_REFRESH_TOKEN_KEY = "droppr_refresh_token";
export const DROPPR_OTP_KEY = "droppr_otp_code";

export interface TokenState {
  access: string | null;
  refresh: string | null;
  accessExp: number;
  refreshExp: number;
}

/**
 * Retrieves the FileBrowser authentication token from localStorage or cookies.
 * @returns {string|null} The authentication token if found, null otherwise.
 */
export function getFileBrowserToken(): string | null {
  try {
    const jwt = localStorage.getItem("jwt");
    if (jwt) return jwt;
  } catch (_e) {
    // ignore
  }

  const auth = getCookie("auth");
  if (auth) {
    try {
      return decodeURIComponent(auth);
    } catch (_e2) {
      return auth;
    }
  }

  return null;
}

/**
 * Checks if the user is logged in to FileBrowser.
 * @returns {boolean} True if logged in, false otherwise.
 */
export function isLoggedIn(): boolean {
  return !!getFileBrowserToken();
}

/**
 * Retrieves the current Droppr token state from localStorage and decodes JWT payloads.
 * @returns {TokenState} The current state including access/refresh tokens and their expiration timestamps.
 */
export function getDropprTokenState(): TokenState {
  let access: string | null = null;
  let refresh: string | null = null;
  try {
    access = localStorage.getItem(DROPPR_ACCESS_TOKEN_KEY);
    refresh = localStorage.getItem(DROPPR_REFRESH_TOKEN_KEY);
  } catch (_e) {
    access = null;
    refresh = null;
  }
  const accessPayload = decodeJwtPayload(access);
  const refreshPayload = decodeJwtPayload(refresh);
  return {
    access,
    refresh,
    accessExp: accessPayload && accessPayload.exp ? accessPayload.exp * 1000 : 0,
    refreshExp: refreshPayload && refreshPayload.exp ? refreshPayload.exp * 1000 : 0,
  };
}

/**
 * Saves Droppr access and refresh tokens to localStorage and dispatches a 'droppr:tokens-updated' event.
 * @param {string|null} access The new access token.
 * @param {string|null} refresh The new refresh token.
 */
export function saveDropprTokens(access: string | null, refresh: string | null): void {
  try {
    if (access) localStorage.setItem(DROPPR_ACCESS_TOKEN_KEY, access);
    if (refresh) localStorage.setItem(DROPPR_REFRESH_TOKEN_KEY, refresh);
  } catch (_e) {
    // ignore
  }
  window.dispatchEvent(new Event("droppr:tokens-updated"));
}

/**
 * Clears Droppr tokens from localStorage and dispatches a 'droppr:tokens-updated' event.
 */
export function clearDropprTokens(): void {
  try {
    localStorage.removeItem(DROPPR_ACCESS_TOKEN_KEY);
    localStorage.removeItem(DROPPR_REFRESH_TOKEN_KEY);
  } catch (_e) {
    // ignore
  }
  window.dispatchEvent(new Event("droppr:tokens-updated"));
}

/**
 * Retrieves the stored 2FA OTP code from sessionStorage.
 * @returns {string} The OTP code or an empty string.
 */
export function getDropprOtpCode(): string {
  try {
    return sessionStorage.getItem(DROPPR_OTP_KEY) || "";
  } catch (_e) {
    return "";
  }
}

/**
 * Saves or removes the 2FA OTP code in sessionStorage.
 * @param {string} code The OTP code to save, or empty string to remove.
 */
export function saveDropprOtpCode(code: string): void {
  try {
    if (code) {
      sessionStorage.setItem(DROPPR_OTP_KEY, code);
    } else {
      sessionStorage.removeItem(DROPPR_OTP_KEY);
    }
  } catch (_e) {
    // ignore
  }
}

/**
 * Prompts the user to enter their 2FA OTP code using a window.prompt.
 * @returns {string} The entered OTP code or an empty string if cancelled.
 */
export function promptForOtp(): string {
  const code = window.prompt("Enter your 2FA code:");
  if (code) {
    saveDropprOtpCode(code);
    return code;
  }
  return "";
}

async function parseDropprAuthResponse(res: Response) {
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_e) {
      data = null;
    }
  }
  return { res, data };
}

/**
 * Performs a login to exchange a FileBrowser token for Droppr access/refresh tokens.
 * @param {boolean} allowPrompt Whether to prompt for OTP if required.
 * @returns {Promise<string|null>} The access token if successful, null otherwise.
 */
export async function loginDropprToken(allowPrompt = true): Promise<string | null> {
  const fbToken = getFileBrowserToken();
  if (!fbToken) return null;

  const headers: Record<string, string> = { "X-Auth": fbToken };
  const otp = getDropprOtpCode();
  if (otp) headers["X-Droppr-OTP"] = otp;

  try {
    const response = await fetch("/api/droppr/auth/login", { method: "POST", headers });
    const { res, data } = await parseDropprAuthResponse(response);

    if (res.status === 401 && data && data.otp_required && allowPrompt) {
      const code = promptForOtp();
      if (!code) return null;
      return loginDropprToken(false);
    }

    if (!res.ok) return null;

    if (data && data.access_token) {
      saveDropprTokens(data.access_token, data.refresh_token);
      return data.access_token;
    }
  } catch (_e) {
    // console.error("Login failed", _e);
  }
  return null;
}

/**
 * Refreshes the Droppr access token using a refresh token.
 * @param {string} refreshToken The refresh token to use.
 * @param {boolean} allowPrompt Whether to prompt for OTP if required.
 * @returns {Promise<string|null>} The new access token if successful, null otherwise.
 */
export async function refreshDropprToken(
  refreshToken: string,
  allowPrompt = true
): Promise<string | null> {
  if (!refreshToken) return null;
  const headers: Record<string, string> = { Authorization: "Bearer " + refreshToken };
  const otp = getDropprOtpCode();
  if (otp) headers["X-Droppr-OTP"] = otp;

  try {
    const response = await fetch("/api/droppr/auth/refresh", { method: "POST", headers });
    const { res, data } = await parseDropprAuthResponse(response);

    if (res.status === 401 && data && data.otp_required && allowPrompt) {
      const code = promptForOtp();
      if (!code) return null;
      return refreshDropprToken(refreshToken, false);
    }

    if (!res.ok) {
      return null;
    }

    if (data && data.access_token) {
      saveDropprTokens(data.access_token, data.refresh_token);
      return data.access_token;
    }
  } catch (_e) {
    // console.error("Refresh failed", _e);
  }
  return null;
}

/**
 * Ensures that a valid Droppr access token is available.
 * If current token is expired or soon-to-expire, it tries to refresh or login.
 * @param {boolean} force Whether to force a refresh/login even if current token is still valid.
 * @returns {Promise<string|null>} A valid access token if available, null otherwise.
 */
export async function ensureDropprAccessToken(force = false): Promise<string | null> {
  const state = getDropprTokenState();
  const now = Date.now();

  // If we have a valid access token (buffer 60s), use it.
  if (!force && state.access && state.accessExp > now + 60000) {
    return state.access;
  }

  // If we have a refresh token, try to refresh
  if (state.refresh && state.refreshExp > now + 60000) {
    const newToken = await refreshDropprToken(state.refresh, true);
    if (newToken) return newToken;
  }

  // Fallback: try to login (exchange FB token for Droppr token)

  return await loginDropprToken(true);
}

/**
 * Calculates the earliest session expiry timestamp in milliseconds.
 * Checks both Droppr access token and FileBrowser token.
 * @returns {number} Expiration timestamp in ms, or 0 if no tokens found.
 */
export function getSessionExpiryMs(): number {
  const state = getDropprTokenState();

  if (state.access && state.accessExp) return state.accessExp;

  const fbToken = getFileBrowserToken();

  const payload = decodeJwtPayload(fbToken);

  if (payload && payload.exp) return payload.exp * 1000;

  return 0;
}

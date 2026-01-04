export interface JwtPayload {
  exp?: number;
  [key: string]: any;
}

export function decodeJwtPayload(token: string | null): JwtPayload | null {
  if (!token) return null;
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4 ? "====".slice(payload.length % 4) : "";
    const json = atob(payload + pad);
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

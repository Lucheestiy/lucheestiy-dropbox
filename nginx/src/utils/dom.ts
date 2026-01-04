export function normalizeUrl(input: string): URL | null {
  try {
    return new URL(input, window.location.href);
  } catch (e) {
    return null;
  }
}

export function extractApiPath(urlLike: string, prefix: string): string | null {
  const u = normalizeUrl(urlLike);
  if (!u) return null;
  if (u.pathname === prefix) return "";
  if (u.pathname.indexOf(prefix + "/") !== 0) return null;
  return u.pathname.substring(prefix.length);
}

export function normalizePathEncoded(pathEncoded: string): string {
  let p = String(pathEncoded || "");
  if (p === "") return "/";
  if (p.charAt(0) !== "/") p = "/" + p;
  if (p.length > 1 && p.charAt(p.length - 1) === "/") p = p.slice(0, -1);
  return p;
}

export function sanitizeFileName(name: string): string {
  let s = String(name || "");
  s = s.split("/").pop() || s;
  s = s.split("\\").pop() || s;
  return s;
}

export function pathEndsWithFileName(pathEncoded: string, fileName: string): boolean {
  if (!pathEncoded || !fileName) return false;
  const last = String(pathEncoded).split("/").pop() || "";
  try {
    if (decodeURIComponent(last) === fileName) return true;
  } catch (e) {
    // ignore
  }
  return last === encodeURIComponent(fileName);
}

export function joinDirAndFileEncoded(dirEncoded: string, fileName: string): string {
  const dir = normalizePathEncoded(dirEncoded);
  const base = sanitizeFileName(fileName);
  const encodedName = encodeURIComponent(base);
  if (dir === "/") return "/" + encodedName;
  return dir + "/" + encodedName;
}

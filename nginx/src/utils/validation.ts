import { extractApiPath } from "../utils/dom";

export function extractResourcePath(urlLike: string): string | null {
  return extractApiPath(urlLike, "/api/resources");
}

export function extractTusPath(urlLike: string): string | null {
  return extractApiPath(urlLike, "/api/tus");
}

export function hasBinaryBody(body: any): boolean {
  if (!body) return false;
  if (typeof FormData !== "undefined" && body instanceof FormData) return true;
  if (typeof Blob !== "undefined" && body instanceof Blob) return true;
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return true;
  if (typeof Uint8Array !== "undefined" && body instanceof Uint8Array) return true;
  return false;
}

export function getBodyFileNames(body: any): string[] {
  const names: string[] = [];
  const seen: Record<string, boolean> = {};

  const add = (name: string) => {
    if (!name) return;
    if (seen[name]) return;
    seen[name] = true;
    names.push(name);
  };

  if (!body) return names;

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    try {
      const it = (body as any).entries();
      let e = it.next();
      while (!e.done) {
        const v = e.value && e.value[1];
        if (v && typeof v === "object" && typeof v.name === "string") add(v.name);
        e = it.next();
      }
    } catch (e2) {
      // ignore
    }

    return names;
  }

  if (body && typeof body === "object" && typeof body.name === "string") add(body.name);
  return names;
}

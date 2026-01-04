import { uploadService } from "./upload";
import {
  extractResourcePath,
  extractTusPath,
  hasBinaryBody,
  getBodyFileNames,
} from "../utils/validation";
import { normalizePathEncoded, pathEndsWithFileName, joinDirAndFileEncoded } from "../utils/dom";

interface TusEntry {
  path: string;
  item: any;
  uploadLength: number | null;
  lastSeenAt: number;
  timer: number | null;
}

export class XhrInterceptor {
  private tusUploads: Record<string, TusEntry> = {};

  constructor() {
    this.interceptXhr();
    this.interceptFetch();
  }

  private interceptFetch() {
    if (!window.fetch) return;

    const origFetch = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      let urlLike = "";
      let method = "GET";
      let body: unknown = null;
      let headers: HeadersInit | null = null;

      if (typeof input === "string") {
        urlLike = input;
      } else if (input instanceof URL) {
        urlLike = input.href;
      } else if (input && typeof input === "object") {
        urlLike = (input as Request).url;
        method = (input as Request).method || method;
        headers = (input as Request).headers || headers;
      }

      if (init) {
        if (init.method) method = init.method;
        if (init.body) body = init.body;
        if (init.headers) headers = init.headers;
      }

      const mUpper = String(method || "GET").toUpperCase();
      let tusEntry: TusEntry | null = null;
      const tusPath = this.getTusUploadPath(urlLike);

      if (tusPath && (mUpper === "POST" || mUpper === "PATCH")) {
        tusEntry = this.ensureTusEntry(tusPath);
        if (tusEntry && mUpper === "POST" && tusEntry.uploadLength == null) {
          const len = this.getHeaderValue(headers, "Upload-Length");
          tusEntry.uploadLength = len ? parseInt(len, 10) : null;
        }
      }

      const resourceRecords: any[] = [];
      const resourcePaths = this.getResourceUploadPaths(urlLike, method, body);
      for (let i = 0; i < resourcePaths.length; i++) {
        resourceRecords.push(uploadService.recordUploadStart(resourcePaths[i]));
      }

      const p = origFetch(input, init);
      if (!tusEntry && resourceRecords.length === 0) return p;

      return p.then(
        (resp) => {
          if (tusEntry) {
            if (!resp || !resp.ok) {
              this.finishTusEntry(tusEntry, false);
              return resp;
            }
            if (mUpper === "POST") {
              if (tusEntry.uploadLength === 0) this.finishTusEntry(tusEntry, true);
              return resp;
            }
            if (mUpper === "PATCH") {
              this.handleTusPatchProgress(
                tusEntry,
                resp.headers ? resp.headers.get("Upload-Offset") : null,
                resp.headers ? resp.headers.get("Upload-Length") : null
              );
            }
            return resp;
          }

          for (let i = 0; i < resourceRecords.length; i++) {
            uploadService.recordUploadDone(resourceRecords[i], resp && resp.ok);
          }
          return resp;
        },
        (err) => {
          if (tusEntry) {
            this.finishTusEntry(tusEntry, false);
          } else {
            for (let i = 0; i < resourceRecords.length; i++) {
              uploadService.recordUploadDone(resourceRecords[i], false);
            }
          }
          throw err;
        }
      );
    };
  }

  private getHeaderValue(headers: any, name: string): string | null {
    if (!headers) return null;
    const lowerName = name.toLowerCase();
    if (headers instanceof Headers) {
      return headers.get(lowerName);
    }
    if (Array.isArray(headers)) {
      for (const [key, value] of headers) {
        if (key.toLowerCase() === lowerName) return value;
      }
    }
    if (typeof headers === "object") {
      for (const key in headers) {
        if (key.toLowerCase() === lowerName) return (headers as any)[key];
      }
    }
    return null;
  }

  private interceptXhr() {
    const origOpen = window.XMLHttpRequest.prototype.open;
    const origSend = window.XMLHttpRequest.prototype.send;
    const origSetRequestHeader = window.XMLHttpRequest.prototype.setRequestHeader;

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    (window.XMLHttpRequest.prototype as any).open = function (
      this: any,
      method: string,
      url: string | URL,
      ...args: any[]
    ) {
      this.__dropprMethod = method;
      this.__dropprUrl = url;
      this.__dropprHeaders = {};
      return (origOpen as any).apply(this, [method, url, ...args]);
    };

    (window.XMLHttpRequest.prototype as any).setRequestHeader = function (
      this: any,
      name: string,
      value: string
    ) {
      try {
        if (this.__dropprHeaders && name) {
          this.__dropprHeaders[String(name).toLowerCase()] = value;
        }
      } catch (_e) {
        /* ignore */
      }
      return (origSetRequestHeader as any).apply(this, [name, value]);
    };

    (window.XMLHttpRequest.prototype as any).send = function (this: any, body: any) {
      const method = this.__dropprMethod || "GET";
      const urlLike = String(this.__dropprUrl || "");
      const mUpper = String(method).toUpperCase();

      let tusEntry: TusEntry | null = null;
      const tusPath = self.getTusUploadPath(urlLike);
      if (tusPath && (mUpper === "POST" || mUpper === "PATCH")) {
        tusEntry = self.ensureTusEntry(tusPath);
        if (tusEntry && mUpper === "POST" && tusEntry.uploadLength == null) {
          const len = this.__dropprHeaders && this.__dropprHeaders["upload-length"];
          tusEntry.uploadLength = len ? parseInt(len, 10) : null;
        }
      }

      const resourceRecords: any[] = [];
      const resourcePaths = self.getResourceUploadPaths(urlLike, method, body);
      for (let i = 0; i < resourcePaths.length; i++) {
        resourceRecords.push(uploadService.recordUploadStart(resourcePaths[i]));
      }

      if (tusEntry || resourceRecords.length) {
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const xhr = this;
        const onDone = function () {
          xhr.removeEventListener("loadend", onDone);
          const ok = xhr.status >= 200 && xhr.status < 300;

          if (tusEntry) {
            if (!ok) {
              self.finishTusEntry(tusEntry, false);
              return;
            }
            if (mUpper === "POST") {
              if (tusEntry.uploadLength === 0) self.finishTusEntry(tusEntry, true);
              return;
            }
            if (mUpper === "PATCH") {
              const off = xhr.getResponseHeader("Upload-Offset");
              const len = xhr.getResponseHeader("Upload-Length");
              self.handleTusPatchProgress(tusEntry, off, len);
            }
            return;
          }

          for (let i = 0; i < resourceRecords.length; i++) {
            uploadService.recordUploadDone(resourceRecords[i], ok);
          }
        };
        xhr.addEventListener("loadend", onDone);
      }

      return (origSend as any).apply(this, [body]);
    };
  }

  private getTusUploadPath(urlLike: string): string | null {
    const rawPath = extractTusPath(urlLike);
    if (rawPath == null) return null;
    const p = normalizePathEncoded(rawPath);
    if (!p || p === "/") return null;
    return p;
  }

  private ensureTusEntry(pathEncoded: string): TusEntry | null {
    const p = normalizePathEncoded(pathEncoded);
    if (!p || p === "/") return null;

    const existing = this.tusUploads[p];
    if (existing && existing.item && !existing.item.done) return existing;

    const item = uploadService.recordUploadStart(p);
    const entry: TusEntry = { path: p, item, uploadLength: null, lastSeenAt: 0, timer: null };
    this.tusUploads[p] = entry;
    return entry;
  }

  private finishTusEntry(entry: TusEntry, ok: boolean) {
    if (!entry || !entry.item || entry.item.done) return;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    delete this.tusUploads[entry.path];
    uploadService.recordUploadDone(entry.item, ok);
  }

  private handleTusPatchProgress(
    entry: TusEntry,
    offsetValue: string | null,
    lengthValue: string | null
  ) {
    if (!entry || !entry.item || entry.item.done) return;

    const offset = offsetValue ? parseInt(offsetValue, 10) : null;
    const length = lengthValue ? parseInt(lengthValue, 10) : null;

    if (length != null) entry.uploadLength = length;
    const effectiveLength = length ?? entry.uploadLength;

    if (
      offset != null &&
      effectiveLength != null &&
      effectiveLength >= 0 &&
      offset >= effectiveLength
    ) {
      this.finishTusEntry(entry, true);
      return;
    }

    this.scheduleTusIdleComplete(entry);
  }

  private scheduleTusIdleComplete(entry: TusEntry) {
    if (!entry || !entry.item || entry.item.done) return;
    const idleMs = 1800;
    entry.lastSeenAt = Date.now();

    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = window.setTimeout(() => {
      if (!entry || !entry.item || entry.item.done) return;
      const age = Date.now() - entry.lastSeenAt;
      if (age < idleMs) {
        this.scheduleTusIdleComplete(entry);
        return;
      }
      this.finishTusEntry(entry, true);
    }, idleMs);
  }

  private getResourceUploadPaths(urlLike: string, method: string, body: any): string[] {
    const m = String(method).toUpperCase();
    if (m !== "POST" && m !== "PUT") return [];

    const rawPath = extractResourcePath(urlLike);
    if (rawPath == null) return [];
    if (!hasBinaryBody(body)) return [];

    const fileNames = getBodyFileNames(body);
    const normalizedBase = normalizePathEncoded(rawPath);

    if (!fileNames.length) {
      if (normalizedBase === "/") return [];
      return [normalizedBase];
    }

    if (
      fileNames.length === 1 &&
      rawPath &&
      rawPath !== "/" &&
      pathEndsWithFileName(rawPath, fileNames[0])
    ) {
      return [normalizePathEncoded(rawPath)];
    }

    return fileNames.map((name) => joinDirAndFileEncoded(normalizedBase, name));
  }
}

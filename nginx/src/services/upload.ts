import { getFileBrowserToken } from "./auth";
import { normalizePathEncoded } from "../utils/dom";
import { AutoShareModal } from "../components/Panel/AutoShareModal";

interface UploadItem {
  path: string;
  ok: boolean;
  done: boolean;
}

interface UploadBatch {
  pending: number;
  items: UploadItem[];
  timer: number | null;
}

export class UploadService {
  private uploadBatch: UploadBatch | null = null;
  private lastAutoSharedPath: string | null = null;
  private lastAutoSharedAt: number = 0;
  private autoShareModal = new AutoShareModal();

  constructor() {}

  public recordUploadStart(pathEncoded: string): UploadItem {
    this.startUploadBatch();
    const item: UploadItem = { path: pathEncoded, ok: false, done: false };
    if (this.uploadBatch) {
      this.uploadBatch.pending += 1;
      this.uploadBatch.items.push(item);
    }
    return item;
  }

  public recordUploadDone(item: UploadItem, ok: boolean) {
    if (!this.uploadBatch) return;
    item.done = true;
    item.ok = ok;
    this.uploadBatch.pending = Math.max(0, this.uploadBatch.pending - 1);

    if (this.uploadBatch.pending === 0) {
      const batch = this.uploadBatch;
      this.uploadBatch.timer = window.setTimeout(() => {
        this.finalizeUploadBatch(batch);
      }, 700);
    }
  }

  private startUploadBatch() {
    if (!this.uploadBatch) {
      this.uploadBatch = { pending: 0, items: [], timer: null };
      return;
    }

    if (this.uploadBatch.timer) {
      clearTimeout(this.uploadBatch.timer);
      this.uploadBatch.timer = null;
    }
  }

  private async finalizeUploadBatch(batch: UploadBatch) {
    if (!batch || this.uploadBatch !== batch) return;
    this.uploadBatch = null;

    const attempted: Record<string, boolean> = {};
    const succeeded: Record<string, boolean> = {};

    batch.items.forEach((item) => {
      if (!item.path) return;
      attempted[item.path] = true;
      if (item.ok) succeeded[item.path] = true;
    });

    const attemptedKeys = Object.keys(attempted);
    const succeededKeys = Object.keys(succeeded);
    if (attemptedKeys.length !== 1 || succeededKeys.length !== 1) return;

    const pathEncoded = succeededKeys[0];
    const t = Date.now();
    if (this.lastAutoSharedPath === pathEncoded && t - this.lastAutoSharedAt < 5000) return;
    this.lastAutoSharedPath = pathEncoded;
    this.lastAutoSharedAt = t;

    try {
      const resp = await this.createShare(pathEncoded);
      const streamUrl = window.location.origin + "/stream/" + resp.hash;
      const fileLabel = decodeURIComponent(String(pathEncoded).split("/").pop() || "");
      this.autoShareModal.show({
        title: "Share link ready",
        subtitle: fileLabel ? `Uploaded: ${fileLabel}` : "",
        urlLabel: "Stream Gallery (best for big videos):",
        url: streamUrl,
        openUrl: streamUrl,
        note: "Recipients can view without logging in.",
        autoCopy: true,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.autoShareModal.show({
        title: "Upload complete",
        subtitle: "Could not create share link",
        url: "",
        note: msg,
        autoCopy: false,
      });
    }
  }

  private async createShare(pathEncoded: string): Promise<{ hash: string }> {
    const token = getFileBrowserToken();
    if (!token) throw new Error("Not logged in");

    const encodePathSegments = (decodedPath: string) => {
      let s = String(decodedPath || "");
      if (s && s.charAt(0) !== "/") s = "/" + s;
      s = s.replace(/^\/+/, "/");
      const parts = s.split("/");
      return parts.map((p) => (p === "" ? "" : encodeURIComponent(p))).join("/");
    };

    const doShareFetch = async (encodedPath: string) => {
      const res = await fetch("/api/share" + encodedPath, {
        method: "POST",
        headers: {
          "X-Auth": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expires: "", password: "" }),
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error("Share API failed (" + res.status + "): " + (text || ""));
      }
      const data = JSON.parse(text);
      if (!data || !data.hash) throw new Error("Share response missing hash");
      return data;
    };

    try {
      return await doShareFetch(pathEncoded);
    } catch (err) {
      if (String(pathEncoded || "").indexOf("%2F") === -1) throw err;

      let decoded;
      try {
        decoded = decodeURIComponent(String(pathEncoded));
      } catch (_e) {
        throw err;
      }

      const normalized = encodePathSegments(decoded);
      if (!normalized || normalized === pathEncoded) throw err;
      return await doShareFetch(normalized);
    }
  }
}

export const uploadService = new UploadService();

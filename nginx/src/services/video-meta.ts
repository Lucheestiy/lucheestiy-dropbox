import { dropprFetch } from "./api";
import { isDropprDebugEnabled } from "../utils/debug";

export interface VideoMeta {
  status?: string;
  action?: string;
  uploaded_at?: number;
  processed_at?: number;
  original?: any;
  processed?: any;
  original_size?: number;
  processed_size?: number;
}

class VideoMetaService {
  private cache: Record<string, VideoMeta | null> = {};
  private inFlight: Record<string, boolean> = {};
  public debugStats = { ok: 0, notFound: 0, unauth: 0, other: 0 };

  async fetch(path: string): Promise<VideoMeta | null> {
    if (this.cache[path] !== undefined) return this.cache[path];
    if (this.inFlight[path]) return null;

    this.inFlight[path] = true;
    try {
      const res = await dropprFetch(`/api/droppr/video-meta?path=${encodeURIComponent(path)}`, {
        cache: "no-store",
      });

      if (isDropprDebugEnabled()) {
        if (res.status === 200) this.debugStats.ok++;
        else if (res.status === 404) this.debugStats.notFound++;
        else if (res.status === 401 || res.status === 403) this.debugStats.unauth++;
        else this.debugStats.other++;
      }

      if (!res.ok) {
        this.cache[path] = null;
        return null;
      }

      const data = await res.json();
      this.cache[path] = data;
      return data;
    } catch (e) {
      this.cache[path] = null;
      return null;
    } finally {
      delete this.inFlight[path];
    }
  }

  getCached(path: string): VideoMeta | null | undefined {
    return this.cache[path];
  }

  isInFlight(path: string): boolean {
    return !!this.inFlight[path];
  }
}

export const videoMetaService = new VideoMetaService();

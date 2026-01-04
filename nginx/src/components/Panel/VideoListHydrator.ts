import { videoMetaService, VideoMeta } from "../../services/video-meta";
import { isDropprDebugEnabled } from "../../utils/debug";
import { debugBadge } from "./DebugBadge";
import { getFileBrowserToken } from "../../services/auth";

const VIDEO_META_STYLE_ID = "droppr-video-meta-style";
const VIDEO_META_INLINE_ID = "droppr-video-meta-inline";
const VIDEO_DETAILS_ROW_CLASS = "droppr-video-details-row";
const VIDEO_THUMB_STYLE_ID = "droppr-video-thumb-style";
const VIDEO_THUMB_CLASS = "droppr-video-thumb";
const DROPPR_THUMB_WIDTH = 96;

export class VideoListHydrator {
  private hydrateTimer: number | null = null;
  private lastPathname: string | null = null;
  private observer: MutationObserver | null = null;

  constructor() {
    this.ensureStyles();
    this.startWatcher();
  }

  private ensureStyles() {
    if (document.getElementById(VIDEO_META_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = VIDEO_META_STYLE_ID;
    style.textContent = `
      .${VIDEO_META_INLINE_ID} {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px 8px;
        font-size: 11px;
        line-height: 1.3;
        color: var(--text-secondary, rgba(229,231,235,0.6));
        background: rgba(255,255,255,0.03);
        border-radius: 4px;
        margin-top: 4px;
        pointer-events: none;
      }
      .${VIDEO_META_INLINE_ID} .line {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .${VIDEO_META_INLINE_ID} .line.muted { opacity: 0.6; }
      
      /* Grid view adjustments */
      .item.item-grid .${VIDEO_META_INLINE_ID} {
        position: absolute;
        bottom: 0; left: 0; right: 0;
        background: rgba(0,0,0,0.65);
        backdrop-filter: blur(4px);
        margin: 0;
        border-radius: 0;
        padding: 6px 8px;
      }
    `;
    document.head.appendChild(style);

    if (!document.getElementById(VIDEO_THUMB_STYLE_ID)) {
      const tStyle = document.createElement("style");
      tStyle.id = VIDEO_THUMB_STYLE_ID;
      tStyle.textContent = `
        .${VIDEO_THUMB_CLASS} {
          width: 40px; height: 40px;
          object-fit: cover;
          border-radius: 4px;
          background: #000;
          margin-right: 12px;
          flex: 0 0 40px;
        }
        .item-grid .${VIDEO_THUMB_CLASS} {
          width: 100%; height: 100%;
          margin: 0;
          position: absolute; inset: 0;
          z-index: -1;
        }
      `;
      document.head.appendChild(tStyle);
    }
  }

  private isFilesPage(): boolean {
    return window.location.pathname.startsWith("/files");
  }

  private startWatcher() {
    this.scheduleHydrate();
    this.observer = new MutationObserver(() => {
      if (this.isFilesPage()) {
        const path = window.location.pathname;
        if (path !== this.lastPathname) {
          this.lastPathname = path;
          this.scheduleHydrate();
        } else {
          this.scheduleHydrate();
        }
      }
    });
    this.observer.observe(document.body, { childList: true, subtree: true });
  }

  private scheduleHydrate() {
    if (!this.isFilesPage()) return;
    if (this.hydrateTimer) clearTimeout(this.hydrateTimer);
    this.hydrateTimer = window.setTimeout(() => {
      this.hydrateTimer = null;
      this.hydrate();
    }, 250);
  }

  private hydrate() {
    if (!this.isFilesPage()) return;

    const layout = this.getLayout();
    const rows = document.querySelectorAll(".row.list-item, tr, .item, .file");

    let started = 0;
    const maxNewFetches = 8;

    rows.forEach((row) => {
      if (row.classList.contains(VIDEO_DETAILS_ROW_CLASS)) return;

      const nameEl = this.findNameEl(row as HTMLElement);
      if (!nameEl) return;

      const name = nameEl.textContent?.trim() || "";
      if (!this.isLikelyVideo(name)) return;

      const fullPath = this.extractPath(row as HTMLElement, name);
      if (!fullPath) return;

      this.applyThumbnail(row as HTMLElement, fullPath);
      const box = this.ensureDetailsBox(row as HTMLElement, nameEl);
      if (!box) return;

      const cached = videoMetaService.getCached(fullPath);
      if (cached !== undefined) {
        this.renderDetails(box, name, cached, layout === "list");
        return;
      }

      if (videoMetaService.isInFlight(fullPath)) return;
      if (started >= maxNewFetches) return;

      started++;
      box.dataset.path = fullPath;
      videoMetaService.fetch(fullPath).then((data) => {
        if (box.dataset.path === fullPath) {
          this.renderDetails(box, name, data, layout === "list");
        }
        this.scheduleHydrate();
      });
    });

    if (isDropprDebugEnabled()) {
      const stats = videoMetaService.debugStats;
      debugBadge.setText(`Hydrated: ok:${stats.ok} 404:${stats.notFound} row:${rows.length}`);
    }
  }

  private getLayout(): "list" | "grid" {
    const listing = document.getElementById("listing");
    if (listing?.classList.contains("list")) return "list";
    if (listing?.classList.contains("grid")) return "grid";
    return "list";
  }

  private findNameEl(row: HTMLElement): HTMLElement | null {
    return row.querySelector(".name, .title, [data-name]") as HTMLElement;
  }

  private isLikelyVideo(name: string): boolean {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    return ["mp4", "mkv", "mov", "avi", "webm"].includes(ext);
  }

  private extractPath(row: HTMLElement, name: string): string | null {
    const link = row.querySelector("a[href]") as HTMLAnchorElement;
    if (link) {
      const href = link.getAttribute("href") || "";
      if (href.startsWith("/files/")) {
        return decodeURIComponent(href.substring("/files".length));
      }
    }

    // Heuristic fallback
    let base = window.location.pathname.replace("/files", "");
    if (!base.startsWith("/")) base = "/" + base;
    if (!base.endsWith("/")) base += "/";
    return base + name;
  }

  private ensureDetailsBox(row: HTMLElement, nameEl: HTMLElement): HTMLElement | null {
    let box = row.querySelector(`.${VIDEO_META_INLINE_ID}`) as HTMLElement;
    if (!box) {
      box = document.createElement("div");
      box.className = VIDEO_META_INLINE_ID;
      nameEl.parentNode?.insertBefore(box, nameEl.nextSibling);
    }
    return box;
  }

  private renderDetails(
    box: HTMLElement,
    name: string,
    data: VideoMeta | null,
    includeName: boolean
  ) {
    box.dataset.path = box.dataset.path || "";
    box.innerHTML = "";

    const lines: string[] = [];
    if (includeName) lines.push(name);

    if (data) {
      if (data.uploaded_at) {
        const date = new Date(data.uploaded_at * 1000).toISOString().slice(0, 16).replace("T", " ");
        lines.push(`Uploaded: ${date}`);
      }
      if (data.processed_size) {
        lines.push(`Size: ${(data.processed_size / 1024 / 1024).toFixed(1)} MB`);
      }
      if (data.status) {
        lines.push(`Status: ${data.status}`);
      }
    } else {
      lines.push("No metadata available");
    }

    lines.forEach((l) => {
      const span = document.createElement("span");
      span.className = "line";
      span.textContent = l;
      box.appendChild(span);
    });
  }

  private applyThumbnail(row: HTMLElement, path: string) {
    const iconEl = row.querySelector(".material-icons, .icon, i") as HTMLElement;
    const nameEl = this.findNameEl(row);
    if (!iconEl || !nameEl) return;

    const container = this.findThumbContainer(row, iconEl, nameEl);
    if (!container) return;

    const existing = container.querySelector(`.${VIDEO_THUMB_CLASS}`) as HTMLImageElement | null;
    if (existing && existing.dataset.failed === "1") return;

    const url = this.buildPreviewUrl(path, DROPPR_THUMB_WIDTH);
    const url2x = this.buildPreviewUrl(path, DROPPR_THUMB_WIDTH * 2);

    if (existing && existing.dataset.src === url) return;

    // Hide original icon
    iconEl.style.display = "none";

    let img = existing;
    if (!img) {
      img = document.createElement("img");
      img.className = VIDEO_THUMB_CLASS;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => {
        img!.dataset.failed = "1";
        img!.style.display = "none";
        iconEl.style.display = "";
      });
      container.insertBefore(img, container.firstChild);
    }

    img.dataset.src = url;
    img.src = url;
    img.srcset = `${url} 1x, ${url2x} 2x`;
    img.sizes = "40px";
  }

  private findThumbContainer(
    row: HTMLElement,
    iconEl: HTMLElement,
    nameEl: HTMLElement
  ): HTMLElement | null {
    if (row.classList.contains("item")) return row; // Grid item
    return iconEl.parentElement;
  }

  private buildPreviewUrl(path: string, width?: number): string {
    let p = path;
    if (!p.startsWith("/")) p = "/" + p;
    let url = `/api/share/__files__/preview${encodeURI(p)}?v=1`;
    if (width) url += `&w=${width}`;
    return url;
  }
}

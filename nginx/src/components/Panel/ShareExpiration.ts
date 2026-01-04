import { dropprFetch } from "../../services/api";
import { isLoggedIn } from "../../services/auth";

const SHARE_EXPIRE_STYLE_ID = "droppr-share-expire-style";
const SHARE_EXPIRE_BTN_CLASS = "droppr-share-expire-btn";
const SHARE_EXPIRE_STORAGE_KEY = "droppr_share_expire_hours";

interface ShareAlias {
  alias_id: string;
  target_path: string;
  target_expire: number;
  download_limit?: number;
  download_count?: number;
}

interface ShareAliasResponse {
  aliases: ShareAlias[];
}

export class ShareExpiration {
  private aliasesState = { loading: false, lastAppliedAt: 0, cache: [] as ShareAlias[] };
  private observer: MutationObserver | null = null;

  constructor() {
    this.ensureStyles();
    this.startWatcher();
  }

  private ensureStyles() {
    if (document.getElementById(SHARE_EXPIRE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = SHARE_EXPIRE_STYLE_ID;
    style.textContent = `
      .${SHARE_EXPIRE_BTN_CLASS} { margin-left: 6px; }
      .${SHARE_EXPIRE_BTN_CLASS}[disabled] { opacity: 0.55; cursor: not-allowed; }
    `;
    document.head.appendChild(style);
  }

  private isSharesPage(): boolean {
    const p = String((window.location && window.location.pathname) || "");
    return p.indexOf("/settings/shares") !== -1;
  }

  private extractShareHashFromHref(href: string): string | null {
    const s = String(href || "");
    let m = s.match(/\/share\/([^/?#]+)/);
    if (m && m[1]) return m[1];
    m = s.match(/share\/([^/?#]+)/);
    if (m && m[1]) return m[1];
    return null;
  }

  private getDefaultShareExpireHours(): number {
    let stored = null;
    try {
      stored = localStorage.getItem(SHARE_EXPIRE_STORAGE_KEY);
    } catch (_e) {
      stored = null;
    }
    const n = stored ? parseInt(stored, 10) : null;
    if (n == null || n < 0) return 30;
    return n;
  }

  private async updateShareExpire(
    shareHash: string,
    hours: number | null,
    sharePath: string,
    limit: number | null = null,
    allowDownload: boolean = true
  ): Promise<any> {
    const body: any = { path: sharePath || "", allow_download: allowDownload };
    if (hours !== null) body.hours = hours;
    if (limit !== null) body.download_limit = limit;

    const res = await dropprFetch(
      "/api/droppr/shares/" + encodeURIComponent(shareHash) + "/expire",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const text = await res.text();
    if (!res.ok) {
      throw new Error("Update failed (" + res.status + "): " + (text || ""));
    }
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_e) {
      return {};
    }
  }

  private fmtRelativeExpire(unixSeconds: number | null): string {
    if (unixSeconds == null) return "";
    const ts = parseInt(String(unixSeconds), 10);
    if (isNaN(ts)) return "";
    if (ts === 0) return "permanent";

    const deltaSec = Math.floor((ts * 1000 - Date.now()) / 1000);
    if (deltaSec <= 0) return "expired";

    const days = Math.floor(deltaSec / 86400);
    if (days >= 2) return "in " + days + " days";
    if (days === 1) return "in 1 day";

    const hours = Math.floor(deltaSec / 3600);
    if (hours >= 2) return "in " + hours + " hours";
    if (hours === 1) return "in 1 hour";

    const minutes = Math.floor(deltaSec / 60);
    if (minutes >= 2) return "in " + minutes + " minutes";
    if (minutes === 1) return "in 1 minute";

    return "in " + deltaSec + " seconds";
  }

  private async fetchShareAliases(limit?: number): Promise<ShareAliasResponse> {
    const q = typeof limit === "number" ? "?limit=" + String(limit) : "";
    const res = await dropprFetch("/api/droppr/shares/aliases" + q, {
      method: "GET",
      headers: {},
    });

    const text = await res.text();
    if (!res.ok) throw new Error("Aliases failed (" + res.status + "): " + (text || ""));
    if (!text) return { aliases: [] };
    try {
      return JSON.parse(text);
    } catch (_e) {
      return { aliases: [] };
    }
  }

  private applyAliasToShareRow(rowEl: HTMLElement, alias: ShareAlias) {
    if (!rowEl || !alias) return;

    const tds = rowEl.querySelectorAll("td");
    if (!tds || tds.length < 2) return;

    const expireText = this.fmtRelativeExpire(alias.target_expire);
    let dlText = "";
    if (alias.download_limit) {
      dlText = (alias.download_count || 0) + "/" + alias.download_limit + " dl";
    }

    const parts = [];
    if (expireText && expireText !== "permanent") parts.push(expireText);
    if (dlText) parts.push(dlText);
    if (alias.allow_download === false) parts.push("View-only");

    const base = parts.length > 0 ? "Aliased (" + parts.join(", ") + ")" : "Aliased";
    tds[1].textContent = base;
  }

  private async ensureShareAliasesApplied() {
    if (!isLoggedIn()) return;
    if (!this.isSharesPage()) return;

    const t = Date.now();
    if (this.aliasesState.lastAppliedAt && t - this.aliasesState.lastAppliedAt < 2500) return;
    if (this.aliasesState.loading) return;

    this.aliasesState.loading = true;
    try {
      const payload = await this.fetchShareAliases(2000);
      this.aliasesState.cache = payload && payload.aliases ? payload.aliases : [];
    } catch (_e) {
      this.aliasesState.cache = [];
    } finally {
      this.aliasesState.loading = false;
      this.aliasesState.lastAppliedAt = Date.now();
    }

    const aliases = this.aliasesState.cache || [];
    if (!aliases || aliases.length === 0) return;

    const rows = document.querySelectorAll("tr");
    rows.forEach((row) => {
      const tds = row.querySelectorAll("td");
      if (!tds || tds.length < 1) return;
      const link = tds[0].querySelector("a");
      if (!link) return;

      const href = link.getAttribute("href") || "";
      const hash = this.extractShareHashFromHref(href);
      if (!hash) return;

      const alias = aliases.find((a) => a.alias_id === hash);
      if (alias) {
        this.applyAliasToShareRow(row as HTMLElement, alias);
      }
    });
  }

  private injectButtons() {
    if (!isLoggedIn()) return;
    if (!this.isSharesPage()) return;

    // Periodically update aliases
    this.ensureShareAliasesApplied();

    const lists = document.querySelectorAll(".card-content table tbody");
    if (!lists.length) return;

    lists.forEach((tbody) => {
      const rows = tbody.querySelectorAll("tr");
      rows.forEach((row) => {
        const tds = row.querySelectorAll("td");
        if (!tds || tds.length < 1) return;

        const host = tds[tds.length - 1]; // Actions column usually last
        if (!host) return;

        // Find share hash
        const link = tds[0].querySelector("a");
        if (!link) return;
        const href = link.getAttribute("href");
        const hash = this.extractShareHashFromHref(href || "");
        if (!hash) return;

        // Find share path for context
        let path = "";
        try {
          const pathEl = tds[0].querySelector(".secondary");
          if (pathEl) path = pathEl.textContent || "";
        } catch (_e) {
          /* ignore */
        }

        if (host.querySelector("." + SHARE_EXPIRE_BTN_CLASS)) return;

        const btn = document.createElement("button");
        btn.textContent = "⏱";
        btn.title = "Set expiration";
        btn.className = "action " + SHARE_EXPIRE_BTN_CLASS;
        btn.style.cursor = "pointer";

        btn.onclick = async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const existingAlias = this.aliasesState.cache.find((a) => a.alias_id === hash);

          const defaultHours = this.getDefaultShareExpireHours();
          const hoursInput = prompt("Expire share in hours (0=permanent)?", String(defaultHours));
          if (hoursInput === null) return;
          const hours = parseInt(hoursInput, 10);
          if (isNaN(hours) || hours < 0) return;

          const defaultLimit = existingAlias?.download_limit || 0;
          const limitInput = prompt("Download limit (0=unlimited)?", String(defaultLimit));
          if (limitInput === null) return;
          const limit = parseInt(limitInput, 10);
          if (isNaN(limit) || limit < 0) return;

          const defaultAllowDl = existingAlias?.allow_download !== false ? "y" : "n";
          const allowDlInput = prompt("Allow downloads (y/n)?", defaultAllowDl);
          if (allowDlInput === null) return;
          const allowDownload = ["y", "yes", "1", "true"].includes(
            allowDlInput.toLowerCase().trim()
          );

          try {
            localStorage.setItem(SHARE_EXPIRE_STORAGE_KEY, String(hours));
          } catch (_err) {
            /* ignore */
          }

          // Optimistic update
          const tds = row.querySelectorAll("td");
          const originalText = tds && tds.length > 1 ? tds[1].textContent : "";
          const optimisticExpire = hours === 0 ? 0 : Math.floor(Date.now() / 1000) + hours * 3600;
          this.applyAliasToShareRow(row as HTMLElement, {
            alias_id: hash,
            target_path: path,
            target_expire: optimisticExpire,
            download_limit: limit > 0 ? limit : undefined,
            download_count: 0,
            allow_download: allowDownload,
          });

          btn.disabled = true;
          try {
            await this.updateShareExpire(
              hash,
              hours,
              path,
              limit > 0 ? limit : null,
              allowDownload
            );
            // Force refresh of aliases to sync with server
            this.aliasesState.lastAppliedAt = 0;
            await this.ensureShareAliasesApplied();
          } catch (err) {
            // Revert on error
            if (tds && tds.length > 1) {
              tds[1].textContent = originalText;
            }
            alert("Failed to update share: " + err);
          } finally {
            btn.disabled = false;
          }
        };

        host.appendChild(btn);
      });
    });
  }

  private startWatcher() {
    // Initial check
    this.injectButtons();

    // Watch for DOM changes (FileBrowser is an SPA that re-renders tables)
    this.observer = new MutationObserver(() => {
      this.injectButtons();
    });

    this.observer.observe(document.body, { childList: true, subtree: true });
  }
}

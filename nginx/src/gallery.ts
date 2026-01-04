import "./gallery.css";

interface GalleryFile {
  name: string;
  path?: string;
  type: 'image' | 'video' | 'file';
  extension: string;
  size: number;
  inline_url?: string;
  download_url?: string;
}

interface VideoMeta {
  recorded?: boolean;
  uploaded_at?: number;
  original?: VideoStreamMeta;
  processed?: VideoStreamMeta;
  current?: VideoStreamMeta;
  original_size?: number;
  processed_size?: number;
  action?: string;
  duration?: number;
  video?: {
    codec?: string;
    width?: number;
    height?: number;
    display_width?: number;
    display_height?: number;
    fps?: number;
  };
  audio?: {
    codec?: string;
  };
  size?: number;
}

interface VideoStreamMeta {
  size?: number;
  video?: {
    codec?: string;
    width?: number;
    height?: number;
    display_width?: number;
    display_height?: number;
    fps?: number;
  };
  audio?: {
    codec?: string;
  };
}

interface GalleryState {
  files: GalleryFile[];
  filteredFiles: GalleryFile[];
  currentIndex: number;
  shareHash: string | null;
  filter: string;
  sort: string;
  layout: string;
  showDetails: boolean;
  search: string;
  isSlideshow: boolean;
  slideshowInterval: ReturnType<typeof setInterval> | null;
  isZoomed: boolean;
  zoomScale: number;
  immersiveTimer: ReturnType<typeof setTimeout> | null;
  touchStartX: number | null;
  pinchStartDistance: number | null;
  pinchStartScale: number;
  isPulling: boolean;
  isRefreshing: boolean;
  isOffline: boolean;
  videoTimers: {
    stuck: ReturnType<typeof setTimeout> | null;
    wait: ReturnType<typeof setTimeout> | null;
    seek: ReturnType<typeof setTimeout> | null;
    stall: ReturnType<typeof setTimeout> | null;
  };
  videoStatusInterval: ReturnType<typeof setInterval> | null;
  scrollLockY: number;
  videoMetaCache: Record<string, VideoMeta>;
  videoMetaInFlight: Record<string, boolean>;
  virtual: {
    enabled: boolean;
    rendered: number;
    sentinel: HTMLElement | null;
    observer: IntersectionObserver | null;
    inFlight: boolean;
  };
}

interface GalleryElements {
  grid: HTMLElement | null;
  loading: HTMLElement | null;
  empty: HTMLElement | null;
  emptyTitle: HTMLElement | null;
  emptyMessage: HTMLElement | null;
  error: HTMLElement | null;
  errorTitle: HTMLElement | null;
  errorMessage: HTMLElement | null;
  search: HTMLInputElement | null;
  sort: HTMLSelectElement | null;
  filters: NodeListOf<HTMLElement>;
  modal: HTMLElement | null;
  modalContent: HTMLElement | null;
  modalTitle: HTMLElement | null;
  modalMeta: HTMLElement | null;
  downloadAll: HTMLAnchorElement | null;
  copyLink: HTMLElement | null;
  streamBtn: HTMLElement | null;
  refresh: HTMLElement | null;
  details: HTMLElement | null;
  backToTop: HTMLElement | null;
  viewOriginal: HTMLAnchorElement | null;
  download: HTMLAnchorElement | null;
  videoOverlay: HTMLElement | null;
  overlayMessage: HTMLElement | null;
  speedBtn: HTMLElement | null;
  resetVideoBtn: HTMLElement | null;
  helpOverlay: HTMLElement | null;
  offlineBanner: HTMLElement | null;
  pullToRefresh: HTMLElement | null;
  themeToggle: HTMLElement | null;
}

interface GalleryPrefs {
  theme?: 'dark' | 'light';
  filter?: string;
  sort?: string;
  layout?: string;
  show_details?: boolean;
}

(function(): void {
  'use strict';

  // ============ CONFIGURATION ============
  const CONFIG = {
    STUCK_TIMEOUT: 6000,
    SEEK_TIMEOUT: 8000,
    MAX_PRELOAD_CACHE: 15,
    SLIDESHOW_INTERVAL: 4000,
    VIRTUAL_SCROLL_THRESHOLD: 100,
    VIRTUAL_CHUNK_SIZE: 60,
    VIRTUAL_PREFETCH_PX: 1200
  };

  const DROPPR_CONFIG = window.DROPPR_CONFIG || {};
  const PREVIEW_DEFAULT_WIDTHS = [240, 320, 480, 640, 800];
  const PREVIEW_WIDTHS = normalizeWidths(DROPPR_CONFIG.previewWidths);
  const PREVIEW_FORMAT = String(DROPPR_CONFIG.previewFormat || 'auto').trim().toLowerCase();
  const PREVIEW_SIZES = (typeof DROPPR_CONFIG.previewSizes === 'string' && DROPPR_CONFIG.previewSizes.trim())
    ? DROPPR_CONFIG.previewSizes.trim()
    : '(max-width: 600px) 100vw, (max-width: 900px) 50vw, (max-width: 1200px) 33vw, 25vw';
  const ASSET_BASE_URL = (typeof DROPPR_CONFIG.assetBaseUrl === 'string')
    ? DROPPR_CONFIG.assetBaseUrl.replace(/\/+$/, '')
    : '';

  // ============ BROWSER DETECTION ============
  const UA = navigator.userAgent || '';
  const IS_IOS = /iPad|iPhone|iPod/.test(UA) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);

  // ============ STATE ============
  const state: GalleryState = {
    files: [],
    filteredFiles: [],
    currentIndex: 0,
    shareHash: null,
    filter: 'all',
    sort: 'type_asc',
    layout: 'grid',
    showDetails: true,
    search: '',
    isSlideshow: false,
    slideshowInterval: null,
    isZoomed: false,
    zoomScale: 1,
    immersiveTimer: null,
    touchStartX: null,
    pinchStartDistance: null,
    pinchStartScale: 1,
    isPulling: false,
    isRefreshing: false,
    isOffline: !navigator.onLine,
    videoTimers: {
      stuck: null,
      wait: null,
      seek: null,
      stall: null
    },
    videoStatusInterval: null,
    scrollLockY: 0,
    videoMetaCache: {},
    videoMetaInFlight: {},
    virtual: {
      enabled: false,
      rendered: 0,
      sentinel: null,
      observer: null,
      inFlight: false
    }
  };

  // ============ DOM ELEMENTS ============
  const els: GalleryElements = {} as GalleryElements;
  let detailsHydrationTimer: ReturnType<typeof setTimeout> | null = null;

  function initElements(): void {
    els.grid = document.getElementById('galleryGrid');
    els.loading = document.getElementById('loading');
    els.empty = document.getElementById('emptyState');
    els.emptyTitle = document.getElementById('emptyTitle');
    els.emptyMessage = document.getElementById('emptyMessage');
    els.error = document.getElementById('errorState');
    els.errorTitle = document.getElementById('errorTitle');
    els.errorMessage = document.getElementById('errorMessage');
    els.search = document.getElementById('searchInput') as HTMLInputElement | null;
    els.sort = document.getElementById('sortSelect') as HTMLSelectElement | null;
    els.filters = document.querySelectorAll('.filter-btn') as NodeListOf<HTMLElement>;
    els.modal = document.getElementById('modal');
    els.modalContent = document.getElementById('modalContent');
    els.modalTitle = document.getElementById('modalTitle');
    els.modalMeta = document.getElementById('modalMeta');
    els.downloadAll = document.getElementById('downloadAllBtn') as HTMLAnchorElement | null;
    els.copyLink = document.getElementById('copyLinkBtn');
    els.streamBtn = document.getElementById('streamBtn');
    els.refresh = document.getElementById('refreshBtn');
    els.details = document.getElementById('detailsBtn');
    els.backToTop = document.getElementById('backToTop');
    els.viewOriginal = document.getElementById('viewOriginalBtn') as HTMLAnchorElement | null;
    els.download = document.getElementById('downloadBtn') as HTMLAnchorElement | null;
    els.videoOverlay = document.getElementById('videoOverlay');
    els.overlayMessage = document.getElementById('overlayMessage');
    els.speedBtn = document.getElementById('speedBtn');
    els.resetVideoBtn = document.getElementById('resetVideoBtn');
    els.helpOverlay = document.getElementById('helpOverlay');
    els.offlineBanner = document.getElementById('offlineBanner');
    els.pullToRefresh = document.getElementById('pullToRefresh');
    els.themeToggle = document.getElementById('themeToggle');
  }

  // ============ PREFERENCES ============
  const PREFS_KEY = 'droppr_gallery_prefs';

  function loadPrefs(): GalleryPrefs {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as GalleryPrefs;
    } catch { return {}; }
  }

  function savePrefs(prefs: Partial<GalleryPrefs>): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...prefs }));
    } catch { /* ignore */ }
  }

  // ============ THEME FUNCTIONS ============
  function getTheme(): 'dark' | 'light' {
    const prefs = loadPrefs();
    return prefs.theme || 'dark';
  }

  function setTheme(theme: 'dark' | 'light'): void {
    const isDark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    if (els.themeToggle) {
      els.themeToggle.textContent = isDark ? '🌙' : '☀️';
      els.themeToggle.title = isDark ? 'Switch to light theme' : 'Switch to dark theme';
    }
    savePrefs({ theme });
  }

  function toggleTheme(): void {
    const current = getTheme();
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  function initTheme(): void {
    const theme = getTheme();
    setTheme(theme);
    if (els.themeToggle) {
      els.themeToggle.addEventListener('click', toggleTheme);
    }
  }

  // ============ UTILITY FUNCTIONS ============
  function encodePath(p: string): string {
    return String(p || '').split('/').map(s => encodeURIComponent(s)).join('/');
  }

  function normalizeWidths(list: number[] | undefined): number[] {
    const values = Array.isArray(list) ? list : [];
    const normalized = values
      .map(value => Number(value))
      .filter(value => Number.isFinite(value) && value > 0);
    if (normalized.length === 0) {
      return PREVIEW_DEFAULT_WIDTHS.slice();
    }
    normalized.sort((a, b) => a - b);
    const unique: number[] = [];
    normalized.forEach(value => {
      if (unique[unique.length - 1] !== value) unique.push(value);
    });
    return unique;
  }

  function buildPreviewUrl(path: string, size: number, width?: number): string {
    let url = `/api/share/${state.shareHash}/preview/${encodePath(path)}?v=${size || 0}`;
    if (width) url += `&w=${width}`;
    if (PREVIEW_FORMAT) url += `&format=${encodeURIComponent(PREVIEW_FORMAT)}`;
    return url;
  }

  function buildPreviewSrcSet(path: string, size: number): string {
    if (!PREVIEW_WIDTHS.length) return '';
    return PREVIEW_WIDTHS.map(width => `${buildPreviewUrl(path, size, width)} ${width}w`).join(', ');
  }

  function formatSize(b: number): string {
    if (!b) return '0 B';
    const k = 1000, s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    if (i <= 0) return Math.round(b) + ' B';
    return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
  }

  function formatDuration(seconds: number | undefined): string {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return '';
    const total = Math.floor(s);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }

  function formatUnixSeconds(tsSeconds: number | null | undefined): string {
    if (tsSeconds == null) return '';
    const n = parseInt(String(tsSeconds), 10);
    if (!Number.isFinite(n) || n <= 0) return '';
    try {
      return new Date(n * 1000).toLocaleString();
    } catch {
      return '';
    }
  }

  function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
  }

  function getTouchDistance(touches: TouchList): number | null {
    if (!touches || touches.length < 2) return null;
    const dx = touches[0].screenX - touches[1].screenX;
    const dy = touches[0].screenY - touches[1].screenY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function setZoomScale(scale: number): void {
    const media = els.modalContent?.querySelector('.modal-media') as HTMLElement | null;
    if (!media || media.tagName !== 'IMG') return;
    state.zoomScale = clamp(scale, 1, 3);
    state.isZoomed = state.zoomScale > 1.05;
    media.style.transform = `scale(${state.zoomScale})`;
    media.classList.toggle('zoomable', true);
    const zoomBtn = document.getElementById('zoomBtn');
    if (zoomBtn) zoomBtn.textContent = state.isZoomed ? '🔎' : '🔍';
  }

  function addResourceHint(href: string): void {
    if (!href || typeof href !== 'string') return;
    const trimmed = href.replace(/\/+$/, '');
    if (!trimmed || trimmed === window.location.origin) return;
    if (document.querySelector(`link[rel="preconnect"][href="${trimmed}"]`)) return;
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = trimmed;
    preconnect.crossOrigin = 'anonymous';
    document.head.appendChild(preconnect);
    const dnsPrefetch = document.createElement('link');
    dnsPrefetch.rel = 'dns-prefetch';
    dnsPrefetch.href = trimmed;
    document.head.appendChild(dnsPrefetch);
  }

  function setupResourceHints(): void {
    addResourceHint(ASSET_BASE_URL);
  }

  function actionLabel(action: string | undefined): string {
    const a = String(action || '').toLowerCase();
    if (a === 'transcode_hevc_to_h264') return 'Transcoded HEVC → H.264';
    if (a === 'fix_video_errors_extra_streams') return 'Re-encoded (removed extra streams)';
    if (a === 'fix_video_errors_timestamp') return 'Re-encoded (fixed timestamps)';
    if (a === 'faststart') return 'Faststart (moov moved)';
    if (a === 'already_faststart') return 'Already faststart';
    if (a === 'none') return 'No changes';
    return action ? String(action) : '';
  }

  function formatVideoSummary(meta: VideoMeta | VideoStreamMeta | null | undefined, sizeOverride?: number): string {
    if (!meta || typeof meta !== 'object') {
      const s = Number(sizeOverride);
      return Number.isFinite(s) && s > 0 ? formatSize(s) : '—';
    }

    const v = (meta.video && typeof meta.video === 'object') ? meta.video : {};
    const a = (meta.audio && typeof meta.audio === 'object') ? meta.audio : {};

    let size: number | null = null;
    if (Number.isFinite(Number(sizeOverride)) && Number(sizeOverride) > 0) size = Number(sizeOverride);
    else if (Number.isFinite(Number(meta.size)) && Number(meta.size) > 0) size = Number(meta.size);

    const w = parseInt(String(v.display_width || v.width || ''), 10);
    const h = parseInt(String(v.display_height || v.height || ''), 10);
    const res = (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) ? `${w}×${h}` : '';

    const vCodec = v.codec ? String(v.codec).toUpperCase() : '';
    const aCodec = a.codec ? String(a.codec).toUpperCase() : '';
    const codecs = vCodec ? (aCodec ? `${vCodec}/${aCodec}` : vCodec) : (aCodec || '');

    const dur = formatDuration((meta as VideoMeta).duration);
    const fpsNum = Number(v.fps);
    const fps = Number.isFinite(fpsNum) && fpsNum > 0 ? `${Math.round(fpsNum * 100) / 100}fps` : '';

    return [
      size ? formatSize(size) : '',
      res,
      codecs,
      dur,
      fps,
    ].filter(Boolean).join(' • ') || '—';
  }

  function updateDetailsButton(): void {
    if (!els.details) return;
    els.details.textContent = state.showDetails ? 'ℹ Details: On' : 'ℹ Details: Off';
  }

  function setDetailsEnabled(enabled: boolean, opts: { skipSave?: boolean } = {}): void {
    const on = !!enabled;
    state.showDetails = on;
    document.body.classList.toggle('show-details', on);
    updateDetailsButton();
    if (!opts.skipSave) savePrefs({ show_details: on });
    if (on) hydrateVideoDetails();
  }

  async function fetchVideoMeta(path: string): Promise<VideoMeta | null> {
    const url = `/api/share/${state.shareHash}/video-meta/${encodePath(path)}?t=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json() as VideoMeta;
  }

  function renderVideoDetails(el: HTMLElement | null, data: VideoMeta | null): void {
    if (!el) return;
    if (!data || typeof data !== 'object') {
      el.innerHTML = '<span class="line">Details unavailable</span>';
      el.dataset.loaded = '1';
      return;
    }

    const lines: string[] = [];

    if (data.recorded) {
      const uploaded = formatUnixSeconds(data.uploaded_at);
      if (uploaded) lines.push(`Uploaded: ${uploaded}`);

      const original = formatVideoSummary(data.original, data.original_size);
      const processed = formatVideoSummary(data.processed, data.processed_size);
      lines.push(`Original: ${original}`);

      const action = actionLabel(data.action);
      lines.push(`After: ${processed}${action ? ` • ${action}` : ''}`);
    } else {
      const cur = data.current?.size ? formatSize(data.current.size) : '';
      lines.push(cur ? `Size: ${cur}` : 'No video metadata recorded yet');
    }

    el.innerHTML = lines.map(l => `<span class="line">${l}</span>`).join('');
    el.dataset.loaded = '1';
  }

  async function hydrateVideoDetails(): Promise<void> {
    if (!state.showDetails) return;

    const nodes = Array.from(document.querySelectorAll('.video-details[data-video-meta="1"]')) as HTMLElement[];
    const pending = nodes.filter(el => el && !el.dataset.loaded && el.dataset.path);
    if (!pending.length) return;

    let idx = 0;
    const maxWorkers = Math.min(4, pending.length);

    async function worker(): Promise<void> {
      while (idx < pending.length) {
        const el = pending[idx++];
        const enc = String(el.dataset.path || '');
        let path = enc;
        try { path = decodeURIComponent(enc); } catch { /* ignore */ }

        const key = `${state.shareHash}:${path}`;
        if (state.videoMetaCache[key]) {
          renderVideoDetails(el, state.videoMetaCache[key]);
          continue;
        }

        if (state.videoMetaInFlight[key]) continue;
        state.videoMetaInFlight[key] = true;
        try {
          const data = await fetchVideoMeta(path);
          if (data) state.videoMetaCache[key] = data;
          renderVideoDetails(el, data);
        } catch {
          renderVideoDetails(el, null);
        } finally {
          delete state.videoMetaInFlight[key];
        }
      }
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < maxWorkers; i++) workers.push(worker());
    await Promise.all(workers);
  }

  function showToast(msg: string): void {
    const t = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');
    if (toastMessage) toastMessage.textContent = msg;
    t?.classList.add('show');
    setTimeout(() => t?.classList.remove('show'), 3000);
  }

  async function copyToClipboard(text: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        console.warn('Clipboard API failed, trying fallback');
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;top:0;left:0;width:2em;height:2em;padding:0;border:none;outline:none;box-shadow:none;background:transparent;font-size:16px;';
    document.body.appendChild(textarea);

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
      const range = document.createRange();
      range.selectNodeContents(textarea);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      textarea.setSelectionRange(0, text.length);
    } else {
      textarea.focus();
      textarea.select();
    }

    let success = false;
    try {
      success = document.execCommand('copy');
    } catch {
      console.warn('execCommand copy failed');
    }

    document.body.removeChild(textarea);
    return success;
  }

  function lockPageScroll(): void {
    if (document.body.classList.contains('modal-open')) return;
    state.scrollLockY = window.scrollY || 0;
    document.body.classList.add('modal-open');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${state.scrollLockY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }

  function unlockPageScroll(): void {
    if (!document.body.classList.contains('modal-open')) return;
    document.body.classList.remove('modal-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    const y = state.scrollLockY || 0;
    state.scrollLockY = 0;
    window.scrollTo(0, y);
  }

  // ============ VIDEO MANAGEMENT ============
  function clearAllVideoTimers(): void {
    if (!state.videoTimers) return;
    for (const key of Object.keys(state.videoTimers) as (keyof typeof state.videoTimers)[]) {
      const t = state.videoTimers[key];
      if (t) clearTimeout(t);
      state.videoTimers[key] = null;
    }
  }

  function destroyVideo(): void {
    clearAllVideoTimers();
    if (state.videoStatusInterval) {
      clearInterval(state.videoStatusInterval);
      state.videoStatusInterval = null;
    }
    hideVideoOverlay();

    const video = els.modalContent?.querySelector('video') as HTMLVideoElement | null;
    if (video) {
      const events = ['loadstart', 'waiting', 'canplaythrough', 'playing',
                     'error', 'stalled', 'seeking', 'seeked', 'abort', 'ended'];
      events.forEach(e => (video as any)['on' + e] = null);

      try { video.pause(); } catch { /* ignore */ }
      video.src = '';
      video.load();
      video.remove();
    }
  }

  function killAllConnections(): void {
    destroyVideo();
    showToast('Connections reset');
  }

  function showVideoOverlay(message: string): void {
    if (els.overlayMessage) els.overlayMessage.textContent = message;
    els.videoOverlay?.classList.add('show');
  }

  function hideVideoOverlay(): void {
    els.videoOverlay?.classList.remove('show');
  }

  function reloadCurrentVideo(): void {
    destroyVideo();
    setTimeout(() => {
      updateModalContent();
      showToast('Video reloaded');
    }, 200);
  }

  // ============ MODAL CONTENT ============
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
  let currentSpeedIndex = 2;

  function updateModalContent(): void {
    const file = state.filteredFiles[state.currentIndex];
    if (!file) {
      closeModal();
      return;
    }

    destroyVideo();
    if (els.modalContent) els.modalContent.innerHTML = '';

    const path = file.path || file.name;
    const inlineUrl = file.inline_url || `/api/public/dl/${state.shareHash}/${encodePath(path)}?inline=true`;
    const previewUrl = buildPreviewUrl(path, file.size || 0);
    const downloadUrl = file.download_url || `/api/share/${state.shareHash}/file/${encodePath(path)}?download=1`;

    if (els.modalTitle) els.modalTitle.textContent = file.name;
    if (els.modalMeta) els.modalMeta.textContent = `${state.currentIndex + 1} of ${state.filteredFiles.length} • ${formatSize(file.size)}`;
    if (els.viewOriginal) els.viewOriginal.href = inlineUrl;
    if (els.download) {
      els.download.href = downloadUrl;
      els.download.download = file.name;
    }

    if (file.type === 'video') {
      if (els.speedBtn) els.speedBtn.style.display = 'inline-flex';
      if (els.resetVideoBtn) els.resetVideoBtn.style.display = 'inline-flex';
      createVideoPlayer(inlineUrl, previewUrl, file);
    } else {
      if (els.speedBtn) els.speedBtn.style.display = 'none';
      if (els.resetVideoBtn) els.resetVideoBtn.style.display = 'none';

      if (file.type === 'image' && els.modalContent) {
        els.modalContent.innerHTML = `<img class="modal-media zoomable" src="${inlineUrl}" alt="${file.name}" style="transform:scale(1)">`;
      } else if (els.modalContent) {
        els.modalContent.innerHTML = `
          <div style="text-align:center;padding:2rem;">
              <div style="font-size:4rem;margin-bottom:1rem;">${getFileIcon(file.extension)}</div>
              <p>Preview not available</p>
              <a href="${downloadUrl}" class="action-btn" style="margin-top:1rem;display:inline-flex;">⬇️ Download</a>
          </div>`;
      }
    }
  }

  function createVideoPlayer(videoUrl: string, posterUrl: string, file: GalleryFile): void {
    const container = document.createElement('div');
    container.style.cssText = 'position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;';

    const video = document.createElement('video');
    video.className = 'modal-media';
    video.controls = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.poster = posterUrl;
    video.innerHTML = `<source src="${videoUrl}">`;

    container.appendChild(video);
    els.modalContent?.appendChild(container);

    if (state.videoStatusInterval) {
      clearInterval(state.videoStatusInterval);
      state.videoStatusInterval = null;
    }

    function updateVideoMeta(): void {
      const base = `${state.currentIndex + 1} of ${state.filteredFiles.length} • ${formatSize(file?.size || 0)}`;

      const dur = Number.isFinite(video.duration) ? video.duration : null;
      if (!dur || dur <= 0) {
        if (els.modalMeta) els.modalMeta.textContent = base;
        return;
      }

      let bufferedTotal = 0;
      let bufferedAhead = 0;
      const ct = Number.isFinite(video.currentTime) ? video.currentTime : 0;
      try {
        const b = video.buffered;
        for (let i = 0; i < b.length; i++) {
          const s = b.start(i);
          const e = b.end(i);
          if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
          bufferedTotal += (e - s);
          if (ct >= s && ct <= e) bufferedAhead = Math.max(bufferedAhead, e - ct);
        }
      } catch { /* ignore */ }

      const pct = Math.max(0, Math.min(1, bufferedTotal / dur));
      const pctText = Math.round(pct * 100);

      let extra = ` • Buffered ${pctText}%`;
      const size = Number(file?.size || 0);
      if (Number.isFinite(size) && size > 0) {
        extra += ` (≈${formatSize(size * pct)} / ${formatSize(size)})`;
      }
      if (bufferedAhead > 0) extra += ` • Ahead ${Math.round(bufferedAhead)}s`;

      if (els.modalMeta) els.modalMeta.textContent = base + extra;
    }

    updateVideoMeta();
    state.videoStatusInterval = setInterval(updateVideoMeta, 500);
    video.addEventListener('progress', updateVideoMeta);
    video.addEventListener('timeupdate', updateVideoMeta);
    video.addEventListener('loadedmetadata', updateVideoMeta);
    video.addEventListener('seeking', updateVideoMeta);
    video.addEventListener('seeked', updateVideoMeta);

    video.playbackRate = speeds[currentSpeedIndex];

    let hasPlayed = false;

    if (state.videoTimers.stuck) clearTimeout(state.videoTimers.stuck);
    state.videoTimers.stuck = setTimeout(() => {
      if (!hasPlayed && !video.paused) {
        showVideoOverlay('Video stuck - tap anywhere to reload');
      }
    }, CONFIG.STUCK_TIMEOUT);

    video.onplaying = (): void => {
      hasPlayed = true;
      hideVideoOverlay();
      clearAllVideoTimers();
    };

    video.oncanplaythrough = (): void => {
      hideVideoOverlay();
    };

    video.onwaiting = (): void => {
      if (hasPlayed) {
        if (state.videoTimers.wait) clearTimeout(state.videoTimers.wait);
        state.videoTimers.wait = setTimeout(() => {
          if (video.readyState < 3) {
            showVideoOverlay('Buffering... tap to reload if stuck');
          }
        }, CONFIG.STUCK_TIMEOUT);
      }
    };

    video.onseeking = (): void => {
      if (state.videoTimers.seek) clearTimeout(state.videoTimers.seek);
      state.videoTimers.seek = setTimeout(() => {
        if (video.seeking) {
          showVideoOverlay('Seek stuck - tap anywhere to reload');
        }
      }, CONFIG.SEEK_TIMEOUT);
    };

    video.onseeked = (): void => {
      hideVideoOverlay();
      if (state.videoTimers.seek) {
        clearTimeout(state.videoTimers.seek);
        state.videoTimers.seek = null;
      }
    };

    video.onerror = (): void => {
      hideVideoOverlay();
      clearAllVideoTimers();
      showToast('Video failed to load');
    };

    video.onstalled = (): void => {
      if (state.videoTimers.stall) clearTimeout(state.videoTimers.stall);
      state.videoTimers.stall = setTimeout(() => {
        if (video.readyState < 3) {
          showVideoOverlay('Video stalled - tap to reload');
        }
      }, CONFIG.STUCK_TIMEOUT);
    };
  }

  // Speed control
  const speedBtn = document.getElementById('speedBtn');
  if (speedBtn) {
    speedBtn.onclick = (): void => {
      currentSpeedIndex = (currentSpeedIndex + 1) % speeds.length;
      const speed = speeds[currentSpeedIndex];
      if (els.speedBtn) els.speedBtn.textContent = speed === 1 ? '1x' : speed + 'x';
      const video = els.modalContent?.querySelector('video') as HTMLVideoElement | null;
      if (video) video.playbackRate = speed;
      showToast(`Speed: ${speed}x`);
    };
  }

  // Reset video button
  const resetVideoBtn = document.getElementById('resetVideoBtn');
  if (resetVideoBtn) {
    resetVideoBtn.onclick = reloadCurrentVideo;
  }

  // ============ MODAL FUNCTIONS ============
  function openModal(index: number): void {
    if (index < 0 || index >= state.filteredFiles.length) return;

    state.currentIndex = index;
    state.isZoomed = false;
    state.zoomScale = 1;
    state.pinchStartDistance = null;
    state.pinchStartScale = 1;
    const zoomBtn = document.getElementById('zoomBtn');
    if (zoomBtn) zoomBtn.textContent = '🔍';
    if (state.isSlideshow) toggleSlideshow();

    lockPageScroll();
    if (els.modal) {
      els.modal.style.display = 'block';
      els.modal.offsetHeight; // Force reflow
      els.modal.classList.add('show');
    }
    updateModalContent();
    resetImmersiveTimer();
    maybePreloadAdjacentImages();
  }
  window.openModal = openModal;

  function openMedia(index: number, evt?: MouseEvent): void {
    const file = state.filteredFiles[index];
    if (!file) return;

    if (file.type === 'video') {
      const path = file.path || file.name;
      const url = `/player?share=${encodeURIComponent(state.shareHash || '')}&file=${encodeURIComponent(path)}`;

      if (evt?.shiftKey) {
        openModal(index);
      } else {
        window.location.href = url;
      }
      return;
    }

    openModal(index);
  }
  window.openMedia = openMedia;

  function closeModal(): void {
    destroyVideo();
    if (state.isSlideshow) {
      if (state.slideshowInterval) clearInterval(state.slideshowInterval);
      state.isSlideshow = false;
    }
    state.isZoomed = false;
    state.zoomScale = 1;
    state.pinchStartDistance = null;
    state.pinchStartScale = 1;
    if (state.immersiveTimer) clearTimeout(state.immersiveTimer);
    els.modal?.classList.remove('show', 'immersive');
    setTimeout(() => {
      if (els.modal?.classList.contains('show')) return;
      if (els.modal) els.modal.style.display = 'none';
      if (els.modalContent) els.modalContent.innerHTML = '';
      unlockPageScroll();
    }, 300);
  }

  function navigate(direction: number): void {
    const newIndex = state.currentIndex + direction;
    if (newIndex >= 0 && newIndex < state.filteredFiles.length) {
      state.isZoomed = false;
      state.zoomScale = 1;
      state.pinchStartDistance = null;
      state.pinchStartScale = 1;
      const zoomBtn = document.getElementById('zoomBtn');
      if (zoomBtn) zoomBtn.textContent = '🔍';

      const nextFile = state.filteredFiles[newIndex];
      if (state.isSlideshow && nextFile?.type === 'video') {
        toggleSlideshow();
      }

      state.currentIndex = newIndex;
      updateModalContent();
      resetImmersiveTimer();
      maybePreloadAdjacentImages();
    }
  }

  function resetImmersiveTimer(): void {
    els.modal?.classList.add('active-user');
    if (state.immersiveTimer) clearTimeout(state.immersiveTimer);
    state.immersiveTimer = setTimeout(() => els.modal?.classList.remove('active-user'), 3000);
  }

  // ============ IMAGE PRELOADING ============
  const preloadCache = new Map<string, HTMLImageElement>();

  function preloadImage(url: string): void {
    if (preloadCache.has(url)) return;
    if (preloadCache.size >= CONFIG.MAX_PRELOAD_CACHE) {
      const firstKey = preloadCache.keys().next().value;
      if (firstKey) preloadCache.delete(firstKey);
    }
    const img = new Image();
    img.src = url;
    preloadCache.set(url, img);
  }

  function preloadAdjacentImages(): void {
    [-1, 1].forEach(offset => {
      const i = state.currentIndex + offset;
      if (i >= 0 && i < state.filteredFiles.length) {
        const file = state.filteredFiles[i];
        if (file.type === 'image') {
          const path = file.path || file.name;
          const url = file.inline_url || `/api/public/dl/${state.shareHash}/${encodePath(path)}?inline=true`;
          preloadImage(url);
        }
      }
    });
  }

  function maybePreloadAdjacentImages(): void {
    const current = state.filteredFiles[state.currentIndex];
    if (current?.type !== 'image') return;
    preloadAdjacentImages();
  }

  // ============ FILE ICON ============
  function getFileIcon(ext: string): string {
    const e = (ext || '').toLowerCase();
    const icons: Record<string, string> = {
      pdf: '📕', doc: '📄', docx: '📄', txt: '📝',
      xls: '📊', xlsx: '📊', csv: '📊',
      ppt: '📽️', pptx: '📽️',
      zip: '📦', rar: '📦', '7z': '📦',
      mp3: '🎵', wav: '🎵', flac: '🎵',
      html: '🌐', css: '🎨', js: '⚙️', json: '📋',
      py: '🐍', java: '☕',
    };
    return icons[e] || '📄';
  }

  // ============ GALLERY FUNCTIONS ============
  async function fetchFiles(forceRefresh = false): Promise<void> {
    const params = new URLSearchParams();
    if (forceRefresh) params.set('refresh', '1');
    const recursiveParam = new URLSearchParams(window.location.search).get('recursive');
    if (recursiveParam == null) {
      params.set('recursive', '1');
    } else {
      const v = String(recursiveParam).trim().toLowerCase();
      const flag = (v === '1' || v === 'true' || v === 'yes' || v === 'on') ? '1' : '0';
      params.set('recursive', flag);
    }
    params.set('v', String(Date.now()));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(
        `/api/share/${state.shareHash}/files?${params}`,
        { cache: 'no-store', signal: controller.signal }
      );
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      state.files = await res.json() as GalleryFile[];
      filterAndRender();
    } finally {
      clearTimeout(timeout);
    }
  }

  function filterAndRender(): void {
    if (els.loading) els.loading.style.display = 'none';
    if (els.error) els.error.style.display = 'none';

    const searchLower = state.search.toLowerCase();
    const matching = state.files.filter(f => f.name.toLowerCase().includes(searchLower));
    const countAll = document.getElementById('countAll');
    const countImages = document.getElementById('countImages');
    const countVideos = document.getElementById('countVideos');
    if (countAll) countAll.textContent = String(matching.length);
    if (countImages) countImages.textContent = String(matching.filter(f => f.type === 'image').length);
    if (countVideos) countVideos.textContent = String(matching.filter(f => f.type === 'video').length);

    state.filteredFiles = state.files.filter(file => {
      const matchesType = state.filter === 'all' || file.type === state.filter;
      const matchesSearch = file.name.toLowerCase().includes(searchLower);
      return matchesType && matchesSearch;
    });

    state.filteredFiles.sort((a, b) => {
      const typeScore = (t: string): number => t === 'image' ? 1 : (t === 'video' ? 2 : 3);
      switch (state.sort) {
        case 'type_asc': return typeScore(a.type) - typeScore(b.type) || a.name.localeCompare(b.name);
        case 'type_desc': return typeScore(b.type) - typeScore(a.type) || a.name.localeCompare(b.name);
        case 'name_asc': return a.name.localeCompare(b.name);
        case 'name_desc': return b.name.localeCompare(a.name);
        case 'size_asc': return a.size - b.size;
        case 'size_desc': return b.size - a.size;
        default: return 0;
      }
    });

    renderGrid();
  }

  function scheduleHydrateVideoDetails(): void {
    if (!state.showDetails) return;
    if (detailsHydrationTimer) clearTimeout(detailsHydrationTimer);
    detailsHydrationTimer = setTimeout(() => {
      hydrateVideoDetails().catch(() => { /* ignore */ });
    }, 120);
  }

  function resetVirtualScroll(): void {
    if (state.virtual.observer) {
      state.virtual.observer.disconnect();
    }
    if (state.virtual.sentinel?.parentNode) {
      state.virtual.sentinel.parentNode.removeChild(state.virtual.sentinel);
    }
    state.virtual.enabled = false;
    state.virtual.rendered = 0;
    state.virtual.sentinel = null;
    state.virtual.observer = null;
    state.virtual.inFlight = false;
    els.grid?.classList.remove('virtualized');
  }

  function createVirtualSentinel(): HTMLElement {
    const sentinel = document.createElement('div');
    sentinel.className = 'virtual-sentinel';
    sentinel.setAttribute('aria-hidden', 'true');
    return sentinel;
  }

  function renderBatch(start: number, end: number): void {
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      const file = state.filteredFiles[i];
      if (!file) continue;
      const card = document.createElement('div');
      card.className = 'media-card';
      card.innerHTML = createCardHTML(file, i);
      frag.appendChild(card);
    }

    if (state.virtual.sentinel) {
      els.grid?.insertBefore(frag, state.virtual.sentinel);
    } else {
      els.grid?.appendChild(frag);
    }
  }

  function renderNextBatch(): void {
    if (!state.virtual.enabled || state.virtual.inFlight) return;
    state.virtual.inFlight = true;

    const start = state.virtual.rendered;
    const end = Math.min(start + CONFIG.VIRTUAL_CHUNK_SIZE, state.filteredFiles.length);
    if (start >= end) {
      state.virtual.inFlight = false;
      if (state.virtual.observer) {
        state.virtual.observer.disconnect();
      }
      if (state.virtual.sentinel) {
        state.virtual.sentinel.remove();
        state.virtual.sentinel = null;
      }
      return;
    }

    renderBatch(start, end);
    state.virtual.rendered = end;

    if (state.virtual.rendered >= state.filteredFiles.length) {
      if (state.virtual.observer) {
        state.virtual.observer.disconnect();
      }
      if (state.virtual.sentinel) {
        state.virtual.sentinel.remove();
        state.virtual.sentinel = null;
      }
    }

    state.virtual.inFlight = false;
    scheduleHydrateVideoDetails();
  }

  function setupVirtualObserver(): void {
    if (!state.virtual.sentinel) return;
    if (!('IntersectionObserver' in window)) {
      renderBatch(state.virtual.rendered, state.filteredFiles.length);
      state.virtual.rendered = state.filteredFiles.length;
      state.virtual.enabled = false;
      els.grid?.classList.remove('virtualized');
      if (state.virtual.sentinel) {
        state.virtual.sentinel.remove();
        state.virtual.sentinel = null;
      }
      scheduleHydrateVideoDetails();
      return;
    }

    state.virtual.observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        renderNextBatch();
      }
    }, { rootMargin: `0px 0px ${CONFIG.VIRTUAL_PREFETCH_PX}px 0px` });

    state.virtual.observer.observe(state.virtual.sentinel);
  }

  function renderGrid(): void {
    resetVirtualScroll();
    if (els.grid) els.grid.innerHTML = '';

    if (state.filteredFiles.length === 0) {
      if (els.emptyTitle) els.emptyTitle.textContent = state.files.length === 0 ? 'This share is empty' : 'No files found';
      if (els.emptyMessage) els.emptyMessage.textContent = state.files.length === 0 ? 'No files have been shared yet.' : 'Try adjusting your search or filters';
      if (els.empty) els.empty.style.display = 'block';
      return;
    }

    if (els.empty) els.empty.style.display = 'none';

    const useVirtual = state.filteredFiles.length > CONFIG.VIRTUAL_SCROLL_THRESHOLD;
    if (useVirtual) {
      state.virtual.enabled = true;
      state.virtual.rendered = 0;
      els.grid?.classList.add('virtualized');
      state.virtual.sentinel = createVirtualSentinel();
      els.grid?.appendChild(state.virtual.sentinel);
      renderNextBatch();
      setupVirtualObserver();
    } else {
      renderBatch(0, state.filteredFiles.length);
      scheduleHydrateVideoDetails();
    }
  }

  function createCardHTML(file: GalleryFile, index: number): string {
    const path = file.path || file.name;
    const inlineUrl = file.inline_url || `/api/public/dl/${state.shareHash}/${encodePath(path)}?inline=true`;
    const downloadUrl = file.download_url || `/api/share/${state.shareHash}/file/${encodePath(path)}?download=1`;
    const previewUrl = buildPreviewUrl(path, file.size || 0);
    const previewSrcSet = buildPreviewSrcSet(path, file.size || 0);
    const previewSrcSetAttr = previewSrcSet ? `srcset="${previewSrcSet}" sizes="${PREVIEW_SIZES}"` : '';
    const isVideo = file.type === 'video';
    const isImage = file.type === 'image';

    let preview = '';
    if (isImage) {
      preview = `
        <img class="media-preview" src="${previewUrl}" ${previewSrcSetAttr} data-fallback="${inlineUrl}" loading="lazy" decoding="async" fetchpriority="low" alt="${file.name}"
             onerror="this.onerror=null;this.src=this.dataset.fallback;">`;
    } else if (isVideo) {
      preview = `
        <img class="media-preview" src="${previewUrl}" ${previewSrcSetAttr} loading="lazy" decoding="async" fetchpriority="low" alt="${file.name}"
             style="object-fit:cover;height:200px;width:100%;"
             onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="file-placeholder" style="background:#000;display:none;height:200px;align-items:center;justify-content:center;">
            <div style="font-size:2.75rem">🎞️</div>
        </div>
        <div class="play-icon">▶</div>`;
    } else {
      preview = `<div class="file-placeholder">${getFileIcon(file.extension)} ${file.extension.toUpperCase()}</div>`;
    }

    const tag = isVideo ? 'Video' : (isImage ? 'Image' : 'File');

    return `
      <div class="media-preview-container" onclick="openMedia(${index}, event)">
          <div class="media-tag">${tag}</div>
          ${preview}
      </div>
      <div class="media-info">
          <div class="media-title">
              <div class="media-name">${file.name}</div>
              ${isVideo ? `<div class="video-details" data-video-meta="1" data-path="${encodeURIComponent(path)}">Loading…</div>` : ''}
          </div>
          <div class="media-meta"><span>${file.extension.toUpperCase()}</span><span>${formatSize(file.size)}</span></div>
          <div class="card-actions">
              <button class="card-btn primary" onclick="openMedia(${index}, event)">${isVideo ? 'Play' : 'View'}</button>
              <a href="${downloadUrl}" download="${file.name}" class="card-btn">⬇</a>
          </div>
      </div>`;
  }

  // ============ SLIDESHOW ============
  function toggleSlideshow(): void {
    state.isSlideshow = !state.isSlideshow;
    const slideshowBtn = document.getElementById('slideshowBtn');
    if (slideshowBtn) slideshowBtn.textContent = state.isSlideshow ? '⏸' : '▶';

    if (state.isSlideshow) {
      els.modal?.classList.add('immersive');
      state.slideshowInterval = setInterval(() => {
        if (state.currentIndex < state.filteredFiles.length - 1) {
          navigate(1);
        } else {
          state.currentIndex = -1;
          navigate(1);
        }
      }, CONFIG.SLIDESHOW_INTERVAL);
    } else {
      if (state.slideshowInterval) clearInterval(state.slideshowInterval);
      els.modal?.classList.remove('immersive');
    }
  }

  // ============ EVENT HANDLERS ============
  function setupPullToRefresh(): void {
    if (!els.pullToRefresh) return;
    const indicator = els.pullToRefresh;
    const PULL_THRESHOLD = 70;
    const PULL_MAX = 120;
    let startY: number | null = null;

    function resetIndicator(): void {
      indicator.style.height = '0px';
      indicator.classList.remove('ready', 'refreshing');
      indicator.textContent = 'Pull to refresh';
      state.isPulling = false;
    }

    window.addEventListener('touchstart', (e: TouchEvent) => {
      if (state.isRefreshing || els.modal?.style.display === 'block') return;
      if (window.scrollY > 0) return;
      startY = e.touches[0].screenY;
      state.isPulling = true;
    }, { passive: true });

    window.addEventListener('touchmove', (e: TouchEvent) => {
      if (!state.isPulling || startY === null || state.isRefreshing) return;
      const delta = e.touches[0].screenY - startY;
      if (delta <= 0) return;
      const distance = Math.min(delta, PULL_MAX);
      indicator.style.height = `${distance}px`;
      indicator.classList.toggle('ready', distance >= PULL_THRESHOLD);
      indicator.textContent = distance >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh';
    }, { passive: true });

    window.addEventListener('touchend', () => {
      if (!state.isPulling) return;
      const shouldRefresh = indicator.classList.contains('ready');
      if (!shouldRefresh) {
        resetIndicator();
        startY = null;
        return;
      }
      state.isRefreshing = true;
      indicator.classList.remove('ready');
      indicator.classList.add('refreshing');
      indicator.style.height = '56px';
      indicator.textContent = 'Refreshing…';
      fetchFiles(true)
        .catch(console.error)
        .finally(() => {
          state.isRefreshing = false;
          resetIndicator();
        });
      startY = null;
    }, { passive: true });
  }

  function setupEventHandlers(): void {
    // Video overlay click handler
    if (els.videoOverlay) {
      els.videoOverlay.onclick = (e: MouseEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        reloadCurrentVideo();
      };
    }

    // Search
    let searchTimeout: ReturnType<typeof setTimeout>;
    if (els.search) {
      els.search.oninput = (e: Event): void => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          state.search = (e.target as HTMLInputElement).value;
          filterAndRender();
        }, 150);
      };
    }

    // Sort
    if (els.sort) {
      els.sort.onchange = (e: Event): void => {
        state.sort = (e.target as HTMLSelectElement).value;
        savePrefs({ sort: state.sort });
        filterAndRender();
      };
    }

    // Filters
    els.filters.forEach(btn => {
      btn.onclick = (): void => {
        els.filters.forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        state.filter = btn.dataset.filter || 'all';
        savePrefs({ filter: state.filter });
        filterAndRender();
      };
    });

    // Copy link
    if (els.copyLink) {
      els.copyLink.onclick = async (): Promise<void> => {
        const success = await copyToClipboard(window.location.href);
        showToast(success ? 'Link copied' : 'Copy failed - select and copy manually');
      };
    }

    // Stream Gallery button
    if (els.streamBtn) {
      els.streamBtn.onclick = (): void => {
        const streamUrl = '/stream/' + state.shareHash;
        window.open(streamUrl, '_blank');
      };
    }

    // Refresh
    if (els.refresh) {
      els.refresh.onclick = (e: MouseEvent): void => {
        if (e.shiftKey) {
          killAllConnections();
          location.reload();
        } else {
          fetchFiles(true).catch(console.error);
        }
      };
    }

    // Details toggle
    if (els.details) {
      els.details.onclick = (): void => setDetailsEnabled(!state.showDetails);
    }

    // Modal controls
    const closeBtn = document.getElementById('closeBtn');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const slideshowBtn = document.getElementById('slideshowBtn');
    const zoomBtn = document.getElementById('zoomBtn');
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    const gridBtn = document.getElementById('gridViewBtn');
    const listBtn = document.getElementById('listViewBtn');
    const helpBtn = document.getElementById('helpBtn');
    const closeHelpBtn = document.getElementById('closeHelpBtn');

    if (closeBtn) closeBtn.onclick = closeModal;
    if (prevBtn) prevBtn.onclick = (): void => navigate(-1);
    if (nextBtn) nextBtn.onclick = (): void => navigate(1);
    if (slideshowBtn) slideshowBtn.onclick = toggleSlideshow;

    // Zoom
    if (zoomBtn) {
      zoomBtn.onclick = (): void => {
        const media = els.modalContent?.querySelector('.modal-media');
        if (!media || media.tagName !== 'IMG') return;
        const nextScale = state.zoomScale > 1.05 ? 1 : 1.5;
        setZoomScale(nextScale);
      };
    }

    // Fullscreen
    if (fullscreenBtn) {
      fullscreenBtn.onclick = (): void => {
        if (document.fullscreenElement) {
          document.exitFullscreen?.();
          els.modal?.classList.remove('immersive');
        } else {
          els.modal?.requestFullscreen?.();
          els.modal?.classList.add('immersive');
        }
      };
    }

    // Layout toggle
    if (gridBtn) {
      gridBtn.onclick = (): void => {
        state.layout = 'grid';
        savePrefs({ layout: 'grid' });
        els.grid?.classList.remove('list-view');
        gridBtn.classList.add('active');
        listBtn?.classList.remove('active');
      };
    }
    if (listBtn) {
      listBtn.onclick = (): void => {
        state.layout = 'list';
        savePrefs({ layout: 'list' });
        els.grid?.classList.add('list-view');
        listBtn.classList.add('active');
        gridBtn?.classList.remove('active');
      };
    }

    // Back to top
    window.addEventListener('scroll', () => {
      els.backToTop?.classList.toggle('show', window.scrollY > 500);
    });
    if (els.backToTop) {
      els.backToTop.onclick = (): void => window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Help
    if (helpBtn) {
      helpBtn.onclick = (): void => els.helpOverlay?.classList.add('show');
    }
    if (closeHelpBtn) {
      closeHelpBtn.onclick = (): void => els.helpOverlay?.classList.remove('show');
    }
    if (els.helpOverlay) {
      els.helpOverlay.onclick = (e: MouseEvent): void => {
        if (e.target === els.helpOverlay) els.helpOverlay?.classList.remove('show');
      };
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault();
        els.helpOverlay?.classList.toggle('show');
        return;
      }

      if (e.key === 'Escape') {
        if (els.helpOverlay?.classList.contains('show')) {
          els.helpOverlay?.classList.remove('show');
        } else if (els.modal?.style.display === 'block') {
          closeModal();
        }
        return;
      }

      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        killAllConnections();
        return;
      }

      if ((e.key === 'r' || e.key === 'R') && els.modal?.style.display === 'block') {
        const file = state.filteredFiles[state.currentIndex];
        if (file?.type === 'video') {
          e.preventDefault();
          reloadCurrentVideo();
        }
        return;
      }

      if (els.modal?.style.display !== 'block') return;

      if (e.key === 'ArrowLeft') navigate(-1);
      else if (e.key === 'ArrowRight') navigate(1);
      else if (e.key === ' ' && state.filteredFiles[state.currentIndex]?.type !== 'video') {
        e.preventDefault();
        toggleSlideshow();
      }
    });

    function isZoomableTarget(target: EventTarget | null): boolean {
      const current = state.filteredFiles[state.currentIndex];
      if (!current || current.type !== 'image') return false;
      const el = target as HTMLElement;
      return !!(el && (el.classList?.contains('modal-media') || el.closest?.('.modal-media')));
    }

    // Touch swipe + pinch zoom (images)
    if (els.modalContent) {
      els.modalContent.addEventListener('touchstart', (e: TouchEvent) => {
        if (e.touches && e.touches.length === 2 && isZoomableTarget(e.target)) {
          const distance = getTouchDistance(e.touches);
          if (distance) {
            state.pinchStartDistance = distance;
            state.pinchStartScale = state.zoomScale || 1;
          }
          state.touchStartX = null;
          return;
        }

        const current = state.filteredFiles[state.currentIndex];
        if (current?.type === 'video') {
          state.touchStartX = null;
          return;
        }
        const target = e.target as HTMLElement;
        if (target.tagName === 'VIDEO' || target.closest('video')) {
          state.touchStartX = null;
          return;
        }
        state.touchStartX = e.changedTouches[0].screenX;
      }, { passive: true });

      els.modalContent.addEventListener('touchmove', (e: TouchEvent) => {
        if (!state.pinchStartDistance || !isZoomableTarget(e.target)) return;
        const distance = getTouchDistance(e.touches);
        if (!distance) return;
        const scale = state.pinchStartScale * (distance / state.pinchStartDistance);
        setZoomScale(scale);
        e.preventDefault();
      }, { passive: false });

      els.modalContent.addEventListener('touchend', (e: TouchEvent) => {
        if (state.pinchStartDistance && (!e.touches || e.touches.length < 2)) {
          state.pinchStartDistance = null;
          state.pinchStartScale = state.zoomScale || 1;
        }

        if (state.touchStartX === null) return;
        const current = state.filteredFiles[state.currentIndex];
        if (current?.type === 'video') return;
        const target = e.target as HTMLElement;
        if (target.tagName === 'VIDEO' || target.closest('video')) return;

        const diff = state.touchStartX - e.changedTouches[0].screenX;
        if (Math.abs(diff) > 50) navigate(diff > 0 ? 1 : -1);
      }, { passive: true });
    }

    // Mouse movement for immersive
    els.modal?.addEventListener('mousemove', resetImmersiveTimer);

    // Page visibility - pause video when hidden
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && els.modal?.style.display === 'block') {
        const video = els.modalContent?.querySelector('video') as HTMLVideoElement | null;
        if (video) video.pause();
      }
    });

    // Before unload - cleanup
    window.addEventListener('beforeunload', () => {
      destroyVideo();
      preloadCache.clear();
    });

    // Online/offline
    window.addEventListener('online', () => {
      state.isOffline = false;
      els.offlineBanner?.classList.remove('show');
      if (state.files.length === 0) fetchFiles(true).catch(console.error);
    });
    window.addEventListener('offline', () => {
      state.isOffline = true;
      els.offlineBanner?.classList.add('show');
    });

    // Fullscreen change
    document.addEventListener('fullscreenchange', () => {
      if (!document.fullscreenElement) els.modal?.classList.remove('immersive');
    });

    setupPullToRefresh();
  }

  // ============ INITIALIZATION ============
  async function init(): Promise<void> {
    initElements();
    initTheme();
    setupResourceHints();

    state.shareHash = new URLSearchParams(window.location.search).get('share') ||
                     window.location.pathname.split('/').filter(p => p && p !== 'gallery').pop() || null;

    if (!state.shareHash || state.shareHash === 'gallery') {
      if (els.loading) els.loading.style.display = 'none';
      if (els.errorTitle) els.errorTitle.textContent = 'Invalid share link';
      if (els.errorMessage) els.errorMessage.textContent = 'Please use a valid Dropbox share link.';
      if (els.error) els.error.style.display = 'block';
      return;
    }

    const prefs = loadPrefs();
    state.filter = prefs.filter || 'all';
    state.sort = prefs.sort || 'type_asc';
    state.showDetails = prefs.show_details !== undefined ? !!prefs.show_details : true;
    const isSmallScreen = window.matchMedia?.('(max-width: 900px)')?.matches;
    state.layout = prefs.layout || ((IS_IOS || isSmallScreen) ? 'list' : 'grid');

    if (els.sort) els.sort.value = state.sort;
    els.filters.forEach(b => {
      const isActive = b.dataset.filter === state.filter;
      b.classList.toggle('active', isActive);
      b.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    if (state.layout === 'list') {
      els.grid?.classList.add('list-view');
      document.getElementById('listViewBtn')?.classList.add('active');
      document.getElementById('gridViewBtn')?.classList.remove('active');
    }

    setDetailsEnabled(state.showDetails, { skipSave: true });
    setupEventHandlers();

    if (els.downloadAll) {
      els.downloadAll.href = `/api/share/${state.shareHash}/download`;
    }

    if (state.isOffline) {
      els.offlineBanner?.classList.add('show');
    }

    try {
      await fetchFiles();
    } catch (err) {
      console.error(err);
      if (els.loading) els.loading.style.display = 'none';
      if (els.errorTitle) els.errorTitle.textContent = 'Failed to load gallery';
      if (els.errorMessage) els.errorMessage.textContent = err instanceof Error ? err.message : 'Please check your connection.';
      if (els.error) els.error.style.display = 'block';
    }
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

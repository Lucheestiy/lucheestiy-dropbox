import { reportError, getRecoverySuggestion } from "./utils/error";

interface StreamConfig {
  RESUME_THRESHOLD: number;
  RESUME_MIN_DURATION: number;
  CONTROLS_HIDE_DELAY: number;
  STORAGE_KEY: string;
}

interface StreamFile {
  name: string;
  path?: string;
  type?: string;
  extension?: string;
  size?: number;
  inline_url?: string;
  download_url?: string;
}

interface ShareMeta {
  hash?: string;
  numDirs?: number;
  numFiles?: number;
  [key: string]: unknown;
}

interface VideoProgress {
  time: number;
  duration?: number;
  updated: number;
}

interface StreamState {
  shareHash: string | null;
  recursive: boolean;
  shareMeta: ShareMeta | null;
  files: StreamFile[];
  videoFiles: StreamFile[];
  currentIndex: number;
  isPlaying: boolean;
  isSeeking: boolean;
  isBuffering: boolean;
  allowDownload: boolean;
  controlsTimer: ReturnType<typeof setTimeout> | null;
  progressStorage: Record<string, VideoProgress>;
  lastMouseMove: number;
}

interface StreamElements {
  video: HTMLVideoElement | null;
  playerWrapper: HTMLElement | null;
  controls: HTMLElement | null;
  sidebar: HTMLElement | null;
  fileList: HTMLElement | null;
  fileCount: HTMLElement | null;
  shareInfo: HTMLElement | null;
  recursiveToggle: HTMLElement | null;
  videoTitle: HTMLElement | null;
  downloadBtn: HTMLAnchorElement | null;
  galleryBtn: HTMLAnchorElement | null;
  playBtn: HTMLElement | null;
  playIcon: HTMLElement | null;
  prevBtn: HTMLElement | null;
  nextBtn: HTMLElement | null;
  skipBackBtn: HTMLElement | null;
  skipForwardBtn: HTMLElement | null;
  muteBtn: HTMLElement | null;
  volumeIcon: HTMLElement | null;
  volumeSlider: HTMLInputElement | null;
  speedBtn: HTMLElement | null;
  speedMenu: HTMLElement | null;
  fullscreenBtn: HTMLElement | null;
  progressContainer: HTMLElement | null;
  progressFill: HTMLElement | null;
  progressBuffer: HTMLElement | null;
  progressHandle: HTMLElement | null;
  progressTooltip: HTMLElement | null;
  bufferSegments: HTMLElement | null;
  timeDisplay: HTMLElement | null;
  statusIndicator: HTMLElement | null;
  statusText: HTMLElement | null;
  errorOverlay: HTMLElement | null;
  errorTitle: HTMLElement | null;
  errorMessage: HTMLElement | null;
  emptyState: HTMLElement | null;
  emptyTitle: HTMLElement | null;
  emptyMessage: HTMLElement | null;
  emptyEnableSubfolders: HTMLElement | null;
  sidebarToggle: HTMLElement | null;
  sidebarBackdrop: HTMLElement | null;
}

(function (): void {
  "use strict";

  const CONFIG: StreamConfig = {
    RESUME_THRESHOLD: 10,
    RESUME_MIN_DURATION: 30,
    CONTROLS_HIDE_DELAY: 3000,
    STORAGE_KEY: "stream_gallery_progress",
  };

  const DROPPR_CONFIG = window.DROPPR_CONFIG || {};
  const PREVIEW_FORMAT = String(DROPPR_CONFIG.previewFormat || "auto")
    .trim()
    .toLowerCase();
  const ASSET_BASE_URL =
    typeof DROPPR_CONFIG.assetBaseUrl === "string"
      ? DROPPR_CONFIG.assetBaseUrl.replace(/\/+$/, "")
      : "";
  const THUMB_DEFAULT_WIDTHS = [48, 96];
  const THUMB_WIDTHS = normalizeWidths(DROPPR_CONFIG.previewThumbWidths || THUMB_DEFAULT_WIDTHS);

  const VIDEO_EXTS: Record<string, boolean> = {
    "3g2": true,
    "3gp": true,
    asf: true,
    avi: true,
    flv: true,
    m2ts: true,
    m2v: true,
    m4v: true,
    mkv: true,
    mov: true,
    mp4: true,
    mpe: true,
    mpeg: true,
    mpg: true,
    mts: true,
    mxf: true,
    ogv: true,
    ts: true,
    vob: true,
    webm: true,
    wmv: true,
  };

  const state: StreamState = {
    shareHash: null,
    recursive: false,
    shareMeta: null,
    files: [],
    videoFiles: [],
    currentIndex: -1,
    isPlaying: false,
    isSeeking: false,
    isBuffering: false,
    allowDownload: true,
    controlsTimer: null,
    progressStorage: {},
    lastMouseMove: 0,
  };

  const els: StreamElements = {
    video: document.getElementById("video") as HTMLVideoElement | null,
    playerWrapper: document.getElementById("playerWrapper"),
    controls: document.getElementById("controls"),
    sidebar: document.getElementById("sidebar"),
    fileList: document.getElementById("fileList"),
    fileCount: document.getElementById("fileCount"),
    shareInfo: document.getElementById("shareInfo"),
    recursiveToggle: document.getElementById("recursiveToggle"),
    videoTitle: document.getElementById("videoTitle"),
    downloadBtn: document.getElementById("downloadBtn") as HTMLAnchorElement | null,
    galleryBtn: document.getElementById("galleryBtn") as HTMLAnchorElement | null,
    playBtn: document.getElementById("playBtn"),
    playIcon: document.getElementById("playIcon"),
    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    skipBackBtn: document.getElementById("skipBackBtn"),
    skipForwardBtn: document.getElementById("skipForwardBtn"),
    muteBtn: document.getElementById("muteBtn"),
    volumeIcon: document.getElementById("volumeIcon"),
    volumeSlider: document.getElementById("volumeSlider") as HTMLInputElement | null,
    speedBtn: document.getElementById("speedBtn"),
    speedMenu: document.getElementById("speedMenu"),
    fullscreenBtn: document.getElementById("fullscreenBtn"),
    progressContainer: document.getElementById("progressContainer"),
    progressFill: document.getElementById("progressFill"),
    progressBuffer: document.getElementById("progressBuffer"),
    progressHandle: document.getElementById("progressHandle"),
    progressTooltip: document.getElementById("progressTooltip"),
    bufferSegments: document.getElementById("bufferSegments"),
    timeDisplay: document.getElementById("timeDisplay"),
    statusIndicator: document.getElementById("statusIndicator"),
    statusText: document.getElementById("statusText"),
    errorOverlay: document.getElementById("errorOverlay"),
    errorTitle: document.getElementById("errorTitle"),
    errorMessage: document.getElementById("errorMessage"),
    emptyState: document.getElementById("emptyState"),
    emptyTitle: document.getElementById("emptyTitle"),
    emptyMessage: document.getElementById("emptyMessage"),
    emptyEnableSubfolders: document.getElementById("emptyEnableSubfolders"),
    sidebarToggle: document.getElementById("sidebarToggle"),
    sidebarBackdrop: document.getElementById("sidebarBackdrop"),
  };

  function encodePath(p: string): string {
    return String(p || "")
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/");
  }

  function normalizeWidths(list: number[] | undefined): number[] {
    const values = Array.isArray(list) ? list : [];
    const normalized = values
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (normalized.length === 0) return THUMB_DEFAULT_WIDTHS.slice();
    normalized.sort((a, b) => a - b);
    const unique: number[] = [];
    normalized.forEach((value) => {
      if (unique[unique.length - 1] !== value) unique.push(value);
    });
    return unique;
  }

  function addResourceHint(href: string): void {
    if (!href || typeof href !== "string") return;
    const trimmed = href.replace(/\/+$/, "");
    if (!trimmed || trimmed === window.location.origin) return;
    if (document.querySelector(`link[rel="preconnect"][href="${trimmed}"]`)) return;
    const preconnect = document.createElement("link");
    preconnect.rel = "preconnect";
    preconnect.href = trimmed;
    preconnect.crossOrigin = "anonymous";
    document.head.appendChild(preconnect);
    const dnsPrefetch = document.createElement("link");
    dnsPrefetch.rel = "dns-prefetch";
    dnsPrefetch.href = trimmed;
    document.head.appendChild(dnsPrefetch);
  }

  function setupResourceHints(): void {
    addResourceHint(ASSET_BASE_URL);
  }

  function parseBoolParam(value: string | null): boolean | null {
    if (value == null) return null;
    const v = String(value).trim().toLowerCase();
    if (!v) return null;
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }

  function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
    return m + ":" + String(sec).padStart(2, "0");
  }

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let v = bytes,
      i = 0;
    while (v >= 1000 && i < units.length - 1) {
      v /= 1000;
      i++;
    }
    return v.toFixed(i === 0 ? 0 : 1) + " " + units[i];
  }

  function normalizeExt(value: string): string {
    let ext = String(value || "").trim();
    if (!ext) return "";
    if (ext.charAt(0) === ".") ext = ext.slice(1);
    return ext.toLowerCase();
  }

  function getFileExt(file: StreamFile): string {
    if (!file) return "";
    const metaExt = normalizeExt(file.extension || "");
    if (metaExt) return metaExt;
    let name = String(file.path || file.name || "");
    name = name.split("?")[0].split("#")[0];
    const idx = name.lastIndexOf(".");
    if (idx < 0) return "";
    return normalizeExt(name.slice(idx + 1));
  }

  function isVideoEntry(file: StreamFile): boolean {
    if (!file) return false;
    const t = String(file.type || "").toLowerCase();
    if (t === "video") return true;
    const ext = getFileExt(file);
    return !!(ext && VIDEO_EXTS[ext]);
  }

  function loadProgressStorage(): void {
    try {
      const data = localStorage.getItem(CONFIG.STORAGE_KEY);
      state.progressStorage = data ? JSON.parse(data) : {};
    } catch {
      state.progressStorage = {};
    }
  }

  function saveProgressStorage(): void {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.progressStorage));
    } catch {
      /* ignore */
    }
  }

  function getFilePath(file: StreamFile): string {
    if (!file) return "";
    return String(file.path || file.name || "");
  }

  function getFileName(file: StreamFile): string {
    if (!file) return "";
    return String(file.name || file.path || "");
  }

  function getVideoProgress(shareHash: string, fileKey: string): VideoProgress | null {
    return state.progressStorage[shareHash + ":" + fileKey] || null;
  }

  function setVideoProgress(
    shareHash: string,
    fileKey: string,
    currentTime: number,
    duration: number
  ): void {
    const key = shareHash + ":" + fileKey;
    if (duration && currentTime >= duration - CONFIG.RESUME_THRESHOLD) {
      delete state.progressStorage[key];
    } else if (currentTime > 5) {
      state.progressStorage[key] = { time: currentTime, duration: duration, updated: Date.now() };
    }
    saveProgressStorage();
  }

  function clearVideoProgress(shareHash: string, fileKey: string): void {
    delete state.progressStorage[shareHash + ":" + fileKey];
    saveProgressStorage();
  }

  async function fetchFiles(shareHash: string, recursive: boolean): Promise<any> {
    try {
      const flag = recursive ? "1" : "0";
      const resp = await fetch("/api/share/" + shareHash + "/files?recursive=" + flag);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return await resp.json();
    } catch (err) {
      reportError(err as Error, { context: { shareHash, recursive } });
      return null;
    }
  }

  interface FilesResponse {
    files?: StreamFile[];
    items?: StreamFile[];
  }

  function extractFilesFromResponse(
    data: StreamFile[] | FilesResponse | null
  ): StreamFile[] | null {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray((data as FilesResponse).files)) return (data as FilesResponse).files!;
    if (data && Array.isArray((data as FilesResponse).items)) return (data as FilesResponse).items!;
    return null;
  }

  async function fetchShareMeta(shareHash: string): Promise<ShareMeta | null> {
    try {
      const resp = await fetch("/api/public/share/" + shareHash);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      return data && typeof data === "object" ? (data as ShareMeta) : null;
    } catch (err) {
      console.warn("Failed to fetch share meta:", err);
      return null;
    }
  }

  async function updateEmptyStateHint(): Promise<void> {
    if (!els.emptyTitle || !els.emptyMessage) return;
    if (state.files && state.files.length > 0) {
      els.emptyTitle.textContent = "No Videos Found";
      els.emptyMessage.textContent =
        "This share has files, but none look like videos. Use Gallery for images.";
      if (els.emptyEnableSubfolders) els.emptyEnableSubfolders.style.display = "none";
      return;
    }

    const meta = state.shareMeta || (await fetchShareMeta(state.shareHash!));
    if (meta && !state.shareMeta) state.shareMeta = meta;

    const numDirs = meta && Number.isFinite(Number(meta.numDirs)) ? Number(meta.numDirs) : 0;
    const hasDirs = numDirs > 0;

    if (hasDirs && !state.recursive) {
      els.emptyTitle.textContent = "No Videos Found";
      els.emptyMessage.textContent =
        "This folder only has subfolders. Enable Subfolders to include them.";
      if (els.emptyEnableSubfolders) els.emptyEnableSubfolders.style.display = "";
    } else {
      els.emptyTitle.textContent = "No Videos Found";
      els.emptyMessage.textContent = "This share does not contain any video files.";
      if (els.emptyEnableSubfolders) els.emptyEnableSubfolders.style.display = "none";
    }
  }

  function getVideoUrl(shareHash: string, filePath: string): string {
    return "/api/share/" + shareHash + "/file/" + encodePath(filePath) + "?inline=true";
  }

  function getDownloadUrl(shareHash: string, filePath: string): string {
    return "/api/share/" + shareHash + "/file/" + encodePath(filePath) + "?download=1";
  }

  function getThumbnailUrl(shareHash: string, filePath: string, width?: number): string {
    let url = "/api/share/" + shareHash + "/preview/" + encodePath(filePath);
    const params: string[] = [];
    if (width) params.push("w=" + width);
    if (PREVIEW_FORMAT) params.push("format=" + encodeURIComponent(PREVIEW_FORMAT));
    if (params.length) url += "?" + params.join("&");
    return url;
  }

  function showStatus(text: string, isLoading?: boolean): void {
    if (els.statusText) els.statusText.textContent = text;
    els.statusIndicator?.classList.add("show");
    if (!isLoading) {
      setTimeout(function () {
        els.statusIndicator?.classList.remove("show");
      }, 1500);
    }
  }

  function hideStatus(): void {
    els.statusIndicator?.classList.remove("show");
  }

  function showError(title: string, message: string): void {
    if (els.errorTitle) els.errorTitle.textContent = title;
    if (els.errorMessage) {
      const suggestion = getRecoverySuggestion(message);
      els.errorMessage.innerHTML = message + '<br><small style="display:block;margin-top:0.5rem;opacity:0.8">' + suggestion + '</small>';
    }
    els.errorOverlay?.classList.add("show");
  }

  function hideError(): void {
    els.errorOverlay?.classList.remove("show");
  }

  function updatePlayButton(): void {
    if (els.playIcon) els.playIcon.innerHTML = state.isPlaying ? "&#10074;&#10074;" : "&#9658;";
  }

  function updateVolumeIcon(): void {
    if (!els.video || !els.volumeIcon) return;
    const vol = els.video.volume;
    const muted = els.video.muted;
    if (muted || vol === 0) els.volumeIcon.innerHTML = "&#128263;";
    else if (vol < 0.5) els.volumeIcon.innerHTML = "&#128265;";
    else els.volumeIcon.innerHTML = "&#128266;";
  }

  function updateTimeDisplay(): void {
    if (!els.video || !els.timeDisplay) return;
    const current = els.video.currentTime || 0;
    const duration = els.video.duration || 0;
    els.timeDisplay.textContent = formatTime(current) + " / " + formatTime(duration);
  }

  function updateProgress(): void {
    if (!els.video || !els.progressFill || !els.progressHandle) return;
    const current = els.video.currentTime || 0;
    const duration = els.video.duration || 0;
    const percent = duration > 0 ? (current / duration) * 100 : 0;
    els.progressFill.style.width = percent + "%";
    els.progressHandle.style.left = percent + "%";
  }

  function updateBufferSegments(): void {
    if (!els.video || !els.bufferSegments || !els.progressBuffer) return;
    const duration = els.video.duration;
    if (!duration || !Number.isFinite(duration)) {
      els.bufferSegments.innerHTML = "";
      els.progressBuffer.style.width = "0%";
      return;
    }
    const buffered = els.video.buffered;
    const segments: string[] = [];
    let maxEnd = 0;
    for (let i = 0; i < buffered.length; i++) {
      const start = buffered.start(i);
      const end = buffered.end(i);
      const startPercent = (start / duration) * 100;
      const widthPercent = ((end - start) / duration) * 100;
      segments.push(
        '<div class="buffer-segment" style="left:' +
          startPercent +
          "%;width:" +
          widthPercent +
          '%"></div>'
      );
      if (end > maxEnd) maxEnd = end;
    }
    els.bufferSegments.innerHTML = segments.join("");
    els.progressBuffer.style.width = (maxEnd / duration) * 100 + "%";
  }

  function showControls(): void {
    els.playerWrapper?.classList.remove("hide-controls");
    if (state.controlsTimer) clearTimeout(state.controlsTimer);
    if (state.isPlaying) {
      state.controlsTimer = setTimeout(function () {
        els.playerWrapper?.classList.add("hide-controls");
      }, CONFIG.CONTROLS_HIDE_DELAY);
    }
  }

  function renderFileList(): void {
    if (!els.fileList) return;
    els.fileList.innerHTML = "";
    state.videoFiles.forEach(function (file: StreamFile, index: number) {
      const item = document.createElement("div");
      item.className = "file-item";
      if (index === state.currentIndex) item.classList.add("active");
      const filePath = getFilePath(file);
      const fileName = getFileName(file);
      const progress = getVideoProgress(state.shareHash!, filePath);
      const thumbWidths = THUMB_WIDTHS.length ? THUMB_WIDTHS : THUMB_DEFAULT_WIDTHS;
      const thumbSrc = getThumbnailUrl(state.shareHash!, filePath, thumbWidths[0]);
      const thumbSrcSet = thumbWidths
        .map(function (width: number) {
          return getThumbnailUrl(state.shareHash!, filePath, width) + " " + width + "w";
        })
        .join(", ");
      const thumbSrcSetAttr = thumbSrcSet ? ' srcset="' + thumbSrcSet + '" sizes="48px"' : "";
      item.innerHTML =
        '<div class="file-thumb"><img src="' +
        thumbSrc +
        '"' +
        thumbSrcSetAttr +
        ' alt="" loading="lazy" onerror="this.parentElement.innerHTML=\'&#128249;\'"></div>' +
        '<div class="file-info"><div class="file-name">' +
        fileName +
        "</div>" +
        '<div class="file-meta"><span>' +
        formatBytes(file.size || 0) +
        "</span>" +
        (progress ? '<span class="resume-badge">' + formatTime(progress.time) + "</span>" : "") +
        "</div></div>";
      item.onclick = function () {
        loadVideo(index);
      };
      els.fileList!.appendChild(item);
    });
    if (els.fileCount)
      els.fileCount.textContent =
        state.videoFiles.length + " video" + (state.videoFiles.length !== 1 ? "s" : "");
  }

  function updateRecursiveToggle(): void {
    if (!els.recursiveToggle) return;
    const label = state.recursive ? "Subfolders: On" : "Subfolders: Off";
    els.recursiveToggle.textContent = label;
    els.recursiveToggle.setAttribute("aria-pressed", state.recursive ? "true" : "false");
    els.recursiveToggle.classList.toggle("active", state.recursive);
    if (els.galleryBtn && state.shareHash) {
      let galleryUrl = "/gallery/" + state.shareHash;
      if (state.recursive) galleryUrl += "?recursive=1";
      els.galleryBtn.href = galleryUrl;
    }
  }

  function updateActiveFileItem(): void {
    const items = els.fileList?.querySelectorAll(".file-item");
    items?.forEach(function (item: Element, i: number) {
      item.classList.toggle("active", i === state.currentIndex);
    });
    const activeItem = els.fileList?.querySelector(".file-item.active");
    if (activeItem)
      (activeItem as HTMLElement).scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function loadVideo(index: number): void {
    if (!els.video) return;
    if (index < 0 || index >= state.videoFiles.length) return;
    if (state.currentIndex >= 0 && state.currentIndex < state.videoFiles.length) {
      const currentFile = state.videoFiles[state.currentIndex];
      setVideoProgress(
        state.shareHash!,
        getFilePath(currentFile),
        els.video.currentTime,
        els.video.duration
      );
    }
    state.currentIndex = index;
    const file = state.videoFiles[index];
    const filePath = getFilePath(file);
    const fileName = getFileName(file);
    hideError();
    showStatus("Loading video...", true);
    if (els.videoTitle) els.videoTitle.textContent = fileName;
    if (els.downloadBtn)
      els.downloadBtn.href = file.download_url || getDownloadUrl(state.shareHash!, filePath);
    updateActiveFileItem();
    els.sidebar?.classList.remove("show");
    els.sidebarBackdrop?.classList.remove("show");
    const videoUrl = file.inline_url || getVideoUrl(state.shareHash!, filePath);
    els.video.src = videoUrl;
    els.video.load();
    const progress = getVideoProgress(state.shareHash!, filePath);
    if (progress && progress.time > 5) {
      els.video.addEventListener(
        "loadedmetadata",
        function onMeta() {
          els.video!.removeEventListener("loadedmetadata", onMeta);
          if (progress.time < els.video!.duration - CONFIG.RESUME_THRESHOLD) {
            els.video!.currentTime = progress.time;
            showStatus("Resuming from " + formatTime(progress.time), false);
          }
        },
        { once: true }
      );
    }
  }

  interface ReloadOptions {
    keepCurrent?: boolean;
    fileParam?: string;
  }

  async function reloadFiles(options?: ReloadOptions): Promise<boolean> {
    if (!els.video) return false;
    const keepCurrent = options?.keepCurrent;
    const fileParam = options?.fileParam;
    let currentPath: string | null = null;

    if (state.currentIndex >= 0 && state.currentIndex < state.videoFiles.length) {
      const currentFile = state.videoFiles[state.currentIndex];
      setVideoProgress(
        state.shareHash!,
        getFilePath(currentFile),
        els.video.currentTime,
        els.video.duration
      );
      if (keepCurrent) currentPath = getFilePath(currentFile);
    }

    showStatus("Loading files...", true);
    const data = await fetchFiles(state.shareHash!, state.recursive);
    let files: StreamFile[] | null = null;
    if (Array.isArray(data)) {
      files = data;
      state.allowDownload = true;
    } else if (data && typeof data === "object") {
      files = (data.files || []) as StreamFile[];
      state.allowDownload = data.meta?.allow_download !== false;
    }

    if (els.downloadBtn) {
      els.downloadBtn.style.display = state.allowDownload ? "inline-flex" : "none";
    }

    if (!files) {
      hideStatus();
      showError("Failed to load files", "Could not retrieve the file list from the server.");
      return false;
    }

    state.files = files || [];
    state.videoFiles = state.files.filter(function (f: StreamFile) {
      return isVideoEntry(f);
    });

    if (state.videoFiles.length === 0) {
      hideStatus();
      if (els.emptyState) els.emptyState.style.display = "flex";
      if (els.video) els.video.style.display = "none";
      if (els.controls) els.controls.style.display = "none";
      if (els.fileList) els.fileList.innerHTML = "";
      if (els.fileCount) els.fileCount.textContent = "0 videos";
      if (els.videoTitle) els.videoTitle.textContent = "Select a video";
      if (els.downloadBtn) els.downloadBtn.removeAttribute("href");
      state.currentIndex = -1;
      state.isPlaying = false;
      try {
        els.video.pause();
      } catch {
        /* ignore */
      }
      els.video.removeAttribute("src");
      els.video.load();
      await updateEmptyStateHint();
      return false;
    }

    if (els.emptyState) els.emptyState.style.display = "none";
    if (els.video) els.video.style.display = "";
    if (els.controls) els.controls.style.display = "";
    hideError();

    let idx = -1;
    if (fileParam) {
      idx = state.videoFiles.findIndex(function (f: StreamFile) {
        return f.name === fileParam || f.path === fileParam;
      });
    }
    if (idx < 0 && currentPath) {
      idx = state.videoFiles.findIndex(function (f: StreamFile) {
        return getFilePath(f) === currentPath;
      });
    }
    if (idx < 0) idx = 0;

    state.currentIndex = -1;
    renderFileList();
    loadVideo(idx);
    return true;
  }

  function playNext(): void {
    if (state.currentIndex < state.videoFiles.length - 1) loadVideo(state.currentIndex + 1);
  }

  function playPrev(): void {
    if (state.currentIndex > 0) loadVideo(state.currentIndex - 1);
  }

  function setupVideoEvents(): void {
    const video = els.video;
    if (!video) return;

    video.addEventListener("loadedmetadata", function () {
      updateTimeDisplay();
      updateProgress();
      hideStatus();
    });
    video.addEventListener("canplay", function () {
      hideStatus();
      state.isBuffering = false;
    });
    video.addEventListener("play", function () {
      state.isPlaying = true;
      updatePlayButton();
      showControls();
    });
    video.addEventListener("pause", function () {
      state.isPlaying = false;
      updatePlayButton();
      showControls();
      if (state.currentIndex >= 0) {
        const file = state.videoFiles[state.currentIndex];
        setVideoProgress(state.shareHash!, getFilePath(file), video.currentTime, video.duration);
      }
    });
    video.addEventListener("timeupdate", function () {
      updateTimeDisplay();
      updateProgress();
      if (Math.floor(video.currentTime) % 10 === 0 && state.currentIndex >= 0) {
        const file = state.videoFiles[state.currentIndex];
        setVideoProgress(state.shareHash!, getFilePath(file), video.currentTime, video.duration);
      }
    });
    video.addEventListener("progress", updateBufferSegments);
    video.addEventListener("waiting", function () {
      state.isBuffering = true;
      showStatus("Buffering...", true);
    });
    video.addEventListener("seeking", function () {
      state.isSeeking = true;
      showStatus("Seeking...", true);
    });
    video.addEventListener("seeked", function () {
      state.isSeeking = false;
      hideStatus();
    });
    video.addEventListener("ended", function () {
      state.isPlaying = false;
      updatePlayButton();
      if (state.currentIndex >= 0) {
        const file = state.videoFiles[state.currentIndex];
        clearVideoProgress(state.shareHash!, getFilePath(file));
      }
      playNext();
    });
    video.addEventListener("volumechange", function () {
      if (els.volumeSlider) els.volumeSlider.value = video.muted ? "0" : String(video.volume);
      updateVolumeIcon();
    });
    video.addEventListener("error", function () {
      hideStatus();
      showError(
        "Could not load video",
        "The video file may be corrupted or in an unsupported format."
      );
    });
  }

  function setupControlEvents(): void {
    const video = els.video;
    if (!video) return;

    if (els.playBtn) {
      els.playBtn.onclick = function () {
        if (video.paused) video.play();
        else video.pause();
      };
    }
    video.onclick = function () {
      if (video.paused) video.play();
      else video.pause();
    };
    if (els.prevBtn) els.prevBtn.onclick = playPrev;
    if (els.nextBtn) els.nextBtn.onclick = playNext;
    if (els.skipBackBtn) {
      els.skipBackBtn.onclick = function () {
        video.currentTime = Math.max(0, video.currentTime - 10);
      };
    }
    if (els.skipForwardBtn) {
      els.skipForwardBtn.onclick = function () {
        video.currentTime = Math.min(video.duration, video.currentTime + 10);
      };
    }
    if (els.muteBtn)
      els.muteBtn.onclick = function () {
        video.muted = !video.muted;
      };
    if (els.volumeSlider) {
      els.volumeSlider.oninput = function () {
        video.volume = parseFloat(els.volumeSlider!.value);
        video.muted = false;
      };
    }
    if (els.speedBtn)
      els.speedBtn.onclick = function () {
        els.speedMenu?.classList.toggle("show");
      };
    document.querySelectorAll(".speed-option").forEach(function (btn: Element) {
      (btn as HTMLElement).onclick = function () {
        const speed = parseFloat((btn as HTMLElement).dataset.speed || "1");
        video.playbackRate = speed;
        if (els.speedBtn) els.speedBtn.textContent = speed + "x";
        document.querySelectorAll(".speed-option").forEach(function (b: Element) {
          b.classList.remove("active");
        });
        btn.classList.add("active");
        els.speedMenu?.classList.remove("show");
      };
    });
    document.addEventListener("click", function (e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!els.speedBtn?.contains(target) && !els.speedMenu?.contains(target)) {
        els.speedMenu?.classList.remove("show");
      }
    });
    if (els.fullscreenBtn) {
      els.fullscreenBtn.onclick = function () {
        if (document.fullscreenElement) document.exitFullscreen();
        else els.playerWrapper?.requestFullscreen();
      };
    }

    let isDragging = false;
    function seekToPosition(e: MouseEvent): number {
      if (!els.progressContainer) return 0;
      const rect = els.progressContainer.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    }
    function updateTooltip(e: MouseEvent): void {
      if (!video) return;
      const percent = seekToPosition(e);
      const time = percent * (video.duration || 0);
      if (els.progressTooltip) {
        els.progressTooltip.textContent = formatTime(time);
        els.progressTooltip.style.left = percent * 100 + "%";
      }
    }
    if (els.progressContainer) {
      els.progressContainer.addEventListener("mousemove", updateTooltip);
      els.progressContainer.addEventListener("mousedown", function (e: MouseEvent) {
        isDragging = true;
        const percent = seekToPosition(e);
        video.currentTime = percent * video.duration;
      });
    }
    document.addEventListener("mousemove", function (e: MouseEvent) {
      if (isDragging) {
        const percent = seekToPosition(e);
        video.currentTime = percent * video.duration;
      }
    });
    document.addEventListener("mouseup", function () {
      isDragging = false;
    });
    if (els.progressContainer) {
      els.progressContainer.addEventListener("touchstart", function (e: TouchEvent) {
        isDragging = true;
        const touch = e.touches[0];
        const rect = els.progressContainer!.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
        video.currentTime = percent * video.duration;
      });
      els.progressContainer.addEventListener("touchmove", function (e: TouchEvent) {
        if (isDragging) {
          const touch = e.touches[0];
          const rect = els.progressContainer!.getBoundingClientRect();
          const percent = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
          video.currentTime = percent * video.duration;
        }
      });
      els.progressContainer.addEventListener("touchend", function () {
        isDragging = false;
      });
    }
    els.playerWrapper?.addEventListener("mousemove", showControls);
    els.playerWrapper?.addEventListener("mouseleave", function () {
      if (state.isPlaying) {
        state.controlsTimer = setTimeout(function () {
          els.playerWrapper?.classList.add("hide-controls");
        }, CONFIG.CONTROLS_HIDE_DELAY);
      }
    });
    if (els.sidebarToggle) {
      els.sidebarToggle.onclick = function () {
        els.sidebar?.classList.toggle("show");
        els.sidebarBackdrop?.classList.toggle("show");
      };
    }
    if (els.sidebarBackdrop) {
      els.sidebarBackdrop.onclick = function () {
        els.sidebar?.classList.remove("show");
        els.sidebarBackdrop?.classList.remove("show");
      };
    }
  }

  function setupKeyboardShortcuts(): void {
    const video = els.video;
    if (!video) return;

    document.addEventListener("keydown", function (e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          if (video.paused) video.play();
          else video.pause();
          break;
        case "ArrowLeft":
          e.preventDefault();
          video.currentTime -= e.shiftKey ? 30 : 10;
          break;
        case "ArrowRight":
          e.preventDefault();
          video.currentTime += e.shiftKey ? 30 : 10;
          break;
        case "ArrowUp":
          e.preventDefault();
          video.volume = Math.min(1, video.volume + 0.1);
          break;
        case "ArrowDown":
          e.preventDefault();
          video.volume = Math.max(0, video.volume - 0.1);
          break;
        case "m":
          video.muted = !video.muted;
          break;
        case "f":
          if (document.fullscreenElement) document.exitFullscreen();
          else els.playerWrapper?.requestFullscreen();
          break;
        case "n":
        case "N":
          playNext();
          break;
        case "p":
        case "P":
          playPrev();
          break;
        case "Home":
          e.preventDefault();
          video.currentTime = 0;
          break;
        case "End":
          e.preventDefault();
          video.currentTime = video.duration;
          break;
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
        case "8":
        case "9":
          e.preventDefault();
          video.currentTime = (parseInt(e.key) / 10) * video.duration;
          break;
      }
    });
  }

  function getShareHashFromLocation(): string {
    const params = new URLSearchParams(window.location.search);
    const share = params.get("share") || "";
    if (share && /^[A-Za-z0-9_-]{1,64}$/.test(share)) return share;

    const path = String(window.location.pathname || "");
    const m = path.match(/^\/stream\/([A-Za-z0-9_-]{1,64})\/?$/);
    if (m && m[1]) return m[1];
    return "";
  }

  async function init(): Promise<void> {
    const params = new URLSearchParams(window.location.search);
    state.shareHash = getShareHashFromLocation();
    if (!state.shareHash || !/^[A-Za-z0-9_-]{1,64}$/.test(state.shareHash)) {
      showError("Invalid share link", "The share hash is missing or invalid.");
      return;
    }
    setupResourceHints();
    loadProgressStorage();
    if (els.galleryBtn) els.galleryBtn.href = "/gallery/" + state.shareHash;
    if (els.shareInfo) els.shareInfo.textContent = state.shareHash;

    const recursiveParam = parseBoolParam(params.get("recursive"));
    state.recursive = recursiveParam === null ? false : recursiveParam;
    updateRecursiveToggle();
    if (els.recursiveToggle) {
      els.recursiveToggle.onclick = function () {
        state.recursive = !state.recursive;
        updateRecursiveToggle();
        reloadFiles({ keepCurrent: true });
      };
    }
    if (els.emptyEnableSubfolders) {
      els.emptyEnableSubfolders.onclick = function () {
        state.recursive = true;
        updateRecursiveToggle();
        reloadFiles({ keepCurrent: false });
      };
    }

    setupVideoEvents();
    setupControlEvents();
    setupKeyboardShortcuts();

    await reloadFiles({ fileParam: params.get("file") || undefined });
  }

  init();
})();

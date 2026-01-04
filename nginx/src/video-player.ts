import "./video-player.css";

interface VideoSources {
  original: { url: string; size: number | null };
  fast: { url: string | null; ready: boolean; size: number | null };
  hd: { url: string | null; ready: boolean; size: number | null };
  hls: { url: string | null; ready: boolean; variants: unknown[] };
}

interface SourcesApiResponse {
  original?: { url?: string; size?: number };
  fast?: { url?: string; ready?: boolean; size?: number };
  hd?: { url?: string; ready?: boolean; size?: number };
  hls?: { url?: string; ready?: boolean; variants?: unknown[] };
}

type SourceType = "original" | "fast" | "hd" | "hls";
type QualityMode = "auto" | "hd" | "fast";

(function (): void {
  "use strict";

  function encodePath(p: string): string {
    return String(p || "")
      .split("/")
      .map((s) => encodeURIComponent(s))
      .join("/");
  }

  function safeRelPath(value: string | null): string | null {
    if (value == null) return null;
    const v = String(value);
    if (v.startsWith("/") || v.startsWith("\\")) return null;
    if (v.includes("\\")) return null;
    const parts = v.split("/").filter(Boolean);
    if (!parts.length) return null;
    if (parts.some((p) => p === "..")) return null;
    return parts.join("/");
  }

  function showError(title: string, message: string): void {
    const errorTitle = document.getElementById("errorTitle");
    const errorMessage = document.getElementById("errorMessage");
    const error = document.getElementById("error");
    if (errorTitle) errorTitle.textContent = title || "Error";
    if (errorMessage) errorMessage.textContent = message || "";
    error?.classList.add("show");
  }

  const params = new URLSearchParams(window.location.search);
  const share = (params.get("share") || "").trim();
  const file = (params.get("file") || "").trim();

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(share)) {
    showError("Invalid link", "Missing or invalid share hash.");
    return;
  }

  const safeFile = safeRelPath(file);
  if (!safeFile) {
    showError("Invalid link", "Missing or invalid file path.");
    return;
  }

  const fileName = safeFile.split("/").pop() || safeFile;
  document.title = fileName + " - Dropbox";
  const fileNameEl = document.getElementById("fileName");
  if (fileNameEl) fileNameEl.textContent = fileName;
  const fileSubEl = document.getElementById("fileSub");
  if (fileSubEl) fileSubEl.textContent = share;

  const sourcesApiUrl = `/api/share/${share}/video-sources/${encodePath(safeFile)}`;
  const originalInlineUrlDefault = `/api/public/dl/${share}/${encodePath(safeFile)}?inline=true`;
  const downloadUrl = `/api/share/${share}/file/${encodePath(safeFile)}?download=1`;
  const backUrl = `/gallery/${share}`;

  const video = document.getElementById("video") as HTMLVideoElement;
  const bufferText = document.getElementById("bufferText");
  const timeText = document.getElementById("timeText");
  const bufferFill = document.getElementById("bufferFill");
  const backLink = document.getElementById("backLink") as HTMLAnchorElement | null;
  const downloadLink = document.getElementById("downloadLink") as HTMLAnchorElement | null;
  const openLink = document.getElementById("openLink") as HTMLAnchorElement | null;
  const qualityBtn = document.getElementById("qualityBtn");
  const reloadBtn = document.getElementById("reloadBtn");
  const hasStatusUI = !!(bufferText && timeText && bufferFill);

  if (backLink) backLink.href = backUrl;
  if (downloadLink) {
    downloadLink.href = downloadUrl;
    downloadLink.download = fileName;
  }
  if (openLink) openLink.href = originalInlineUrlDefault;

  const QUALITY_MODES: QualityMode[] = ["auto", "hd", "fast"];
  const QUALITY_LABEL: Record<QualityMode, string> = { auto: "Auto", hd: "HD", fast: "Fast" };

  let qualityMode: QualityMode = (params.get("quality") || "auto")
    .trim()
    .toLowerCase() as QualityMode;
  if (!QUALITY_MODES.includes(qualityMode)) qualityMode = "auto";

  const sources: VideoSources = {
    original: { url: originalInlineUrlDefault, size: null },
    fast: { url: null, ready: false, size: null },
    hd: { url: null, ready: false, size: null },
    hls: { url: null, ready: false, variants: [] },
  };

  let activeSource: SourceType | null = null;
  let switchInProgress = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  let sourceLoadStartedAt = 0;
  let sourcesPollTimer: ReturnType<typeof setInterval> | null = null;
  let sourcesPollStartedAt = 0;
  let sourcesPollInFlight = false;
  let lastHdFailureAt = 0;
  let hdFailureCount = 0;
  let hdSuppressedUntil = 0;
  let hdAutoDisabled = false;
  let hdStableTimer: ReturnType<typeof setTimeout> | null = null;
  let hdUpgradeTimer: ReturnType<typeof setTimeout> | null = null;
  let hdPrepareInFlight = false;
  let fastPrepareInFlight = false;
  let hlsPrepareInFlight = false;
  let hlsInstance: HlsInstance | null = null;

  let interactionTimer: ReturnType<typeof setTimeout> | null = null;
  let lastInteractionAt = 0;
  let isInteracting = false;

  const AUTO_STALL_FALLBACK_MS = 3500;
  const AUTO_STALL_FALLBACK_INITIAL_MS = 8000;
  const HD_FAILURE_BASE_COOLDOWN_MS = 15000;
  const HD_FAILURE_MAX_COOLDOWN_MS = 5 * 60 * 1000;
  const HD_FAILURE_DISABLE_AFTER = 3;
  const HD_STABLE_RESET_MS = 5000;
  const AUTO_HD_UPGRADE_DELAY_MS = 1200;
  const SOURCES_POLL_MS = 2000;
  const SOURCES_POLL_MAX_MS = 10 * 60 * 1000;
  const INTERACTION_IDLE_MS = 800;

  const UA = navigator.userAgent || "";
  const IS_IOS =
    /iPad|iPhone|iPod/i.test(UA) ||
    (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1);
  const AUTO_SWITCH_ENABLED = !IS_IOS;

  function supportsNativeHls(): boolean {
    return !!video.canPlayType && !!video.canPlayType("application/vnd.apple.mpegurl");
  }

  function supportsHlsJs(): boolean {
    return !!window.Hls && window.Hls.isSupported();
  }

  function canUseHls(): boolean {
    return supportsNativeHls() || supportsHlsJs();
  }

  function destroyHls(): void {
    if (!hlsInstance) return;
    try {
      hlsInstance.destroy();
    } catch {
      /* ignore */
    }
    hlsInstance = null;
  }

  function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  function clearHdStableTimer(): void {
    if (!hdStableTimer) return;
    clearTimeout(hdStableTimer);
    hdStableTimer = null;
  }

  function computeHdCooldownMs(): number {
    const exp = Math.max(0, hdFailureCount - 1);
    const ms = HD_FAILURE_BASE_COOLDOWN_MS * Math.pow(2, exp);
    return Math.min(HD_FAILURE_MAX_COOLDOWN_MS, ms);
  }

  function noteHdFailure(): void {
    lastHdFailureAt = Date.now();
    hdFailureCount = Math.min(10, hdFailureCount + 1);
    hdSuppressedUntil = lastHdFailureAt + computeHdCooldownMs();
    hdAutoDisabled = hdFailureCount >= HD_FAILURE_DISABLE_AFTER;
    clearHdStableTimer();
    if (hdUpgradeTimer) {
      clearTimeout(hdUpgradeTimer);
      hdUpgradeTimer = null;
    }
  }

  function noteHdStable(): void {
    hdFailureCount = 0;
    hdSuppressedUntil = 0;
    hdAutoDisabled = false;
  }

  function startHdStableTimer(): void {
    clearHdStableTimer();
    hdStableTimer = setTimeout(() => {
      if (activeSource !== "hd") return;
      if (video.paused) return;
      if (video.seeking) return;
      if (video.error) return;
      noteHdStable();
      updateStatusUI();
    }, HD_STABLE_RESET_MS);
  }

  function scheduleHdUpgrade(delayMs: number): void {
    if (qualityMode !== "auto") return;
    if (!AUTO_SWITCH_ENABLED) return;
    if (hdAutoDisabled) return;
    if (hdUpgradeTimer) clearTimeout(hdUpgradeTimer);
    hdUpgradeTimer = setTimeout(
      () => {
        hdUpgradeTimer = null;
        maybeUpgradeToHd();
      },
      Math.max(0, delayMs || 0)
    );
  }

  function sourceLabel(sourceType: SourceType | null): string {
    if (sourceType === "hls") return "Adaptive";
    if (sourceType === "hd") return "HD";
    if (sourceType === "fast") return "Fast";
    return "Original";
  }

  function setOpenLinkForSource(sourceType: SourceType | null): void {
    const src = sourceType && sources[sourceType] && sources[sourceType].url;
    if (openLink) openLink.href = src || sources.original.url || originalInlineUrlDefault;
  }

  function updateQualityUI(): void {
    const modeLabel = QUALITY_LABEL[qualityMode] || "Auto";
    const srcLabel = activeSource ? sourceLabel(activeSource) : "";
    if (qualityBtn) {
      qualityBtn.textContent =
        qualityMode === "auto" && srcLabel ? `${modeLabel} (${srcLabel})` : modeLabel;
    }
    if (fileSubEl) {
      fileSubEl.textContent = share;
    }

    setOpenLinkForSource(activeSource || "original");
  }

  function getStateLabel(): string {
    if (video.error) return "Error";
    if (video.seeking) return "Seeking";

    const elapsed = Date.now() - (sourceLoadStartedAt || 0);
    if (video.readyState === 0 && elapsed > 2000) {
      if (activeSource === "fast") return "Loading fast preview…";
      if (activeSource === "hd") return "Loading HD…";
      return "Loading original…";
    }

    if (!video.paused && video.readyState < 3) return "Buffering";
    if (!video.paused) return "Playing";
    if (video.currentTime > 0) return "Paused";
    if (video.readyState >= 2) return "Ready";
    return "Loading";
  }

  interface BufferedInfo {
    dur: number | null;
    ct: number;
    pct: number | null;
    ahead: number;
  }

  function getBufferedInfo(): BufferedInfo {
    const dur = Number.isFinite(video.duration) ? video.duration : null;
    const ct = Number.isFinite(video.currentTime) ? video.currentTime : 0;

    const ranges: [number, number][] = [];
    try {
      const b = video.buffered;
      for (let i = 0; i < b.length; i++) {
        const start = b.start(i);
        const end = b.end(i);
        if (Number.isFinite(start) && Number.isFinite(end) && end > start)
          ranges.push([start, end]);
      }
    } catch {
      /* ignore */
    }

    let total = 0;
    for (const [s, e] of ranges) total += e - s;

    let ahead = 0;
    for (const [s, e] of ranges) {
      if (ct >= s && ct <= e) {
        ahead = Math.max(0, e - ct);
        break;
      }
    }

    const pct = dur && dur > 0 ? Math.max(0, Math.min(1, total / dur)) : null;
    return { dur, ct, pct, ahead };
  }

  function updateStatusUI(): void {
    if (!hasStatusUI) return;
    const stateLabel = getStateLabel();
    const info = getBufferedInfo();

    if (timeText)
      timeText.textContent = info.dur
        ? `${formatTime(info.ct)} / ${formatTime(info.dur)}`
        : formatTime(info.ct);

    const modeLabel = QUALITY_LABEL[qualityMode] || "Auto";
    const srcLabel = activeSource ? sourceLabel(activeSource) : "";
    let text = srcLabel
      ? `${modeLabel} • ${srcLabel} • ${stateLabel}`
      : `${modeLabel} • ${stateLabel}`;

    if (info.pct != null && bufferFill) {
      const pctText = Math.round(info.pct * 100);
      text += ` • Buffered ${pctText}%`;
      if (info.ahead > 0) text += ` • Ahead ${Math.round(info.ahead)}s`;
      bufferFill.style.width = `${Math.max(0, Math.min(100, info.pct * 100)).toFixed(1)}%`;
    } else if (bufferFill) {
      bufferFill.style.width = "0%";
    }

    if (
      (qualityMode === "auto" || qualityMode === "hd") &&
      !sources.hd.ready &&
      hdPrepareInFlight
    ) {
      text += " • Preparing HD…";
    }
    if (
      (qualityMode === "auto" || qualityMode === "fast") &&
      !sources.fast.ready &&
      fastPrepareInFlight
    ) {
      text += " • Preparing Fast…";
    }
    if (qualityMode === "auto" && canUseHls() && !sources.hls.ready && hlsPrepareInFlight) {
      text += " • Preparing Adaptive…";
    }

    if (qualityMode === "auto" && !AUTO_SWITCH_ENABLED) {
      text += " • iOS: Auto=HD";
    }

    if (qualityMode === "auto" && sources.hd.ready && activeSource !== "hd") {
      if (hdAutoDisabled) {
        text += " • HD off (tap HD)";
      } else if (hdSuppressedUntil && Date.now() < hdSuppressedUntil) {
        const secs = Math.max(1, Math.ceil((hdSuppressedUntil - Date.now()) / 1000));
        text += ` • HD retry in ${secs}s`;
      }
    }

    if (bufferText) bufferText.textContent = text;
  }

  function startStatusTimer(): void {
    if (!hasStatusUI) return;
    if (statusTimer) return;
    statusTimer = setInterval(updateStatusUI, 500);
  }

  function stopStatusTimer(): void {
    if (!statusTimer) return;
    clearInterval(statusTimer);
    statusTimer = null;
  }

  function appendCacheBust(url: string, cacheBust: boolean): string {
    if (!cacheBust) return url;
    const sep = url.includes("?") ? "&" : "?";
    return url + sep + "v=" + Date.now();
  }

  function getUrlForSource(sourceType: SourceType, cacheBust: boolean): string | null {
    const base = sources[sourceType] && sources[sourceType].url;
    if (!base) return null;
    return appendCacheBust(base, cacheBust);
  }

  interface PickOptions {
    avoid?: string;
  }

  function pickPlayableSource(desired: SourceType, opts?: PickOptions): SourceType {
    const avoid = opts?.avoid ? String(opts.avoid) : "";

    if (desired === "hls") {
      if (avoid !== "hls" && sources.hls.ready && canUseHls()) return "hls";
      if (avoid !== "hd" && sources.hd.ready) return "hd";
      if (avoid !== "fast" && sources.fast.ready) return "fast";
      return "original";
    }

    if (desired === "hd") {
      if (avoid !== "hd" && sources.hd.ready) return "hd";
      if (avoid !== "fast" && sources.fast.ready) return "fast";
      return "original";
    }

    if (desired === "fast") {
      if (avoid !== "fast" && sources.fast.ready) return "fast";
      if (avoid !== "hd" && sources.hd.ready) return "hd";
      return "original";
    }

    if (avoid !== "hd" && sources.hd.ready) return "hd";
    if (avoid !== "fast" && sources.fast.ready) return "fast";
    return "original";
  }

  function desiredForCurrentMode(): SourceType {
    if (qualityMode === "fast") return "fast";
    if (qualityMode === "hd") return "hd";
    if (canUseHls() && sources.hls.ready) return "hls";
    if (!AUTO_SWITCH_ENABLED) return "hd";
    if (hdAutoDisabled) return "fast";
    if (video.paused) return "fast";
    if (isInteracting || video.seeking) return "fast";
    return "hd";
  }

  interface InteractionOptions {
    allowFastSwitch?: boolean;
  }

  function noteInteraction(opts?: InteractionOptions): void {
    const allowFastSwitch = opts?.allowFastSwitch !== false;

    lastInteractionAt = Date.now();
    if (!isInteracting) {
      isInteracting = true;
      if (hdUpgradeTimer) {
        clearTimeout(hdUpgradeTimer);
        hdUpgradeTimer = null;
      }
      if (qualityMode === "auto") {
        if (!sources.fast.ready && !fastPrepareInFlight) ensurePrepared(["fast"]);
        if (
          AUTO_SWITCH_ENABLED &&
          allowFastSwitch &&
          sources.fast.ready &&
          activeSource !== "fast" &&
          !switchInProgress
        ) {
          setSource("fast", { time: video.currentTime, shouldPlay: !video.paused });
        }
      }
      updateStatusUI();
    }

    if (interactionTimer) clearTimeout(interactionTimer);
    interactionTimer = setTimeout(() => {
      if (Date.now() - lastInteractionAt < INTERACTION_IDLE_MS) return;
      interactionTimer = null;
      if (!isInteracting) return;
      isInteracting = false;
      updateStatusUI();

      if (qualityMode === "auto" && !video.paused) {
        if (AUTO_SWITCH_ENABLED && !hdAutoDisabled && !sources.hd.ready && !hdPrepareInFlight) {
          ensurePrepared(["hd"]);
        }
        scheduleHdUpgrade(AUTO_HD_UPGRADE_DELAY_MS);
      }
    }, INTERACTION_IDLE_MS + 25);
  }

  function clearTimers(): void {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
  }

  interface SetSourceOptions {
    time?: number;
    shouldPlay?: boolean;
    cacheBust?: boolean;
  }

  function setHlsSource(opts?: SetSourceOptions): void {
    const targetTime = Number.isFinite(opts?.time) ? Math.max(0, opts!.time!) : null;
    const shouldPlay = !!opts?.shouldPlay;
    const cacheBust = !!opts?.cacheBust;

    const src = getUrlForSource("hls", cacheBust);
    if (!src) {
      showError("Could not load video", "Missing adaptive stream.");
      return;
    }

    switchInProgress = true;
    clearTimers();
    activeSource = "hls";
    sourceLoadStartedAt = Date.now();
    updateQualityUI();

    video.pause();
    destroyHls();
    video.removeAttribute("src");
    video.load();
    updateStatusUI();

    function finishLoad(): void {
      switchInProgress = false;
      updateQualityUI();
    }

    function applyTime(): void {
      try {
        if (targetTime != null) {
          const dur = Number.isFinite(video.duration) ? video.duration : null;
          video.currentTime = dur ? Math.min(targetTime, Math.max(0, dur - 0.25)) : targetTime;
        }
      } catch {
        /* ignore */
      }
    }

    if (supportsHlsJs() && window.Hls) {
      hlsInstance = new window.Hls({
        maxBufferLength: 60,
        backBufferLength: 60,
      });
      hlsInstance.attachMedia(video);
      hlsInstance.on(window.Hls.Events.MEDIA_ATTACHED, () => {
        hlsInstance!.loadSource(src);
      });
      hlsInstance.on(window.Hls.Events.MANIFEST_PARSED, () => {
        applyTime();
        if (shouldPlay) {
          video.play().catch(() => {
            /* ignore */
          });
        }
        finishLoad();
      });
      hlsInstance.on(window.Hls.Events.ERROR, (_: string, data?: HlsErrorData) => {
        if (data && data.fatal) {
          destroyHls();
          finishLoad();
          if (qualityMode === "auto") {
            setSource(pickPlayableSource("fast", { avoid: "hls" }), {
              time: targetTime ?? undefined,
              shouldPlay,
            });
          }
        }
      });
    } else {
      video.addEventListener(
        "loadedmetadata",
        () => {
          applyTime();
          if (shouldPlay) {
            video.play().catch(() => {
              /* ignore */
            });
          }
          finishLoad();
        },
        { once: true }
      );
      video.src = src;
      video.load();
    }

    startStatusTimer();
    updateStatusUI();
  }

  function setSource(sourceType: SourceType, opts?: SetSourceOptions): void {
    if (sourceType === "hls") {
      setHlsSource(opts);
      return;
    }

    const targetTime = Number.isFinite(opts?.time) ? Math.max(0, opts!.time!) : null;
    const shouldPlay = !!opts?.shouldPlay;
    const cacheBust = !!opts?.cacheBust;

    const src = getUrlForSource(sourceType, cacheBust);
    if (!src) {
      showError("Could not load video", "Missing source URL.");
      return;
    }

    switchInProgress = true;
    clearTimers();
    activeSource = sourceType;
    sourceLoadStartedAt = Date.now();
    updateQualityUI();

    const currentTimeBefore = video.currentTime || 0;

    function done(): void {
      switchInProgress = false;
      updateQualityUI();
    }

    video.pause();
    destroyHls();
    video.removeAttribute("src");
    video.load();
    updateStatusUI();

    video.addEventListener(
      "loadedmetadata",
      () => {
        try {
          if (targetTime != null) {
            const dur = Number.isFinite(video.duration) ? video.duration : null;
            video.currentTime = dur ? Math.min(targetTime, Math.max(0, dur - 0.25)) : targetTime;
          }
        } catch {
          /* ignore */
        }

        if (shouldPlay) {
          video.play().catch(() => {
            /* ignore */
          });
        }
        done();
      },
      { once: true }
    );

    video.addEventListener(
      "error",
      () => {
        done();
        if (qualityMode === "auto" && sourceType === "hd") {
          noteHdFailure();
          const t = Number.isFinite(targetTime) ? targetTime! : currentTimeBefore;
          setSource(pickPlayableSource("fast", { avoid: "hd" }), { time: t, shouldPlay });
        }
      },
      { once: true }
    );

    video.src = src;
    video.load();
    startStatusTimer();
    updateStatusUI();
  }

  interface FetchSourcesOptions {
    prepareTargets?: string[];
  }

  async function fetchSources(options?: FetchSourcesOptions): Promise<SourcesApiResponse | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const url = sourcesApiUrl + (sourcesApiUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
      let resp: Response;
      if (options?.prepareTargets?.length) {
        resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prepare: options.prepareTargets }),
          signal: controller.signal,
          cache: "no-store",
        });
      } else {
        resp = await fetch(url, { signal: controller.signal, cache: "no-store" });
      }
      if (!resp.ok) return null;
      const data = await resp.json();
      return data as SourcesApiResponse;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  function applySourcesData(data: SourcesApiResponse | null): void {
    if (!data || typeof data !== "object") return;

    if (data.original && typeof data.original === "object") {
      if (typeof data.original.url === "string" && data.original.url)
        sources.original.url = data.original.url;
      const s = Number(data.original.size);
      if (Number.isFinite(s) && s > 0) sources.original.size = Math.floor(s);
    }

    if (data.fast && typeof data.fast === "object") {
      if (typeof data.fast.url === "string" && data.fast.url) sources.fast.url = data.fast.url;
      if (typeof data.fast.ready === "boolean") sources.fast.ready = data.fast.ready;
      const s = Number(data.fast.size);
      sources.fast.size = Number.isFinite(s) && s > 0 ? Math.floor(s) : null;
    }

    if (data.hd && typeof data.hd === "object") {
      if (typeof data.hd.url === "string" && data.hd.url) sources.hd.url = data.hd.url;
      if (typeof data.hd.ready === "boolean") sources.hd.ready = data.hd.ready;
      const s = Number(data.hd.size);
      sources.hd.size = Number.isFinite(s) && s > 0 ? Math.floor(s) : null;
    }

    if (data.hls && typeof data.hls === "object") {
      if (typeof data.hls.url === "string" && data.hls.url) sources.hls.url = data.hls.url;
      if (typeof data.hls.ready === "boolean") sources.hls.ready = data.hls.ready;
      if (Array.isArray(data.hls.variants)) sources.hls.variants = data.hls.variants;
    }

    updateQualityUI();
    updateStatusUI();
  }

  function startSourcesPoller(): void {
    if (sourcesPollTimer) return;
    sourcesPollStartedAt = Date.now();
    sourcesPollTimer = setInterval(async () => {
      if (sourcesPollStartedAt && Date.now() - sourcesPollStartedAt > SOURCES_POLL_MAX_MS) {
        clearInterval(sourcesPollTimer!);
        sourcesPollTimer = null;
        fastPrepareInFlight = false;
        hdPrepareInFlight = false;
        updateStatusUI();
        return;
      }
      if (sourcesPollInFlight) return;
      sourcesPollInFlight = true;
      try {
        const beforeFast = sources.fast.ready;
        const beforeHd = sources.hd.ready;
        const beforeHls = sources.hls.ready;
        const data = await fetchSources();
        if (data) applySourcesData(data);
        const afterFast = sources.fast.ready;
        const afterHd = sources.hd.ready;
        const afterHls = sources.hls.ready;

        if (!beforeFast && afterFast) {
          fastPrepareInFlight = false;
          updateStatusUI();

          const shouldPlay = !video.paused;
          if (!switchInProgress) {
            if (qualityMode === "fast" && activeSource !== "fast") {
              setSource("fast", { time: video.currentTime, shouldPlay });
            } else if (qualityMode === "auto" && AUTO_SWITCH_ENABLED) {
              if ((isInteracting || video.seeking || video.paused) && activeSource !== "fast") {
                setSource("fast", { time: video.currentTime, shouldPlay });
              }
            }
          }
        }

        if (!beforeHd && afterHd) {
          hdPrepareInFlight = false;
          updateStatusUI();
          if (switchInProgress) {
            // wait for current switch to finish
          } else if (qualityMode === "hd") {
            const attemptSwitch = (): void => {
              if (switchInProgress) return;
              if (qualityMode !== "hd" || activeSource === "hd") return;
              if (isInteracting || video.seeking) {
                setTimeout(attemptSwitch, 500);
                return;
              }
              setSource("hd", { time: video.currentTime, shouldPlay: !video.paused });
            };
            attemptSwitch();
          } else if (qualityMode === "auto" && AUTO_SWITCH_ENABLED && !video.paused) {
            scheduleHdUpgrade(AUTO_HD_UPGRADE_DELAY_MS);
          }
        }

        if (!beforeHls && afterHls) {
          hlsPrepareInFlight = false;
          updateStatusUI();
          if (
            qualityMode === "auto" &&
            canUseHls() &&
            activeSource !== "hls" &&
            !switchInProgress
          ) {
            setSource("hls", { time: video.currentTime, shouldPlay: !video.paused });
          }
        }

        if (sources.fast.ready) fastPrepareInFlight = false;
        if (sources.hd.ready) hdPrepareInFlight = false;
        if (sources.hls.ready) hlsPrepareInFlight = false;

        if (!fastPrepareInFlight && !hdPrepareInFlight && !hlsPrepareInFlight) {
          clearInterval(sourcesPollTimer!);
          sourcesPollTimer = null;
        }
      } finally {
        sourcesPollInFlight = false;
      }
    }, SOURCES_POLL_MS);
  }

  async function ensurePrepared(targets: string[]): Promise<void> {
    if (!targets || !targets.length) return;
    if (targets.includes("fast")) fastPrepareInFlight = true;
    if (targets.includes("hd")) hdPrepareInFlight = true;
    if (targets.includes("hls")) hlsPrepareInFlight = true;
    updateStatusUI();
    const data = await fetchSources({ prepareTargets: targets });
    if (data) applySourcesData(data);
    startSourcesPoller();
  }

  function scheduleStallFallback(): void {
    if (qualityMode !== "auto") return;
    if (!AUTO_SWITCH_ENABLED) return;
    if (activeSource !== "hd") return;
    if (switchInProgress) return;
    if (video.paused) return;

    if (stallTimer) clearTimeout(stallTimer);
    const elapsed = Date.now() - (sourceLoadStartedAt || 0);
    const delay = elapsed < 6000 ? AUTO_STALL_FALLBACK_INITIAL_MS : AUTO_STALL_FALLBACK_MS;
    stallTimer = setTimeout(() => {
      if (qualityMode !== "auto") return;
      if (activeSource !== "hd") return;
      if (switchInProgress) return;
      if (video.paused) return;

      noteHdFailure();
      setSource(pickPlayableSource("fast", { avoid: "hd" }), {
        time: video.currentTime,
        shouldPlay: true,
      });
    }, delay);
  }

  function maybeUpgradeToHd(): void {
    if (qualityMode !== "auto") return;
    if (!AUTO_SWITCH_ENABLED) return;
    if (hdAutoDisabled) return;
    if (isInteracting) return;
    if (video.seeking) return;
    if (activeSource === "hd") return;
    if (!sources.hd.ready) return;
    if (hdSuppressedUntil && Date.now() < hdSuppressedUntil) return;
    if (switchInProgress) return;

    const shouldPlay = !video.paused;
    if (!shouldPlay) return;
    setSource("hd", { time: video.currentTime, shouldPlay: true });
  }

  function loadInitial(): void {
    startStatusTimer();
    updateStatusUI();

    fetchSources().then((data) => {
      if (data) applySourcesData(data);

      if (qualityMode === "auto" && canUseHls() && !sources.hls.ready) {
        ensurePrepared(["hls"]);
      }

      if (qualityMode === "auto" && !sources.fast.ready) {
        ensurePrepared(["fast"]);
      } else if (qualityMode === "hd" && !sources.hd.ready) {
        ensurePrepared(["hd"]);
      } else if (qualityMode === "fast" && !sources.fast.ready) {
        ensurePrepared(["fast"]);
      }

      const desired = desiredForCurrentMode();
      setSource(pickPlayableSource(desired), { time: 0, shouldPlay: false });
    });
  }

  function cycleQualityMode(): void {
    const idx = QUALITY_MODES.indexOf(qualityMode);
    const next = QUALITY_MODES[(idx + 1) % QUALITY_MODES.length];
    qualityMode = next;

    const t = video.currentTime;
    const shouldPlay = !video.paused;
    const desired = desiredForCurrentMode();

    if ((qualityMode === "auto" || qualityMode === "hd") && !sources.hd.ready)
      ensurePrepared(["hd"]);
    if (qualityMode === "auto" && !sources.fast.ready) ensurePrepared(["fast"]);
    if (qualityMode === "auto" && canUseHls() && !sources.hls.ready) ensurePrepared(["hls"]);
    if (qualityMode === "fast" && !sources.fast.ready) ensurePrepared(["fast"]);

    setSource(pickPlayableSource(desired), { time: t, shouldPlay });
  }

  if (qualityBtn) {
    qualityBtn.onclick = () => cycleQualityMode();
  }

  if (reloadBtn) {
    reloadBtn.onclick = () => {
      const t = video.currentTime;
      const shouldPlay = !video.paused;
      setSource(activeSource || pickPlayableSource(desiredForCurrentMode()), {
        time: t,
        shouldPlay,
        cacheBust: true,
      });
    };
  }

  video.addEventListener("play", () => {
    if (qualityMode === "auto" && canUseHls() && !sources.hls.ready && !hlsPrepareInFlight) {
      ensurePrepared(["hls"]);
    }
    if (qualityMode === "auto" && !sources.fast.ready && !fastPrepareInFlight)
      ensurePrepared(["fast"]);
    if (
      (qualityMode === "hd" || (qualityMode === "auto" && !hdAutoDisabled)) &&
      !sources.hd.ready &&
      !hdPrepareInFlight
    ) {
      ensurePrepared(["hd"]);
    }
    if (qualityMode === "fast" && !sources.fast.ready && !fastPrepareInFlight)
      ensurePrepared(["fast"]);
  });

  video.addEventListener("playing", () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
    if (activeSource === "hd") startHdStableTimer();
    if (qualityMode === "auto") scheduleHdUpgrade(AUTO_HD_UPGRADE_DELAY_MS);
    updateStatusUI();
  });
  video.addEventListener("seeking", () => {
    clearHdStableTimer();
    if (!switchInProgress) noteInteraction();
    updateStatusUI();
  });
  video.addEventListener("seeked", () => {
    noteInteraction({ allowFastSwitch: false });
    updateStatusUI();
  });
  video.addEventListener("waiting", () => {
    clearHdStableTimer();
    scheduleStallFallback();
    updateStatusUI();
  });
  video.addEventListener("stalled", () => {
    clearHdStableTimer();
    scheduleStallFallback();
    updateStatusUI();
  });
  video.addEventListener("progress", updateStatusUI);
  video.addEventListener("timeupdate", updateStatusUI);
  video.addEventListener("pause", () => {
    clearHdStableTimer();
    updateStatusUI();
  });

  video.addEventListener("error", () => {
    clearHdStableTimer();
    if (qualityMode === "auto" && activeSource === "hd") return;
    showError(
      "Could not load video",
      "Try refreshing the page. If it keeps failing, go back to the gallery."
    );
  });

  window.addEventListener("beforeunload", () => stopStatusTimer());

  loadInitial();
})();

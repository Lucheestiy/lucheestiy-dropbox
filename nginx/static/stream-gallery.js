(function () {
  const m = {
      RESUME_THRESHOLD: 10,
      RESUME_MIN_DURATION: 30,
      CONTROLS_HIDE_DELAY: 3e3,
      STORAGE_KEY: "stream_gallery_progress",
    },
    y = window.DROPPR_CONFIG || {},
    C = String(y.previewFormat || "auto")
      .trim()
      .toLowerCase(),
    U = typeof y.assetBaseUrl == "string" ? y.assetBaseUrl.replace(/\/+$/, "") : "",
    T = [48, 96],
    F = V(y.previewThumbWidths || T),
    W = {
      "3g2": !0,
      "3gp": !0,
      asf: !0,
      avi: !0,
      flv: !0,
      m2ts: !0,
      m2v: !0,
      m4v: !0,
      mkv: !0,
      mov: !0,
      mp4: !0,
      mpe: !0,
      mpeg: !0,
      mpg: !0,
      mts: !0,
      mxf: !0,
      ogv: !0,
      ts: !0,
      vob: !0,
      webm: !0,
      wmv: !0,
    },
    r = {
      shareHash: null,
      recursive: !1,
      shareMeta: null,
      files: [],
      videoFiles: [],
      currentIndex: -1,
      isPlaying: !1,
      isSeeking: !1,
      isBuffering: !1,
      controlsTimer: null,
      progressStorage: {},
      lastMouseMove: 0,
    },
    t = {
      video: document.getElementById("video"),
      playerWrapper: document.getElementById("playerWrapper"),
      controls: document.getElementById("controls"),
      sidebar: document.getElementById("sidebar"),
      fileList: document.getElementById("fileList"),
      fileCount: document.getElementById("fileCount"),
      shareInfo: document.getElementById("shareInfo"),
      recursiveToggle: document.getElementById("recursiveToggle"),
      videoTitle: document.getElementById("videoTitle"),
      downloadBtn: document.getElementById("downloadBtn"),
      galleryBtn: document.getElementById("galleryBtn"),
      playBtn: document.getElementById("playBtn"),
      playIcon: document.getElementById("playIcon"),
      prevBtn: document.getElementById("prevBtn"),
      nextBtn: document.getElementById("nextBtn"),
      skipBackBtn: document.getElementById("skipBackBtn"),
      skipForwardBtn: document.getElementById("skipForwardBtn"),
      muteBtn: document.getElementById("muteBtn"),
      volumeIcon: document.getElementById("volumeIcon"),
      volumeSlider: document.getElementById("volumeSlider"),
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
  function I(e) {
    return String(e || "")
      .split("/")
      .map((n) => encodeURIComponent(n))
      .join("/");
  }
  function V(e) {
    const i = (Array.isArray(e) ? e : [])
      .map((l) => Number(l))
      .filter((l) => Number.isFinite(l) && l > 0);
    if (i.length === 0) return T.slice();
    i.sort((l, u) => l - u);
    const s = [];
    return (
      i.forEach((l) => {
        s[s.length - 1] !== l && s.push(l);
      }),
      s
    );
  }
  function z(e) {
    if (!e || typeof e != "string") return;
    const n = e.replace(/\/+$/, "");
    if (
      !n ||
      n === window.location.origin ||
      document.querySelector(`link[rel="preconnect"][href="${n}"]`)
    )
      return;
    const i = document.createElement("link");
    ((i.rel = "preconnect"),
      (i.href = n),
      (i.crossOrigin = "anonymous"),
      document.head.appendChild(i));
    const s = document.createElement("link");
    ((s.rel = "dns-prefetch"), (s.href = n), document.head.appendChild(s));
  }
  function q() {
    z(U);
  }
  function G(e) {
    if (e == null) return null;
    const n = String(e).trim().toLowerCase();
    return n ? n === "1" || n === "true" || n === "yes" || n === "on" : null;
  }
  function g(e) {
    if (!Number.isFinite(e) || e < 0) return "0:00";
    const n = Math.floor(e),
      i = Math.floor(n / 3600),
      s = Math.floor((n % 3600) / 60),
      l = n % 60;
    return i > 0
      ? i + ":" + String(s).padStart(2, "0") + ":" + String(l).padStart(2, "0")
      : s + ":" + String(l).padStart(2, "0");
  }
  function j(e) {
    if (!Number.isFinite(e) || e < 0) return "";
    const n = ["B", "KB", "MB", "GB", "TB"];
    let i = e,
      s = 0;
    for (; i >= 1e3 && s < n.length - 1; ) ((i /= 1e3), s++);
    return i.toFixed(s === 0 ? 0 : 1) + " " + n[s];
  }
  function M(e) {
    let n = String(e || "").trim();
    return n ? (n.charAt(0) === "." && (n = n.slice(1)), n.toLowerCase()) : "";
  }
  function K(e) {
    if (!e) return "";
    const n = M(e.extension || "");
    if (n) return n;
    let i = String(e.path || e.name || "");
    i = i.split("?")[0].split("#")[0];
    const s = i.lastIndexOf(".");
    return s < 0 ? "" : M(i.slice(s + 1));
  }
  function Y(e) {
    if (!e) return !1;
    if (String(e.type || "").toLowerCase() === "video") return !0;
    const i = K(e);
    return !!(i && W[i]);
  }
  function $() {
    try {
      const e = localStorage.getItem(m.STORAGE_KEY);
      r.progressStorage = e ? JSON.parse(e) : {};
    } catch {
      r.progressStorage = {};
    }
  }
  function H() {
    try {
      localStorage.setItem(m.STORAGE_KEY, JSON.stringify(r.progressStorage));
    } catch {}
  }
  function f(e) {
    return e ? String(e.path || e.name || "") : "";
  }
  function P(e) {
    return e ? String(e.name || e.path || "") : "";
  }
  function D(e, n) {
    return r.progressStorage[e + ":" + n] || null;
  }
  function E(e, n, i, s) {
    const l = e + ":" + n;
    (s && i >= s - m.RESUME_THRESHOLD
      ? delete r.progressStorage[l]
      : i > 5 && (r.progressStorage[l] = { time: i, duration: s, updated: Date.now() }),
      H());
  }
  function X(e, n) {
    (delete r.progressStorage[e + ":" + n], H());
  }
  async function Z(e, n) {
    try {
      const i = n ? "1" : "0",
        s = await fetch("/api/share/" + e + "/files?recursive=" + i);
      if (!s.ok) throw new Error("HTTP " + s.status);
      return await s.json();
    } catch (i) {
      return (console.error("Failed to fetch files:", i), null);
    }
  }
  function J(e) {
    return Array.isArray(e)
      ? e
      : e && Array.isArray(e.files)
        ? e.files
        : e && Array.isArray(e.items)
          ? e.items
          : null;
  }
  async function Q(e) {
    try {
      const n = await fetch("/api/public/share/" + e);
      if (!n.ok) throw new Error("HTTP " + n.status);
      const i = await n.json();
      return i && typeof i == "object" ? i : null;
    } catch (n) {
      return (console.warn("Failed to fetch share meta:", n), null);
    }
  }
  async function ee() {
    if (!t.emptyTitle || !t.emptyMessage) return;
    if (r.files && r.files.length > 0) {
      ((t.emptyTitle.textContent = "No Videos Found"),
        (t.emptyMessage.textContent =
          "This share has files, but none look like videos. Use Gallery for images."),
        t.emptyEnableSubfolders && (t.emptyEnableSubfolders.style.display = "none"));
      return;
    }
    const e = r.shareMeta || (await Q(r.shareHash));
    (e && !r.shareMeta && (r.shareMeta = e),
      (e && Number.isFinite(Number(e.numDirs)) ? Number(e.numDirs) : 0) > 0 && !r.recursive
        ? ((t.emptyTitle.textContent = "No Videos Found"),
          (t.emptyMessage.textContent =
            "This folder only has subfolders. Enable Subfolders to include them."),
          t.emptyEnableSubfolders && (t.emptyEnableSubfolders.style.display = ""))
        : ((t.emptyTitle.textContent = "No Videos Found"),
          (t.emptyMessage.textContent = "This share does not contain any video files."),
          t.emptyEnableSubfolders && (t.emptyEnableSubfolders.style.display = "none")));
  }
  function te(e, n) {
    return "/api/share/" + e + "/file/" + I(n) + "?inline=true";
  }
  function ne(e, n) {
    return "/api/share/" + e + "/file/" + I(n) + "?download=1";
  }
  function A(e, n, i) {
    let s = "/api/share/" + e + "/preview/" + I(n);
    const l = [];
    return (
      i && l.push("w=" + i),
      C && l.push("format=" + encodeURIComponent(C)),
      l.length && (s += "?" + l.join("&")),
      s
    );
  }
  function v(e, n) {
    var i;
    (t.statusText && (t.statusText.textContent = e),
      (i = t.statusIndicator) == null || i.classList.add("show"),
      n ||
        setTimeout(function () {
          var s;
          (s = t.statusIndicator) == null || s.classList.remove("show");
        }, 1500));
  }
  function p() {
    var e;
    (e = t.statusIndicator) == null || e.classList.remove("show");
  }
  function S(e, n) {
    var i;
    (t.errorTitle && (t.errorTitle.textContent = e),
      t.errorMessage && (t.errorMessage.textContent = n),
      (i = t.errorOverlay) == null || i.classList.add("show"));
  }
  function R() {
    var e;
    (e = t.errorOverlay) == null || e.classList.remove("show");
  }
  function L() {
    t.playIcon && (t.playIcon.innerHTML = r.isPlaying ? "&#10074;&#10074;" : "&#9658;");
  }
  function re() {
    if (!t.video || !t.volumeIcon) return;
    const e = t.video.volume;
    t.video.muted || e === 0
      ? (t.volumeIcon.innerHTML = "&#128263;")
      : e < 0.5
        ? (t.volumeIcon.innerHTML = "&#128265;")
        : (t.volumeIcon.innerHTML = "&#128266;");
  }
  function N() {
    if (!t.video || !t.timeDisplay) return;
    const e = t.video.currentTime || 0,
      n = t.video.duration || 0;
    t.timeDisplay.textContent = g(e) + " / " + g(n);
  }
  function O() {
    if (!t.video || !t.progressFill || !t.progressHandle) return;
    const e = t.video.currentTime || 0,
      n = t.video.duration || 0,
      i = n > 0 ? (e / n) * 100 : 0;
    ((t.progressFill.style.width = i + "%"), (t.progressHandle.style.left = i + "%"));
  }
  function ie() {
    if (!t.video || !t.bufferSegments || !t.progressBuffer) return;
    const e = t.video.duration;
    if (!e || !Number.isFinite(e)) {
      ((t.bufferSegments.innerHTML = ""), (t.progressBuffer.style.width = "0%"));
      return;
    }
    const n = t.video.buffered,
      i = [];
    let s = 0;
    for (let l = 0; l < n.length; l++) {
      const u = n.start(l),
        o = n.end(l),
        a = (u / e) * 100,
        c = ((o - u) / e) * 100;
      (i.push('<div class="buffer-segment" style="left:' + a + "%;width:" + c + '%"></div>'),
        o > s && (s = o));
    }
    ((t.bufferSegments.innerHTML = i.join("")),
      (t.progressBuffer.style.width = (s / e) * 100 + "%"));
  }
  function b() {
    var e;
    ((e = t.playerWrapper) == null || e.classList.remove("hide-controls"),
      r.controlsTimer && clearTimeout(r.controlsTimer),
      r.isPlaying &&
        (r.controlsTimer = setTimeout(function () {
          var n;
          (n = t.playerWrapper) == null || n.classList.add("hide-controls");
        }, m.CONTROLS_HIDE_DELAY)));
  }
  function se() {
    t.fileList &&
      ((t.fileList.innerHTML = ""),
      r.videoFiles.forEach(function (e, n) {
        const i = document.createElement("div");
        ((i.className = "file-item"), n === r.currentIndex && i.classList.add("active"));
        const s = f(e),
          l = P(e),
          u = D(r.shareHash, s),
          o = F.length ? F : T,
          a = A(r.shareHash, s, o[0]),
          c = o
            .map(function (h) {
              return A(r.shareHash, s, h) + " " + h + "w";
            })
            .join(", "),
          d = c ? ' srcset="' + c + '" sizes="48px"' : "";
        ((i.innerHTML =
          '<div class="file-thumb"><img src="' +
          a +
          '"' +
          d +
          ` alt="" loading="lazy" onerror="this.parentElement.innerHTML='&#128249;'"></div><div class="file-info"><div class="file-name">` +
          l +
          '</div><div class="file-meta"><span>' +
          j(e.size || 0) +
          "</span>" +
          (u ? '<span class="resume-badge">' + g(u.time) + "</span>" : "") +
          "</div></div>"),
          (i.onclick = function () {
            B(n);
          }),
          t.fileList.appendChild(i));
      }),
      t.fileCount &&
        (t.fileCount.textContent =
          r.videoFiles.length + " video" + (r.videoFiles.length !== 1 ? "s" : "")));
  }
  function w() {
    if (!t.recursiveToggle) return;
    const e = r.recursive ? "Subfolders: On" : "Subfolders: Off";
    if (
      ((t.recursiveToggle.textContent = e),
      t.recursiveToggle.setAttribute("aria-pressed", r.recursive ? "true" : "false"),
      t.recursiveToggle.classList.toggle("active", r.recursive),
      t.galleryBtn && r.shareHash)
    ) {
      let n = "/gallery/" + r.shareHash;
      (r.recursive && (n += "?recursive=1"), (t.galleryBtn.href = n));
    }
  }
  function oe() {
    var i, s;
    const e = (i = t.fileList) == null ? void 0 : i.querySelectorAll(".file-item");
    e == null ||
      e.forEach(function (l, u) {
        l.classList.toggle("active", u === r.currentIndex);
      });
    const n = (s = t.fileList) == null ? void 0 : s.querySelector(".file-item.active");
    n && n.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function B(e) {
    var o, a;
    if (!t.video || e < 0 || e >= r.videoFiles.length) return;
    if (r.currentIndex >= 0 && r.currentIndex < r.videoFiles.length) {
      const c = r.videoFiles[r.currentIndex];
      E(r.shareHash, f(c), t.video.currentTime, t.video.duration);
    }
    r.currentIndex = e;
    const n = r.videoFiles[e],
      i = f(n),
      s = P(n);
    (R(),
      v("Loading video...", !0),
      t.videoTitle && (t.videoTitle.textContent = s),
      t.downloadBtn && (t.downloadBtn.href = n.download_url || ne(r.shareHash, i)),
      oe(),
      (o = t.sidebar) == null || o.classList.remove("show"),
      (a = t.sidebarBackdrop) == null || a.classList.remove("show"));
    const l = n.inline_url || te(r.shareHash, i);
    ((t.video.src = l), t.video.load());
    const u = D(r.shareHash, i);
    u &&
      u.time > 5 &&
      t.video.addEventListener(
        "loadedmetadata",
        function c() {
          (t.video.removeEventListener("loadedmetadata", c),
            u.time < t.video.duration - m.RESUME_THRESHOLD &&
              ((t.video.currentTime = u.time), v("Resuming from " + g(u.time), !1)));
        },
        { once: !0 }
      );
  }
  async function k(e) {
    if (!t.video) return !1;
    const n = e == null ? void 0 : e.keepCurrent,
      i = e == null ? void 0 : e.fileParam;
    let s = null;
    if (r.currentIndex >= 0 && r.currentIndex < r.videoFiles.length) {
      const a = r.videoFiles[r.currentIndex];
      (E(r.shareHash, f(a), t.video.currentTime, t.video.duration), n && (s = f(a)));
    }
    v("Loading files...", !0);
    const l = await Z(r.shareHash, r.recursive),
      u = J(l);
    if (!u)
      return (
        p(),
        S("Failed to load files", "Could not retrieve the file list from the server."),
        !1
      );
    if (
      ((r.files = u || []),
      (r.videoFiles = r.files.filter(function (a) {
        return Y(a);
      })),
      r.videoFiles.length === 0)
    ) {
      (p(),
        t.emptyState && (t.emptyState.style.display = "flex"),
        t.video && (t.video.style.display = "none"),
        t.controls && (t.controls.style.display = "none"),
        t.fileList && (t.fileList.innerHTML = ""),
        t.fileCount && (t.fileCount.textContent = "0 videos"),
        t.videoTitle && (t.videoTitle.textContent = "Select a video"),
        t.downloadBtn && t.downloadBtn.removeAttribute("href"),
        (r.currentIndex = -1),
        (r.isPlaying = !1));
      try {
        t.video.pause();
      } catch {}
      return (t.video.removeAttribute("src"), t.video.load(), await ee(), !1);
    }
    (t.emptyState && (t.emptyState.style.display = "none"),
      t.video && (t.video.style.display = ""),
      t.controls && (t.controls.style.display = ""),
      R());
    let o = -1;
    return (
      i &&
        (o = r.videoFiles.findIndex(function (a) {
          return a.name === i || a.path === i;
        })),
      o < 0 &&
        s &&
        (o = r.videoFiles.findIndex(function (a) {
          return f(a) === s;
        })),
      o < 0 && (o = 0),
      (r.currentIndex = -1),
      se(),
      B(o),
      !0
    );
  }
  function x() {
    r.currentIndex < r.videoFiles.length - 1 && B(r.currentIndex + 1);
  }
  function _() {
    r.currentIndex > 0 && B(r.currentIndex - 1);
  }
  function ae() {
    const e = t.video;
    e &&
      (e.addEventListener("loadedmetadata", function () {
        (N(), O(), p());
      }),
      e.addEventListener("canplay", function () {
        (p(), (r.isBuffering = !1));
      }),
      e.addEventListener("play", function () {
        ((r.isPlaying = !0), L(), b());
      }),
      e.addEventListener("pause", function () {
        if (((r.isPlaying = !1), L(), b(), r.currentIndex >= 0)) {
          const n = r.videoFiles[r.currentIndex];
          E(r.shareHash, f(n), e.currentTime, e.duration);
        }
      }),
      e.addEventListener("timeupdate", function () {
        if ((N(), O(), Math.floor(e.currentTime) % 10 === 0 && r.currentIndex >= 0)) {
          const n = r.videoFiles[r.currentIndex];
          E(r.shareHash, f(n), e.currentTime, e.duration);
        }
      }),
      e.addEventListener("progress", ie),
      e.addEventListener("waiting", function () {
        ((r.isBuffering = !0), v("Buffering...", !0));
      }),
      e.addEventListener("seeking", function () {
        ((r.isSeeking = !0), v("Seeking...", !0));
      }),
      e.addEventListener("seeked", function () {
        ((r.isSeeking = !1), p());
      }),
      e.addEventListener("ended", function () {
        if (((r.isPlaying = !1), L(), r.currentIndex >= 0)) {
          const n = r.videoFiles[r.currentIndex];
          X(r.shareHash, f(n));
        }
        x();
      }),
      e.addEventListener("volumechange", function () {
        (t.volumeSlider && (t.volumeSlider.value = e.muted ? "0" : String(e.volume)), re());
      }),
      e.addEventListener("error", function () {
        (p(),
          S(
            "Could not load video",
            "The video file may be corrupted or in an unsupported format."
          ));
      }));
  }
  function le() {
    var l, u;
    const e = t.video;
    if (!e) return;
    (t.playBtn &&
      (t.playBtn.onclick = function () {
        e.paused ? e.play() : e.pause();
      }),
      (e.onclick = function () {
        e.paused ? e.play() : e.pause();
      }),
      t.prevBtn && (t.prevBtn.onclick = _),
      t.nextBtn && (t.nextBtn.onclick = x),
      t.skipBackBtn &&
        (t.skipBackBtn.onclick = function () {
          e.currentTime = Math.max(0, e.currentTime - 10);
        }),
      t.skipForwardBtn &&
        (t.skipForwardBtn.onclick = function () {
          e.currentTime = Math.min(e.duration, e.currentTime + 10);
        }),
      t.muteBtn &&
        (t.muteBtn.onclick = function () {
          e.muted = !e.muted;
        }),
      t.volumeSlider &&
        (t.volumeSlider.oninput = function () {
          ((e.volume = parseFloat(t.volumeSlider.value)), (e.muted = !1));
        }),
      t.speedBtn &&
        (t.speedBtn.onclick = function () {
          var o;
          (o = t.speedMenu) == null || o.classList.toggle("show");
        }),
      document.querySelectorAll(".speed-option").forEach(function (o) {
        o.onclick = function () {
          var c;
          const a = parseFloat(o.dataset.speed || "1");
          ((e.playbackRate = a),
            t.speedBtn && (t.speedBtn.textContent = a + "x"),
            document.querySelectorAll(".speed-option").forEach(function (d) {
              d.classList.remove("active");
            }),
            o.classList.add("active"),
            (c = t.speedMenu) == null || c.classList.remove("show"));
        };
      }),
      document.addEventListener("click", function (o) {
        var c, d, h;
        const a = o.target;
        !((c = t.speedBtn) != null && c.contains(a)) &&
          !((d = t.speedMenu) != null && d.contains(a)) &&
          ((h = t.speedMenu) == null || h.classList.remove("show"));
      }),
      t.fullscreenBtn &&
        (t.fullscreenBtn.onclick = function () {
          var o;
          document.fullscreenElement
            ? document.exitFullscreen()
            : (o = t.playerWrapper) == null || o.requestFullscreen();
        }));
    let n = !1;
    function i(o) {
      if (!t.progressContainer) return 0;
      const a = t.progressContainer.getBoundingClientRect();
      return Math.max(0, Math.min(1, (o.clientX - a.left) / a.width));
    }
    function s(o) {
      if (!e) return;
      const a = i(o),
        c = a * (e.duration || 0);
      t.progressTooltip &&
        ((t.progressTooltip.textContent = g(c)), (t.progressTooltip.style.left = a * 100 + "%"));
    }
    (t.progressContainer &&
      (t.progressContainer.addEventListener("mousemove", s),
      t.progressContainer.addEventListener("mousedown", function (o) {
        n = !0;
        const a = i(o);
        e.currentTime = a * e.duration;
      })),
      document.addEventListener("mousemove", function (o) {
        if (n) {
          const a = i(o);
          e.currentTime = a * e.duration;
        }
      }),
      document.addEventListener("mouseup", function () {
        n = !1;
      }),
      t.progressContainer &&
        (t.progressContainer.addEventListener("touchstart", function (o) {
          n = !0;
          const a = o.touches[0],
            c = t.progressContainer.getBoundingClientRect(),
            d = Math.max(0, Math.min(1, (a.clientX - c.left) / c.width));
          e.currentTime = d * e.duration;
        }),
        t.progressContainer.addEventListener("touchmove", function (o) {
          if (n) {
            const a = o.touches[0],
              c = t.progressContainer.getBoundingClientRect(),
              d = Math.max(0, Math.min(1, (a.clientX - c.left) / c.width));
            e.currentTime = d * e.duration;
          }
        }),
        t.progressContainer.addEventListener("touchend", function () {
          n = !1;
        })),
      (l = t.playerWrapper) == null || l.addEventListener("mousemove", b),
      (u = t.playerWrapper) == null ||
        u.addEventListener("mouseleave", function () {
          r.isPlaying &&
            (r.controlsTimer = setTimeout(function () {
              var o;
              (o = t.playerWrapper) == null || o.classList.add("hide-controls");
            }, m.CONTROLS_HIDE_DELAY));
        }),
      t.sidebarToggle &&
        (t.sidebarToggle.onclick = function () {
          var o, a;
          ((o = t.sidebar) == null || o.classList.toggle("show"),
            (a = t.sidebarBackdrop) == null || a.classList.toggle("show"));
        }),
      t.sidebarBackdrop &&
        (t.sidebarBackdrop.onclick = function () {
          var o, a;
          ((o = t.sidebar) == null || o.classList.remove("show"),
            (a = t.sidebarBackdrop) == null || a.classList.remove("show"));
        }));
  }
  function ce() {
    const e = t.video;
    e &&
      document.addEventListener("keydown", function (n) {
        var s;
        const i = n.target;
        if (!(i.tagName === "INPUT" || i.tagName === "TEXTAREA"))
          switch (n.key) {
            case " ":
            case "k":
              (n.preventDefault(), e.paused ? e.play() : e.pause());
              break;
            case "ArrowLeft":
              (n.preventDefault(), (e.currentTime -= n.shiftKey ? 30 : 10));
              break;
            case "ArrowRight":
              (n.preventDefault(), (e.currentTime += n.shiftKey ? 30 : 10));
              break;
            case "ArrowUp":
              (n.preventDefault(), (e.volume = Math.min(1, e.volume + 0.1)));
              break;
            case "ArrowDown":
              (n.preventDefault(), (e.volume = Math.max(0, e.volume - 0.1)));
              break;
            case "m":
              e.muted = !e.muted;
              break;
            case "f":
              document.fullscreenElement
                ? document.exitFullscreen()
                : (s = t.playerWrapper) == null || s.requestFullscreen();
              break;
            case "n":
            case "N":
              x();
              break;
            case "p":
            case "P":
              _();
              break;
            case "Home":
              (n.preventDefault(), (e.currentTime = 0));
              break;
            case "End":
              (n.preventDefault(), (e.currentTime = e.duration));
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
              (n.preventDefault(), (e.currentTime = (parseInt(n.key) / 10) * e.duration));
              break;
          }
      });
  }
  function ue() {
    const n = new URLSearchParams(window.location.search).get("share") || "";
    if (n && /^[A-Za-z0-9_-]{1,64}$/.test(n)) return n;
    const s = String(window.location.pathname || "").match(/^\/stream\/([A-Za-z0-9_-]{1,64})\/?$/);
    return s && s[1] ? s[1] : "";
  }
  async function de() {
    const e = new URLSearchParams(window.location.search);
    if (((r.shareHash = ue()), !r.shareHash || !/^[A-Za-z0-9_-]{1,64}$/.test(r.shareHash))) {
      S("Invalid share link", "The share hash is missing or invalid.");
      return;
    }
    (q(),
      $(),
      t.galleryBtn && (t.galleryBtn.href = "/gallery/" + r.shareHash),
      t.shareInfo && (t.shareInfo.textContent = r.shareHash));
    const n = G(e.get("recursive"));
    ((r.recursive = n === null ? !1 : n),
      w(),
      t.recursiveToggle &&
        (t.recursiveToggle.onclick = function () {
          ((r.recursive = !r.recursive), w(), k({ keepCurrent: !0 }));
        }),
      t.emptyEnableSubfolders &&
        (t.emptyEnableSubfolders.onclick = function () {
          ((r.recursive = !0), w(), k({ keepCurrent: !1 }));
        }),
      ae(),
      le(),
      ce(),
      await k({ fileParam: e.get("file") || void 0 }));
  }
  de();
})();
//# sourceMappingURL=stream-gallery.js.map

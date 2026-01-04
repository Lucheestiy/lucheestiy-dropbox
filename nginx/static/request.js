(function () {
  const z = String(window.location.pathname || "").match(/\/request\/([^/]+)/),
    k = z ? z[1] : "",
    S = document.getElementById("subtitle"),
    P = document.getElementById("status"),
    A = document.getElementById("expires-note"),
    Y = document.getElementById("password-block"),
    g = document.getElementById("password-input"),
    d = document.getElementById("dropzone"),
    R = document.getElementById("file-input"),
    w = document.getElementById("upload-btn"),
    j = document.getElementById("file-list"),
    D = document.getElementById("captcha-block"),
    U = document.getElementById("captcha-widget"),
    F = d == null ? void 0 : d.querySelector(".hint");
  let E = !1,
    v = !1,
    f = !1,
    x = "",
    c = "",
    X = !1,
    q = [],
    T = 0,
    L = !1;
  const I = [];
  let B = 0;
  const Z = 8 * 1024 * 1024,
    $ = 32 * 1024 * 1024;
  function a(e, t) {
    ((P.textContent = e || ""), (P.className = "status" + (t ? " " + t : "")));
  }
  function _(e) {
    if (!e && e !== 0) return "";
    const t = ["B", "KB", "MB", "GB", "TB"];
    let s = 0,
      r = e;
    for (; r >= 1024 && s < t.length - 1; ) ((r /= 1024), (s += 1));
    return r.toFixed(r >= 10 || s === 0 ? 0 : 1) + " " + t[s];
  }
  function y(e) {
    if (!e) return "";
    const t = Math.ceil(e / 3600);
    if (t < 24) return "Expires in " + t + " hour" + (t === 1 ? "" : "s");
    const s = Math.ceil(t / 24);
    return "Expires in " + s + " day" + (s === 1 ? "" : "s");
  }
  function ee(e) {
    return !e || !e.length
      ? []
      : e
          .map((t) =>
            String(t || "")
              .trim()
              .replace(/^\./, "")
              .toLowerCase()
          )
          .filter((t) => t);
  }
  function te(e) {
    const t = String(e || ""),
      s = t.lastIndexOf(".");
    return s <= 0 || s === t.length - 1 ? "" : t.slice(s + 1).toLowerCase();
  }
  function se(e) {
    if (!q.length) return !0;
    const t = te(e);
    return t ? q.indexOf(t) >= 0 : !1;
  }
  function re(e) {
    if (!e) return "";
    const t = String(e || "").replace(/\\/g, "/");
    if (t.charAt(0) === "/") return "";
    const s = t.split("/").filter((r) => r);
    if (!s.length) return "";
    for (let r = 0; r < s.length; r += 1) {
      const l = s[r];
      if (l === "." || l === ".." || /[\x00-\x1f\x7f]/.test(l)) return "";
    }
    return s.join("/");
  }
  function oe() {
    if (!F) return;
    const e = "Multiple files supported. Keep the tab open until upload completes.",
      t = [];
    (q.length && t.push("Allowed types: " + q.join(", ") + "."),
      T && t.push("Max size: " + _(T) + "."),
      (F.textContent = t.length ? e + " " + t.join(" ") : e));
  }
  function ne() {
    if (!R) return;
    if (!q.length) {
      R.removeAttribute("accept");
      return;
    }
    const e = q.map((t) => "." + t).join(",");
    R.setAttribute("accept", e);
  }
  function O(e) {
    const t = document.createElement("li");
    return (
      (t.className = "file-item"),
      (t.innerHTML =
        '<div class="file-row"><div class="file-name"></div><div class="file-size"></div></div><div class="file-row"><div class="file-status"></div><div class="file-progress"></div></div><div class="progress-bar"><span></span></div>'),
      (t.querySelector(".file-name").textContent = e.name),
      (t.querySelector(".file-size").textContent = _(e.size)),
      (e.el = t),
      u(e),
      t
    );
  }
  function u(e) {
    if (!e.el) return;
    const t = e.status || "queued";
    let s =
      t === "uploading"
        ? "Uploading"
        : t === "done"
          ? "Complete"
          : t === "error"
            ? "Failed"
            : "Queued";
    if (t === "uploading" && e.speed) {
      if (((s += " (" + _(e.speed) + "/s"), e.eta && e.eta < 3600 * 24)) {
        const r = Math.floor(e.eta / 60),
          l = e.eta % 60;
        s += ", " + (r > 0 ? r + "m " : "") + l + "s left";
      }
      s += ")";
    }
    ((e.el.querySelector(".file-status").textContent = s),
      (e.el.querySelector(".file-progress").textContent =
        t === "done" ? "100%" : (e.progress || 0) + "%"),
      (e.el.querySelector(".progress-bar span").style.width = (e.progress || 0) + "%"));
  }
  function h() {
    if (!I.length || L) {
      w.disabled = !0;
      return;
    }
    if (E && !g.value) {
      w.disabled = !0;
      return;
    }
    if (f && !c) {
      w.disabled = !0;
      return;
    }
    w.disabled = !1;
  }
  function M(e, t, s) {
    ((v = !!t),
      s && (x = s),
      (f = !!e && v && !!x),
      f ? (D.classList.add("show"), ie()) : (D.classList.remove("show"), (c = "")),
      h());
  }
  function ie() {
    if (!v || !x || X) return;
    if (window.turnstile && typeof window.turnstile.render == "function") {
      N();
      return;
    }
    if (document.getElementById("turnstile-script")) return;
    const e = document.createElement("script");
    ((e.id = "turnstile-script"),
      (e.src = "https://challenges.cloudflare.com/turnstile/v0/api.js"),
      (e.async = !0),
      (e.defer = !0),
      (e.onload = N),
      document.head.appendChild(e));
  }
  function N() {
    !window.turnstile ||
      !U ||
      !x ||
      ((U.innerHTML = ""),
      (X = !0),
      window.turnstile.render(U, {
        sitekey: x,
        callback: (e) => {
          ((c = e || ""), h());
        },
        "expired-callback": () => {
          ((c = ""), h());
        },
        "error-callback": () => {
          ((c = ""), h());
        },
      }));
  }
  function K(e) {
    if (!e) return null;
    try {
      return JSON.parse(e);
    } catch {
      return null;
    }
  }
  function H(e, t) {
    B += 1;
    const s = {
      name: (e == null ? void 0 : e.name) || "Unknown file",
      size: (e == null ? void 0 : e.size) || 0,
      status: "error",
      progress: 0,
      el: null,
    };
    (j.appendChild(O(s)), a(t || "File rejected.", "error"));
  }
  function J(e) {
    const t = Array.prototype.slice.call(e || []);
    t.length &&
      (t.forEach((s) => {
        const r = re(s.webkitRelativePath || s.name);
        if (!r) {
          H(s, "Invalid file path.");
          return;
        }
        if (T && s.size > T) {
          H(s, "File exceeds the maximum allowed size.");
          return;
        }
        if (!se(r)) {
          H(s, "Unsupported file type.");
          return;
        }
        B += 1;
        const l = {
          id: B,
          file: s,
          name: s.name,
          size: s.size,
          relPath: r,
          status: "queued",
          progress: 0,
          el: null,
        };
        (I.push(l), j.appendChild(O(l)));
      }),
      a("Ready to upload " + t.length + " file" + (t.length === 1 ? "" : "s") + ".", ""),
      h());
  }
  function V(e, t = 0) {
    return new Promise((s) => {
      ((e.status = "uploading"),
        t === 0 &&
          ((e.progress = 0),
          (e.startTime = Date.now()),
          (e.lastTime = e.startTime),
          (e.lastLoaded = 0)),
        u(e));
      const r = new XMLHttpRequest();
      (r.open("POST", "/api/droppr/requests/" + encodeURIComponent(k) + "/upload"),
        (r.timeout = 0),
        E && g.value && r.setRequestHeader("X-Request-Password", encodeURIComponent(g.value)),
        f && c && r.setRequestHeader("X-Captcha-Token", c),
        (r.upload.onprogress = (n) => {
          if (!n.lengthComputable) return;
          const p = Date.now(),
            C = (p - (e.startTime || p)) / 1e3;
          (C > 0 &&
            ((e.speed = n.loaded / C),
            e.speed > 0 && (e.eta = Math.round((n.total - n.loaded) / e.speed))),
            (e.progress = Math.max(1, Math.floor((n.loaded / n.total) * 100))),
            u(e));
        }));
      const l = () => {
        if (t < 3) {
          const p = Math.pow(2, t) * 1e3 + Math.random() * 1e3;
          (a("Upload failed. Retrying in " + Math.round(p / 1e3) + "s...", "warning"),
            setTimeout(() => {
              V(e, t + 1).then(s);
            }, p));
        } else ((e.status = "error"), u(e), a("Upload failed after 4 attempts.", "error"), s());
      };
      ((r.onerror = () => {
        l();
      }),
        (r.onload = () => {
          const n = K(r.responseText || "");
          if (
            (n &&
              typeof n == "object" &&
              M(!!n.captcha_required, !!n.captcha_enabled, n.captcha_site_key || ""),
            r.status >= 200 && r.status < 300)
          ) {
            ((e.status = "done"), (e.progress = 100), u(e), f && M(!1, v, x), s());
            return;
          }
          if (r.status === 502 || r.status === 503 || r.status === 504 || r.status === 0) {
            l();
            return;
          }
          (r.status === 401
            ? a((n == null ? void 0 : n.error) || "Password required or incorrect.", "error")
            : r.status === 403
              ? a((n == null ? void 0 : n.error) || "Verification required.", "error")
              : r.status === 410
                ? a("This request link has expired.", "error")
                : r.status === 429
                  ? a(
                      (n == null ? void 0 : n.error) || "Too many attempts. Try again later.",
                      "error"
                    )
                  : r.status === 400 || r.status === 413 || r.status === 415
                    ? a((n == null ? void 0 : n.error) || "Upload rejected.", "error")
                    : a(
                        (n == null ? void 0 : n.error) || "Upload failed (" + r.status + ").",
                        "error"
                      ),
            (e.status = "error"),
            u(e),
            s());
        }));
      const b = new FormData();
      (b.append("file", e.file, e.file.name),
        e.relPath && e.relPath !== e.file.name && b.append("relative_path", e.relPath),
        r.send(b));
    });
  }
  function ae(e) {
    return new Promise((t) => {
      ((e.status = "uploading"), (e.progress = 0), (e.startTime = Date.now()), u(e));
      const s = e.file.size;
      let r = 0,
        l = e.uploadId || "",
        b = 0,
        n = 0;
      function p() {
        if (r >= s) {
          ((e.status = "done"), (e.progress = 100), u(e), t());
          return;
        }
        const C = Math.min(r + Z, s),
          ce = e.file.slice(r, C),
          i = new XMLHttpRequest();
        (i.open("POST", "/api/droppr/requests/" + encodeURIComponent(k) + "/upload-chunk"),
          (i.timeout = 0),
          i.setRequestHeader("Content-Range", "bytes " + r + "-" + (C - 1) + "/" + s),
          i.setRequestHeader("X-Upload-Offset", String(r)),
          i.setRequestHeader("X-Upload-Length", String(s)),
          i.setRequestHeader("X-Upload-Path", e.relPath || e.file.name),
          i.setRequestHeader("Content-Type", e.file.type || "application/octet-stream"),
          l && i.setRequestHeader("X-Upload-Id", l),
          E && g.value && i.setRequestHeader("X-Request-Password", encodeURIComponent(g.value)),
          f && c && i.setRequestHeader("X-Captcha-Token", c),
          (i.upload.onprogress = (o) => {
            if (!o.lengthComputable) return;
            const m = r + o.loaded,
              Q = Date.now(),
              W = (Q - (e.startTime || Q)) / 1e3;
            W > 0 && ((e.speed = m / W), e.speed > 0 && (e.eta = Math.round((s - m) / e.speed)));
            const pe = Math.floor((m / s) * 100);
            ((e.progress = Math.max(1, Math.min(99, pe))), u(e));
          }));
        const G = () => {
          if (n < 5) {
            const m = Math.pow(2, n) * 1e3 + Math.random() * 1e3;
            (a("Chunk upload failed. Retrying in " + Math.round(m / 1e3) + "s...", "warning"),
              (n += 1),
              setTimeout(p, m));
          } else
            ((e.status = "error"), u(e), a("Upload failed after 6 network retries.", "error"), t());
        };
        ((i.onerror = () => {
          G();
        }),
          (i.onload = () => {
            const o = K(i.responseText || "");
            if (
              (o &&
                typeof o == "object" &&
                M(!!o.captcha_required, !!o.captcha_enabled, o.captcha_site_key || ""),
              i.status >= 200 && i.status < 300)
            ) {
              if (
                ((n = 0),
                (l = (o == null ? void 0 : o.upload_id) || l),
                (e.uploadId = l),
                o != null && o.complete)
              ) {
                ((e.status = "done"), (e.progress = 100), u(e), f && M(!1, v, x), t());
                return;
              }
              const m = typeof (o == null ? void 0 : o.offset) == "number" ? o.offset : C;
              ((r = Math.max(r, m)),
                (e.progress = Math.max(e.progress, Math.floor((r / s) * 100))),
                u(e),
                p());
              return;
            }
            if (i.status === 502 || i.status === 503 || i.status === 504 || i.status === 0) {
              G();
              return;
            }
            if (i.status === 409 && typeof (o == null ? void 0 : o.offset) == "number" && b < 2) {
              ((b += 1), (r = o.offset), p());
              return;
            }
            (i.status === 401
              ? a((o == null ? void 0 : o.error) || "Password required or incorrect.", "error")
              : i.status === 403
                ? a((o == null ? void 0 : o.error) || "Verification required.", "error")
                : i.status === 410
                  ? a("This request link has expired.", "error")
                  : i.status === 429
                    ? a(
                        (o == null ? void 0 : o.error) || "Too many attempts. Try again later.",
                        "error"
                      )
                    : i.status === 400 || i.status === 413 || i.status === 415
                      ? a((o == null ? void 0 : o.error) || "Upload rejected.", "error")
                      : a(
                          (o == null ? void 0 : o.error) || "Upload failed (" + i.status + ").",
                          "error"
                        ),
              (e.status = "error"),
              u(e),
              t());
          }),
          i.send(ce));
      }
      p();
    });
  }
  function le() {
    if (L || !I.length) return;
    if (E && !g.value) {
      a("Password required to upload.", "error");
      return;
    }
    if (f && !c) {
      a("Verification required to upload.", "error");
      return;
    }
    ((L = !0), (w.disabled = !0), a("Uploading files...", ""));
    let e = Promise.resolve();
    (I.forEach((t) => {
      t.status !== "done" && (e = e.then(() => (t.file.size >= $ ? ae(t) : V(t))));
    }),
      e.then(() => {
        ((L = !1),
          I.filter((s) => s.status === "error").length
            ? a("Some files failed. Fix and click Upload again to retry.", "error")
            : a("All uploads complete. You can close this tab.", "success"),
          h());
      }));
  }
  function ue() {
    (d.addEventListener("click", () => {
      k && R.click();
    }),
      R.addEventListener("change", (e) => {
        const t = e.target;
        (J(t.files || []), (R.value = ""));
      }),
      d.addEventListener("dragover", (e) => {
        (e.preventDefault(), d.classList.add("drag"));
      }),
      d.addEventListener("dragleave", () => {
        d.classList.remove("drag");
      }),
      d.addEventListener("drop", (e) => {
        var t;
        (e.preventDefault(),
          d.classList.remove("drag"),
          (t = e.dataTransfer) != null && t.files && J(e.dataTransfer.files));
      }));
  }
  function de() {
    if (!k) {
      (a("Invalid request link.", "error"),
        (S.textContent = "This link is missing its request ID."),
        d.classList.add("disabled"));
      return;
    }
    fetch("/api/droppr/requests/" + encodeURIComponent(k))
      .then((e) =>
        e.text().then((t) => {
          let s = null;
          if (t)
            try {
              s = JSON.parse(t);
            } catch {
              s = null;
            }
          if (!e.ok) {
            const r = (s == null ? void 0 : s.error) || "Request unavailable";
            throw new Error(r);
          }
          return s || {};
        })
      )
      .then((e) => {
        ((E = !!e.requires_password),
          M(!!e.captcha_required, !!e.captcha_enabled, e.captcha_site_key || ""),
          (q = ee(e.allowed_extensions || [])),
          (T = e.max_file_size || 0),
          oe(),
          ne());
        const t = e.folder || "Uploads";
        ((S.textContent = "Uploads go directly to the folder: " + t + "."),
          E
            ? (Y.classList.add("show"), a("Password required to upload.", ""))
            : a("Ready to upload files.", ""),
          e.expires_in ? (A.textContent = y(e.expires_in)) : (A.textContent = "No expiration set."),
          h());
      })
      .catch((e) => {
        (a(e.message || String(e), "error"),
          (S.textContent = "This request link is not available."),
          (w.disabled = !0));
      });
  }
  (w.addEventListener("click", le), g.addEventListener("input", h), ue(), de());
})();
//# sourceMappingURL=request.js.map

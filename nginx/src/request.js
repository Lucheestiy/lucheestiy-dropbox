(function () {
      var hashMatch = String(window.location.pathname || "").match(/\/request\/([^/]+)/);
      var requestHash = hashMatch ? hashMatch[1] : "";

      var subtitleEl = document.getElementById("subtitle");
      var statusEl = document.getElementById("status");
      var expiresEl = document.getElementById("expires-note");
      var passwordBlock = document.getElementById("password-block");
      var passwordInput = document.getElementById("password-input");
      var dropzone = document.getElementById("dropzone");
      var fileInput = document.getElementById("file-input");
      var uploadBtn = document.getElementById("upload-btn");
      var fileList = document.getElementById("file-list");
      var captchaBlock = document.getElementById("captcha-block");
      var captchaWidget = document.getElementById("captcha-widget");
      var dropzoneHint = dropzone ? dropzone.querySelector(".hint") : null;

      var requiresPassword = false;
      var captchaEnabled = false;
      var captchaRequired = false;
      var captchaSiteKey = "";
      var captchaToken = "";
      var captchaRendered = false;
      var allowedExtensions = [];
      var maxFileSize = 0;
      var uploading = false;
      var queue = [];
      var counter = 0;
      var CHUNK_SIZE = 8 * 1024 * 1024;
      var CHUNK_THRESHOLD = 32 * 1024 * 1024;

      function setStatus(text, tone) {
        statusEl.textContent = text || "";
        statusEl.className = "status" + (tone ? (" " + tone) : "");
      }

      function formatBytes(bytes) {
        if (!bytes && bytes !== 0) return "";
        var sizes = ["B", "KB", "MB", "GB", "TB"];
        var i = 0;
        var value = bytes;
        while (value >= 1024 && i < sizes.length - 1) {
          value /= 1024;
          i += 1;
        }
        return value.toFixed(value >= 10 || i === 0 ? 0 : 1) + " " + sizes[i];
      }

      function formatExpires(seconds) {
        if (!seconds) return "";
        var hours = Math.ceil(seconds / 3600);
        if (hours < 24) return "Expires in " + hours + " hour" + (hours === 1 ? "" : "s");
        var days = Math.ceil(hours / 24);
        return "Expires in " + days + " day" + (days === 1 ? "" : "s");
      }

      function normalizeExtensions(list) {
        if (!list || !list.length) return [];
        return list
          .map(function (ext) { return String(ext || "").trim().replace(/^\./, "").toLowerCase(); })
          .filter(function (ext) { return ext; });
      }

      function getFileExtension(name) {
        var value = String(name || "");
        var idx = value.lastIndexOf(".");
        if (idx <= 0 || idx === value.length - 1) return "";
        return value.slice(idx + 1).toLowerCase();
      }

      function isExtensionAllowed(name) {
        if (!allowedExtensions.length) return true;
        var ext = getFileExtension(name);
        if (!ext) return false;
        return allowedExtensions.indexOf(ext) >= 0;
      }

      function sanitizeRelPath(value) {
        if (!value) return "";
        var cleaned = String(value || "").replace(/\\/g, "/");
        if (cleaned.charAt(0) === "/") return "";
        var parts = cleaned.split("/").filter(function (part) { return part; });
        if (!parts.length) return "";
        for (var i = 0; i < parts.length; i += 1) {
          var part = parts[i];
          if (part === "." || part === "..") return "";
          if (/[\x00-\x1f\x7f]/.test(part)) return "";
        }
        return parts.join("/");
      }

      function updateDropzoneHint() {
        if (!dropzoneHint) return;
        var base = "Multiple files supported. Keep the tab open until upload completes.";
        var extras = [];
        if (allowedExtensions.length) {
          extras.push("Allowed types: " + allowedExtensions.join(", ") + ".");
        }
        if (maxFileSize) {
          extras.push("Max size: " + formatBytes(maxFileSize) + ".");
        }
        dropzoneHint.textContent = extras.length ? (base + " " + extras.join(" ")) : base;
      }

      function updateFileInputAccept() {
        if (!fileInput) return;
        if (!allowedExtensions.length) {
          fileInput.removeAttribute("accept");
          return;
        }
        var accept = allowedExtensions.map(function (ext) { return "." + ext; }).join(",");
        fileInput.setAttribute("accept", accept);
      }

      function createRow(entry) {
        var li = document.createElement("li");
        li.className = "file-item";
        li.innerHTML =
          '<div class="file-row">' +
            '<div class="file-name"></div>' +
            '<div class="file-size"></div>' +
          '</div>' +
          '<div class="file-row">' +
            '<div class="file-status"></div>' +
            '<div class="file-progress"></div>' +
          '</div>' +
          '<div class="progress-bar"><span></span></div>';

        li.querySelector(".file-name").textContent = entry.name;
        li.querySelector(".file-size").textContent = formatBytes(entry.size);
        entry.el = li;
        updateRow(entry);
        return li;
      }

      function updateRow(entry) {
        if (!entry.el) return;
        var status = entry.status || "queued";
        var statusLabel = status === "uploading" ? "Uploading" : (status === "done" ? "Complete" : (status === "error" ? "Failed" : "Queued"));
        entry.el.querySelector(".file-status").textContent = statusLabel;
        entry.el.querySelector(".file-progress").textContent = status === "done" ? "100%" : (entry.progress || 0) + "%";
        entry.el.querySelector(".progress-bar span").style.width = (entry.progress || 0) + "%";
      }

      function updateButtonState() {
        if (!queue.length || uploading) {
          uploadBtn.disabled = true;
          return;
        }
        if (requiresPassword && !passwordInput.value) {
          uploadBtn.disabled = true;
          return;
        }
        if (captchaRequired && !captchaToken) {
          uploadBtn.disabled = true;
          return;
        }
        uploadBtn.disabled = false;
      }

      function setCaptchaState(required, enabled, siteKey) {
        captchaEnabled = !!enabled;
        if (siteKey) {
          captchaSiteKey = siteKey;
        }
        captchaRequired = !!required && captchaEnabled && !!captchaSiteKey;
        if (captchaRequired) {
          captchaBlock.classList.add("show");
          ensureCaptcha();
        } else {
          captchaBlock.classList.remove("show");
          captchaToken = "";
        }
        updateButtonState();
      }

      function ensureCaptcha() {
        if (!captchaEnabled || !captchaSiteKey || captchaRendered) return;
        if (window.turnstile && typeof window.turnstile.render === "function") {
          renderCaptcha();
          return;
        }
        if (document.getElementById("turnstile-script")) return;
        var script = document.createElement("script");
        script.id = "turnstile-script";
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
        script.async = true;
        script.defer = true;
        script.onload = renderCaptcha;
        document.head.appendChild(script);
      }

      function renderCaptcha() {
        if (!window.turnstile || !captchaWidget || !captchaSiteKey) return;
        captchaWidget.innerHTML = "";
        captchaRendered = true;
        window.turnstile.render(captchaWidget, {
          sitekey: captchaSiteKey,
          callback: function (token) {
            captchaToken = token || "";
            updateButtonState();
          },
          "expired-callback": function () {
            captchaToken = "";
            updateButtonState();
          },
          "error-callback": function () {
            captchaToken = "";
            updateButtonState();
          },
        });
      }

      function parseJson(text) {
        if (!text) return null;
        try {
          return JSON.parse(text);
        } catch (e) {
          return null;
        }
      }

      function addRejectedFile(file, reason) {
        counter += 1;
        var entry = {
          id: counter,
          file: null,
          name: file && file.name ? file.name : "Unknown file",
          size: file && typeof file.size === "number" ? file.size : 0,
          relPath: "",
          status: "error",
          progress: 0,
          el: null,
        };
        fileList.appendChild(createRow(entry));
        setStatus(reason || "File rejected.", "error");
      }

      function addFiles(list) {
        var files = Array.prototype.slice.call(list || []);
        if (!files.length) return;
        files.forEach(function (file) {
          var rel = sanitizeRelPath(file.webkitRelativePath || file.name);
          if (!rel) {
            addRejectedFile(file, "Invalid file path.");
            return;
          }
          if (maxFileSize && file.size > maxFileSize) {
            addRejectedFile(file, "File exceeds the maximum allowed size.");
            return;
          }
          if (!isExtensionAllowed(rel)) {
            addRejectedFile(file, "Unsupported file type.");
            return;
          }
          counter += 1;
          var entry = {
            id: counter,
            file: file,
            name: file.name,
            size: file.size,
            relPath: rel,
            status: "queued",
            progress: 0,
            el: null,
          };
          queue.push(entry);
          fileList.appendChild(createRow(entry));
        });
        setStatus("Ready to upload " + files.length + " file" + (files.length === 1 ? "" : "s") + ".", "");
        updateButtonState();
      }

      function uploadEntry(entry) {
        return new Promise(function (resolve) {
          entry.status = "uploading";
          entry.progress = 0;
          updateRow(entry);

          var xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/droppr/requests/" + encodeURIComponent(requestHash) + "/upload");
          xhr.timeout = 0;
          if (requiresPassword && passwordInput.value) {
            xhr.setRequestHeader("X-Request-Password", encodeURIComponent(passwordInput.value));
          }
          if (captchaRequired && captchaToken) {
            xhr.setRequestHeader("X-Captcha-Token", captchaToken);
          }

          xhr.upload.onprogress = function (event) {
            if (!event.lengthComputable) return;
            entry.progress = Math.max(1, Math.floor((event.loaded / event.total) * 100));
            updateRow(entry);
          };

          xhr.onerror = function () {
            entry.status = "error";
            updateRow(entry);
            setStatus("Upload failed. Please try again.", "error");
            resolve();
          };

          xhr.onload = function () {
            var data = parseJson(xhr.responseText || "");
            if (data && typeof data === "object") {
              setCaptchaState(!!data.captcha_required, !!data.captcha_enabled, data.captcha_site_key || "");
            }

            if (xhr.status >= 200 && xhr.status < 300) {
              entry.status = "done";
              entry.progress = 100;
              updateRow(entry);
              if (captchaRequired) {
                setCaptchaState(false, captchaEnabled, captchaSiteKey);
              }
              resolve();
              return;
            }

            if (xhr.status === 401) {
              setStatus((data && data.error) ? data.error : "Password required or incorrect.", "error");
            } else if (xhr.status === 403) {
              setStatus((data && data.error) ? data.error : "Verification required.", "error");
            } else if (xhr.status === 410) {
              setStatus("This request link has expired.", "error");
            } else if (xhr.status === 429) {
              setStatus((data && data.error) ? data.error : "Too many attempts. Try again later.", "error");
            } else if (xhr.status === 400 || xhr.status === 413 || xhr.status === 415) {
              setStatus((data && data.error) ? data.error : "Upload rejected.", "error");
            } else {
              setStatus((data && data.error) ? data.error : ("Upload failed (" + xhr.status + ")."), "error");
            }

            entry.status = "error";
            updateRow(entry);
            resolve();
          };

          var form = new FormData();
          form.append("file", entry.file, entry.file.name);
          if (entry.relPath && entry.relPath !== entry.file.name) {
            form.append("relative_path", entry.relPath);
          }
          xhr.send(form);
        });
      }

      function uploadEntryChunked(entry) {
        return new Promise(function (resolve) {
          entry.status = "uploading";
          entry.progress = 0;
          updateRow(entry);

          var total = entry.file.size;
          var offset = 0;
          var uploadId = entry.uploadId || "";
          var mismatchRetries = 0;

          function sendChunk() {
            if (offset >= total) {
              entry.status = "done";
              entry.progress = 100;
              updateRow(entry);
              resolve();
              return;
            }

            var end = Math.min(offset + CHUNK_SIZE, total);
            var blob = entry.file.slice(offset, end);
            var xhr = new XMLHttpRequest();
            xhr.open("POST", "/api/droppr/requests/" + encodeURIComponent(requestHash) + "/upload-chunk");
            xhr.timeout = 0;
            xhr.setRequestHeader("Content-Range", "bytes " + offset + "-" + (end - 1) + "/" + total);
            xhr.setRequestHeader("X-Upload-Offset", String(offset));
            xhr.setRequestHeader("X-Upload-Length", String(total));
            xhr.setRequestHeader("X-Upload-Path", entry.relPath || entry.file.name);
            xhr.setRequestHeader("Content-Type", entry.file.type || "application/octet-stream");
            if (uploadId) {
              xhr.setRequestHeader("X-Upload-Id", uploadId);
            }
            if (requiresPassword && passwordInput.value) {
              xhr.setRequestHeader("X-Request-Password", encodeURIComponent(passwordInput.value));
            }
            if (captchaRequired && captchaToken) {
              xhr.setRequestHeader("X-Captcha-Token", captchaToken);
            }

            xhr.upload.onprogress = function (event) {
              if (!event.lengthComputable) return;
              var pct = Math.floor(((offset + event.loaded) / total) * 100);
              entry.progress = Math.max(1, Math.min(99, pct));
              updateRow(entry);
            };

            xhr.onerror = function () {
              entry.status = "error";
              updateRow(entry);
              setStatus("Upload failed. Please try again.", "error");
              resolve();
            };

            xhr.onload = function () {
              var data = parseJson(xhr.responseText || "");
              if (data && typeof data === "object") {
                setCaptchaState(!!data.captcha_required, !!data.captcha_enabled, data.captcha_site_key || "");
              }

              if (xhr.status >= 200 && xhr.status < 300) {
                uploadId = (data && data.upload_id) ? data.upload_id : uploadId;
                entry.uploadId = uploadId;

                if (data && data.complete) {
                  entry.status = "done";
                  entry.progress = 100;
                  updateRow(entry);
                  if (captchaRequired) {
                    setCaptchaState(false, captchaEnabled, captchaSiteKey);
                  }
                  resolve();
                  return;
                }

                var nextOffset = (data && typeof data.offset === "number") ? data.offset : end;
                offset = Math.max(offset, nextOffset);
                entry.progress = Math.max(entry.progress, Math.floor((offset / total) * 100));
                updateRow(entry);
                sendChunk();
                return;
              }

              if (xhr.status === 409 && data && typeof data.offset === "number" && mismatchRetries < 2) {
                mismatchRetries += 1;
                offset = data.offset;
                sendChunk();
                return;
              }

              if (xhr.status === 401) {
                setStatus((data && data.error) ? data.error : "Password required or incorrect.", "error");
              } else if (xhr.status === 403) {
                setStatus((data && data.error) ? data.error : "Verification required.", "error");
              } else if (xhr.status === 410) {
                setStatus("This request link has expired.", "error");
              } else if (xhr.status === 429) {
                setStatus((data && data.error) ? data.error : "Too many attempts. Try again later.", "error");
              } else if (xhr.status === 400 || xhr.status === 413 || xhr.status === 415) {
                setStatus((data && data.error) ? data.error : "Upload rejected.", "error");
              } else {
                setStatus((data && data.error) ? data.error : ("Upload failed (" + xhr.status + ")."), "error");
              }

              entry.status = "error";
              updateRow(entry);
              resolve();
            };

            xhr.send(blob);
          }

          sendChunk();
        });
      }

      function uploadAll() {
        if (uploading || !queue.length) return;
        if (requiresPassword && !passwordInput.value) {
          setStatus("Password required to upload.", "error");
          return;
        }
        if (captchaRequired && !captchaToken) {
          setStatus("Verification required to upload.", "error");
          return;
        }
        uploading = true;
        uploadBtn.disabled = true;
        setStatus("Uploading files...", "");

        var chain = Promise.resolve();
        queue.forEach(function (entry) {
          if (entry.status === "done") return;
          chain = chain.then(function () {
            if (entry.file.size >= CHUNK_THRESHOLD) {
              return uploadEntryChunked(entry);
            }
            return uploadEntry(entry);
          });
        });

        chain.then(function () {
          uploading = false;
          var failures = queue.filter(function (entry) { return entry.status === "error"; });
          if (failures.length) {
            setStatus("Some files failed. Fix and click Upload again to retry.", "error");
          } else {
            setStatus("All uploads complete. You can close this tab.", "success");
          }
          updateButtonState();
        });
      }

      function initDropzone() {
        dropzone.addEventListener("click", function () {
          if (!requestHash) return;
          fileInput.click();
        });

        fileInput.addEventListener("change", function (event) {
          addFiles(event.target.files || []);
          fileInput.value = "";
        });

        dropzone.addEventListener("dragover", function (event) {
          event.preventDefault();
          dropzone.classList.add("drag");
        });

        dropzone.addEventListener("dragleave", function () {
          dropzone.classList.remove("drag");
        });

        dropzone.addEventListener("drop", function (event) {
          event.preventDefault();
          dropzone.classList.remove("drag");
          if (event.dataTransfer && event.dataTransfer.files) {
            addFiles(event.dataTransfer.files);
          }
        });
      }

      function loadRequest() {
        if (!requestHash) {
          setStatus("Invalid request link.", "error");
          subtitleEl.textContent = "This link is missing its request ID.";
          dropzone.classList.add("disabled");
          return;
        }

        fetch("/api/droppr/requests/" + encodeURIComponent(requestHash))
          .then(function (res) {
            return res.text().then(function (text) {
              var data = null;
              if (text) {
                try { data = JSON.parse(text); } catch (e) { data = null; }
              }
              if (!res.ok) {
                var msg = (data && data.error) ? data.error : "Request unavailable";
                throw new Error(msg);
              }
              return data || {};
            });
          })
          .then(function (data) {
            requiresPassword = !!data.requires_password;
            setCaptchaState(!!data.captcha_required, !!data.captcha_enabled, data.captcha_site_key || "");
            allowedExtensions = normalizeExtensions(data.allowed_extensions || []);
            maxFileSize = data.max_file_size || 0;
            updateDropzoneHint();
            updateFileInputAccept();
            var folder = data.folder || "Uploads";
            subtitleEl.textContent = "Uploads go directly to the folder: " + folder + ".";
            if (requiresPassword) {
              passwordBlock.classList.add("show");
              setStatus("Password required to upload.", "");
            } else {
              setStatus("Ready to upload files.", "");
            }
            if (data.expires_in) {
              expiresEl.textContent = formatExpires(data.expires_in);
            } else {
              expiresEl.textContent = "No expiration set.";
            }
            updateButtonState();
          })
          .catch(function (err) {
            setStatus(String(err && err.message ? err.message : err), "error");
            subtitleEl.textContent = "This request link is not available.";
            uploadBtn.disabled = true;
          });
      }

      uploadBtn.addEventListener("click", uploadAll);
      passwordInput.addEventListener("input", updateButtonState);

      initDropzone();
      loadRequest();
    })();

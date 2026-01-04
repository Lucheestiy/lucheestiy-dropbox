interface FileEntry {
  id: number;
  file: File | null;
  name: string;
  size: number;
  relPath: string;
  status: 'queued' | 'uploading' | 'done' | 'error';
  progress: number;
  el: HTMLElement | null;
  uploadId?: string;
}

interface RequestMetaResponse {
  requires_password?: boolean;
  captcha_required?: boolean;
  captcha_enabled?: boolean;
  captcha_site_key?: string;
  allowed_extensions?: string[];
  max_file_size?: number;
  folder?: string;
  expires_in?: number;
  error?: string;
}

interface UploadResponse {
  captcha_required?: boolean;
  captcha_enabled?: boolean;
  captcha_site_key?: string;
  upload_id?: string;
  offset?: number;
  complete?: boolean;
  error?: string;
}

(function (): void {
  const hashMatch = String(window.location.pathname || "").match(/\/request\/([^/]+)/);
  const requestHash = hashMatch ? hashMatch[1] : "";

  const subtitleEl = document.getElementById("subtitle") as HTMLElement;
  const statusEl = document.getElementById("status") as HTMLElement;
  const expiresEl = document.getElementById("expires-note") as HTMLElement;
  const passwordBlock = document.getElementById("password-block") as HTMLElement;
  const passwordInput = document.getElementById("password-input") as HTMLInputElement;
  const dropzone = document.getElementById("dropzone") as HTMLElement;
  const fileInput = document.getElementById("file-input") as HTMLInputElement;
  const uploadBtn = document.getElementById("upload-btn") as HTMLButtonElement;
  const fileList = document.getElementById("file-list") as HTMLElement;
  const captchaBlock = document.getElementById("captcha-block") as HTMLElement;
  const captchaWidget = document.getElementById("captcha-widget") as HTMLElement;
  const dropzoneHint = dropzone?.querySelector(".hint") as HTMLElement | null;

  let requiresPassword = false;
  let captchaEnabled = false;
  let captchaRequired = false;
  let captchaSiteKey = "";
  let captchaToken = "";
  let captchaRendered = false;
  let allowedExtensions: string[] = [];
  let maxFileSize = 0;
  let uploading = false;
  const queue: FileEntry[] = [];
  let counter = 0;
  const CHUNK_SIZE = 8 * 1024 * 1024;
  const CHUNK_THRESHOLD = 32 * 1024 * 1024;

  function setStatus(text: string, tone?: string): void {
    statusEl.textContent = text || "";
    statusEl.className = "status" + (tone ? (" " + tone) : "");
  }

  function formatBytes(bytes: number | null | undefined): string {
    if (!bytes && bytes !== 0) return "";
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let value = bytes;
    while (value >= 1024 && i < sizes.length - 1) {
      value /= 1024;
      i += 1;
    }
    return value.toFixed(value >= 10 || i === 0 ? 0 : 1) + " " + sizes[i];
  }

  function formatExpires(seconds: number | null | undefined): string {
    if (!seconds) return "";
    const hours = Math.ceil(seconds / 3600);
    if (hours < 24) return "Expires in " + hours + " hour" + (hours === 1 ? "" : "s");
    const days = Math.ceil(hours / 24);
    return "Expires in " + days + " day" + (days === 1 ? "" : "s");
  }

  function normalizeExtensions(list: string[] | null | undefined): string[] {
    if (!list || !list.length) return [];
    return list
      .map((ext: string) => String(ext || "").trim().replace(/^\./, "").toLowerCase())
      .filter((ext: string) => ext);
  }

  function getFileExtension(name: string): string {
    const value = String(name || "");
    const idx = value.lastIndexOf(".");
    if (idx <= 0 || idx === value.length - 1) return "";
    return value.slice(idx + 1).toLowerCase();
  }

  function isExtensionAllowed(name: string): boolean {
    if (!allowedExtensions.length) return true;
    const ext = getFileExtension(name);
    if (!ext) return false;
    return allowedExtensions.indexOf(ext) >= 0;
  }

  function sanitizeRelPath(value: string | null | undefined): string {
    if (!value) return "";
    let cleaned = String(value || "").replace(/\\/g, "/");
    if (cleaned.charAt(0) === "/") return "";
    const parts = cleaned.split("/").filter((part: string) => part);
    if (!parts.length) return "";
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      if (part === "." || part === "..") return "";
      if (/[\x00-\x1f\x7f]/.test(part)) return "";
    }
    return parts.join("/");
  }

  function updateDropzoneHint(): void {
    if (!dropzoneHint) return;
    const base = "Multiple files supported. Keep the tab open until upload completes.";
    const extras: string[] = [];
    if (allowedExtensions.length) {
      extras.push("Allowed types: " + allowedExtensions.join(", ") + ".");
    }
    if (maxFileSize) {
      extras.push("Max size: " + formatBytes(maxFileSize) + ".");
    }
    dropzoneHint.textContent = extras.length ? (base + " " + extras.join(" ")) : base;
  }

  function updateFileInputAccept(): void {
    if (!fileInput) return;
    if (!allowedExtensions.length) {
      fileInput.removeAttribute("accept");
      return;
    }
    const accept = allowedExtensions.map((ext: string) => "." + ext).join(",");
    fileInput.setAttribute("accept", accept);
  }

  function createRow(entry: FileEntry): HTMLElement {
    const li = document.createElement("li");
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

    (li.querySelector(".file-name") as HTMLElement).textContent = entry.name;
    (li.querySelector(".file-size") as HTMLElement).textContent = formatBytes(entry.size);
    entry.el = li;
    updateRow(entry);
    return li;
  }

  function updateRow(entry: FileEntry): void {
    if (!entry.el) return;
    const status = entry.status || "queued";
    const statusLabel = status === "uploading" ? "Uploading" : (status === "done" ? "Complete" : (status === "error" ? "Failed" : "Queued"));
    (entry.el.querySelector(".file-status") as HTMLElement).textContent = statusLabel;
    (entry.el.querySelector(".file-progress") as HTMLElement).textContent = status === "done" ? "100%" : (entry.progress || 0) + "%";
    (entry.el.querySelector(".progress-bar span") as HTMLElement).style.width = (entry.progress || 0) + "%";
  }

  function updateButtonState(): void {
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

  function setCaptchaState(required: boolean, enabled: boolean, siteKey: string): void {
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

  function ensureCaptcha(): void {
    if (!captchaEnabled || !captchaSiteKey || captchaRendered) return;
    if (window.turnstile && typeof window.turnstile.render === "function") {
      renderCaptcha();
      return;
    }
    if (document.getElementById("turnstile-script")) return;
    const script = document.createElement("script");
    script.id = "turnstile-script";
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.onload = renderCaptcha;
    document.head.appendChild(script);
  }

  function renderCaptcha(): void {
    if (!window.turnstile || !captchaWidget || !captchaSiteKey) return;
    captchaWidget.innerHTML = "";
    captchaRendered = true;
    window.turnstile.render(captchaWidget, {
      sitekey: captchaSiteKey,
      callback: (token: string) => {
        captchaToken = token || "";
        updateButtonState();
      },
      "expired-callback": () => {
        captchaToken = "";
        updateButtonState();
      },
      "error-callback": () => {
        captchaToken = "";
        updateButtonState();
      },
    });
  }

  function parseJson<T>(text: string): T | null {
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  function addRejectedFile(file: File | null, reason: string): void {
    counter += 1;
    const entry: FileEntry = {
      id: counter,
      file: null,
      name: file?.name || "Unknown file",
      size: file?.size || 0,
      relPath: "",
      status: "error",
      progress: 0,
      el: null,
    };
    fileList.appendChild(createRow(entry));
    setStatus(reason || "File rejected.", "error");
  }

  function addFiles(list: FileList | File[]): void {
    const files = Array.prototype.slice.call(list || []) as File[];
    if (!files.length) return;
    files.forEach((file: File) => {
      const rel = sanitizeRelPath((file as any).webkitRelativePath || file.name);
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
      const entry: FileEntry = {
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

  function uploadEntry(entry: FileEntry): Promise<void> {
    return new Promise((resolve) => {
      entry.status = "uploading";
      entry.progress = 0;
      updateRow(entry);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/droppr/requests/" + encodeURIComponent(requestHash) + "/upload");
      xhr.timeout = 0;
      if (requiresPassword && passwordInput.value) {
        xhr.setRequestHeader("X-Request-Password", encodeURIComponent(passwordInput.value));
      }
      if (captchaRequired && captchaToken) {
        xhr.setRequestHeader("X-Captcha-Token", captchaToken);
      }

      xhr.upload.onprogress = (event: ProgressEvent) => {
        if (!event.lengthComputable) return;
        entry.progress = Math.max(1, Math.floor((event.loaded / event.total) * 100));
        updateRow(entry);
      };

      xhr.onerror = () => {
        entry.status = "error";
        updateRow(entry);
        setStatus("Upload failed. Please try again.", "error");
        resolve();
      };

      xhr.onload = () => {
        const data = parseJson<UploadResponse>(xhr.responseText || "");
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
          setStatus(data?.error || "Password required or incorrect.", "error");
        } else if (xhr.status === 403) {
          setStatus(data?.error || "Verification required.", "error");
        } else if (xhr.status === 410) {
          setStatus("This request link has expired.", "error");
        } else if (xhr.status === 429) {
          setStatus(data?.error || "Too many attempts. Try again later.", "error");
        } else if (xhr.status === 400 || xhr.status === 413 || xhr.status === 415) {
          setStatus(data?.error || "Upload rejected.", "error");
        } else {
          setStatus(data?.error || ("Upload failed (" + xhr.status + ")."), "error");
        }

        entry.status = "error";
        updateRow(entry);
        resolve();
      };

      const form = new FormData();
      form.append("file", entry.file!, entry.file!.name);
      if (entry.relPath && entry.relPath !== entry.file!.name) {
        form.append("relative_path", entry.relPath);
      }
      xhr.send(form);
    });
  }

  function uploadEntryChunked(entry: FileEntry): Promise<void> {
    return new Promise((resolve) => {
      entry.status = "uploading";
      entry.progress = 0;
      updateRow(entry);

      const total = entry.file!.size;
      let offset = 0;
      let uploadId = entry.uploadId || "";
      let mismatchRetries = 0;

      function sendChunk(): void {
        if (offset >= total) {
          entry.status = "done";
          entry.progress = 100;
          updateRow(entry);
          resolve();
          return;
        }

        const end = Math.min(offset + CHUNK_SIZE, total);
        const blob = entry.file!.slice(offset, end);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/droppr/requests/" + encodeURIComponent(requestHash) + "/upload-chunk");
        xhr.timeout = 0;
        xhr.setRequestHeader("Content-Range", "bytes " + offset + "-" + (end - 1) + "/" + total);
        xhr.setRequestHeader("X-Upload-Offset", String(offset));
        xhr.setRequestHeader("X-Upload-Length", String(total));
        xhr.setRequestHeader("X-Upload-Path", entry.relPath || entry.file!.name);
        xhr.setRequestHeader("Content-Type", entry.file!.type || "application/octet-stream");
        if (uploadId) {
          xhr.setRequestHeader("X-Upload-Id", uploadId);
        }
        if (requiresPassword && passwordInput.value) {
          xhr.setRequestHeader("X-Request-Password", encodeURIComponent(passwordInput.value));
        }
        if (captchaRequired && captchaToken) {
          xhr.setRequestHeader("X-Captcha-Token", captchaToken);
        }

        xhr.upload.onprogress = (event: ProgressEvent) => {
          if (!event.lengthComputable) return;
          const pct = Math.floor(((offset + event.loaded) / total) * 100);
          entry.progress = Math.max(1, Math.min(99, pct));
          updateRow(entry);
        };

        xhr.onerror = () => {
          entry.status = "error";
          updateRow(entry);
          setStatus("Upload failed. Please try again.", "error");
          resolve();
        };

        xhr.onload = () => {
          const data = parseJson<UploadResponse>(xhr.responseText || "");
          if (data && typeof data === "object") {
            setCaptchaState(!!data.captcha_required, !!data.captcha_enabled, data.captcha_site_key || "");
          }

          if (xhr.status >= 200 && xhr.status < 300) {
            uploadId = data?.upload_id || uploadId;
            entry.uploadId = uploadId;

            if (data?.complete) {
              entry.status = "done";
              entry.progress = 100;
              updateRow(entry);
              if (captchaRequired) {
                setCaptchaState(false, captchaEnabled, captchaSiteKey);
              }
              resolve();
              return;
            }

            const nextOffset = typeof data?.offset === "number" ? data.offset : end;
            offset = Math.max(offset, nextOffset);
            entry.progress = Math.max(entry.progress, Math.floor((offset / total) * 100));
            updateRow(entry);
            sendChunk();
            return;
          }

          if (xhr.status === 409 && typeof data?.offset === "number" && mismatchRetries < 2) {
            mismatchRetries += 1;
            offset = data.offset;
            sendChunk();
            return;
          }

          if (xhr.status === 401) {
            setStatus(data?.error || "Password required or incorrect.", "error");
          } else if (xhr.status === 403) {
            setStatus(data?.error || "Verification required.", "error");
          } else if (xhr.status === 410) {
            setStatus("This request link has expired.", "error");
          } else if (xhr.status === 429) {
            setStatus(data?.error || "Too many attempts. Try again later.", "error");
          } else if (xhr.status === 400 || xhr.status === 413 || xhr.status === 415) {
            setStatus(data?.error || "Upload rejected.", "error");
          } else {
            setStatus(data?.error || ("Upload failed (" + xhr.status + ")."), "error");
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

  function uploadAll(): void {
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

    let chain = Promise.resolve();
    queue.forEach((entry: FileEntry) => {
      if (entry.status === "done") return;
      chain = chain.then(() => {
        if (entry.file!.size >= CHUNK_THRESHOLD) {
          return uploadEntryChunked(entry);
        }
        return uploadEntry(entry);
      });
    });

    chain.then(() => {
      uploading = false;
      const failures = queue.filter((entry: FileEntry) => entry.status === "error");
      if (failures.length) {
        setStatus("Some files failed. Fix and click Upload again to retry.", "error");
      } else {
        setStatus("All uploads complete. You can close this tab.", "success");
      }
      updateButtonState();
    });
  }

  function initDropzone(): void {
    dropzone.addEventListener("click", () => {
      if (!requestHash) return;
      fileInput.click();
    });

    fileInput.addEventListener("change", (event: Event) => {
      const target = event.target as HTMLInputElement;
      addFiles(target.files || []);
      fileInput.value = "";
    });

    dropzone.addEventListener("dragover", (event: DragEvent) => {
      event.preventDefault();
      dropzone.classList.add("drag");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("drag");
    });

    dropzone.addEventListener("drop", (event: DragEvent) => {
      event.preventDefault();
      dropzone.classList.remove("drag");
      if (event.dataTransfer?.files) {
        addFiles(event.dataTransfer.files);
      }
    });
  }

  function loadRequest(): void {
    if (!requestHash) {
      setStatus("Invalid request link.", "error");
      subtitleEl.textContent = "This link is missing its request ID.";
      dropzone.classList.add("disabled");
      return;
    }

    fetch("/api/droppr/requests/" + encodeURIComponent(requestHash))
      .then((res: Response) => {
        return res.text().then((text: string) => {
          let data: RequestMetaResponse | null = null;
          if (text) {
            try { data = JSON.parse(text); } catch { data = null; }
          }
          if (!res.ok) {
            const msg = data?.error || "Request unavailable";
            throw new Error(msg);
          }
          return data || {};
        });
      })
      .then((data: RequestMetaResponse) => {
        requiresPassword = !!data.requires_password;
        setCaptchaState(!!data.captcha_required, !!data.captcha_enabled, data.captcha_site_key || "");
        allowedExtensions = normalizeExtensions(data.allowed_extensions || []);
        maxFileSize = data.max_file_size || 0;
        updateDropzoneHint();
        updateFileInputAccept();
        const folder = data.folder || "Uploads";
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
      .catch((err: Error) => {
        setStatus(err.message || String(err), "error");
        subtitleEl.textContent = "This request link is not available.";
        uploadBtn.disabled = true;
      });
  }

  uploadBtn.addEventListener("click", uploadAll);
  passwordInput.addEventListener("input", updateButtonState);

  initDropzone();
  loadRequest();
})();

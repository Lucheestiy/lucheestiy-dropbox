(function() {
        'use strict';

        const CONFIG = {
            RESUME_THRESHOLD: 10,
            RESUME_MIN_DURATION: 30,
            CONTROLS_HIDE_DELAY: 3000,
            STORAGE_KEY: 'stream_gallery_progress'
        };
        const DROPPR_CONFIG = window.DROPPR_CONFIG || {};
        const PREVIEW_FORMAT = String(DROPPR_CONFIG.previewFormat || 'auto').trim().toLowerCase();
        const ASSET_BASE_URL = (typeof DROPPR_CONFIG.assetBaseUrl === 'string')
            ? DROPPR_CONFIG.assetBaseUrl.replace(/\/+$/, '')
            : '';
        const THUMB_DEFAULT_WIDTHS = [48, 96];
        const THUMB_WIDTHS = normalizeWidths(DROPPR_CONFIG.previewThumbWidths || THUMB_DEFAULT_WIDTHS);

        const VIDEO_EXTS = {
            '3g2': true,
            '3gp': true,
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
            wmv: true
        };

        const state = {
            shareHash: null,
            recursive: false,
            shareMeta: null,
            files: [],
            videoFiles: [],
            currentIndex: -1,
            isPlaying: false,
            isSeeking: false,
            isBuffering: false,
            controlsTimer: null,
            progressStorage: {},
            lastMouseMove: 0
        };

        const els = {
            video: document.getElementById('video'),
            playerWrapper: document.getElementById('playerWrapper'),
            controls: document.getElementById('controls'),
            sidebar: document.getElementById('sidebar'),
            fileList: document.getElementById('fileList'),
            fileCount: document.getElementById('fileCount'),
            shareInfo: document.getElementById('shareInfo'),
            recursiveToggle: document.getElementById('recursiveToggle'),
            videoTitle: document.getElementById('videoTitle'),
            downloadBtn: document.getElementById('downloadBtn'),
            galleryBtn: document.getElementById('galleryBtn'),
            playBtn: document.getElementById('playBtn'),
            playIcon: document.getElementById('playIcon'),
            prevBtn: document.getElementById('prevBtn'),
            nextBtn: document.getElementById('nextBtn'),
            skipBackBtn: document.getElementById('skipBackBtn'),
            skipForwardBtn: document.getElementById('skipForwardBtn'),
            muteBtn: document.getElementById('muteBtn'),
            volumeIcon: document.getElementById('volumeIcon'),
            volumeSlider: document.getElementById('volumeSlider'),
            speedBtn: document.getElementById('speedBtn'),
            speedMenu: document.getElementById('speedMenu'),
            fullscreenBtn: document.getElementById('fullscreenBtn'),
            progressContainer: document.getElementById('progressContainer'),
            progressFill: document.getElementById('progressFill'),
            progressBuffer: document.getElementById('progressBuffer'),
            progressHandle: document.getElementById('progressHandle'),
            progressTooltip: document.getElementById('progressTooltip'),
            bufferSegments: document.getElementById('bufferSegments'),
            timeDisplay: document.getElementById('timeDisplay'),
            statusIndicator: document.getElementById('statusIndicator'),
            statusText: document.getElementById('statusText'),
            errorOverlay: document.getElementById('errorOverlay'),
            errorTitle: document.getElementById('errorTitle'),
            errorMessage: document.getElementById('errorMessage'),
            emptyState: document.getElementById('emptyState'),
            emptyTitle: document.getElementById('emptyTitle'),
            emptyMessage: document.getElementById('emptyMessage'),
            emptyEnableSubfolders: document.getElementById('emptyEnableSubfolders'),
            sidebarToggle: document.getElementById('sidebarToggle'),
            sidebarBackdrop: document.getElementById('sidebarBackdrop')
        };

        function encodePath(p) {
            return String(p || '').split('/').map(s => encodeURIComponent(s)).join('/');
        }

        function normalizeWidths(list) {
            const values = Array.isArray(list) ? list : [];
            const normalized = values
                .map(value => Number(value))
                .filter(value => Number.isFinite(value) && value > 0);
            if (normalized.length === 0) return THUMB_DEFAULT_WIDTHS.slice();
            normalized.sort((a, b) => a - b);
            const unique = [];
            normalized.forEach(value => {
                if (unique[unique.length - 1] !== value) unique.push(value);
            });
            return unique;
        }

        function addResourceHint(href) {
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

        function setupResourceHints() {
            addResourceHint(ASSET_BASE_URL);
        }

        function parseBoolParam(value) {
            if (value == null) return null;
            const v = String(value).trim().toLowerCase();
            if (!v) return null;
            return v === '1' || v === 'true' || v === 'yes' || v === 'on';
        }

        function formatTime(seconds) {
            if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
            const s = Math.floor(seconds);
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            const sec = s % 60;
            if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
            return m + ':' + String(sec).padStart(2, '0');
        }

        function formatBytes(bytes) {
            if (!Number.isFinite(bytes) || bytes < 0) return '';
            const units = ['B', 'KB', 'MB', 'GB', 'TB'];
            let v = bytes, i = 0;
            while (v >= 1000 && i < units.length - 1) { v /= 1000; i++; }
            return v.toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
        }

        function normalizeExt(value) {
            let ext = String(value || '').trim();
            if (!ext) return '';
            if (ext.charAt(0) === '.') ext = ext.slice(1);
            return ext.toLowerCase();
        }

        function getFileExt(file) {
            if (!file) return '';
            const metaExt = normalizeExt(file.extension);
            if (metaExt) return metaExt;
            let name = String(file.path || file.name || '');
            name = name.split('?')[0].split('#')[0];
            const idx = name.lastIndexOf('.');
            if (idx < 0) return '';
            return normalizeExt(name.slice(idx + 1));
        }

        function isVideoEntry(file) {
            if (!file) return false;
            const t = String(file.type || '').toLowerCase();
            if (t === 'video') return true;
            const ext = getFileExt(file);
            return !!(ext && VIDEO_EXTS[ext]);
        }

        function loadProgressStorage() {
            try {
                const data = localStorage.getItem(CONFIG.STORAGE_KEY);
                state.progressStorage = data ? JSON.parse(data) : {};
            } catch { state.progressStorage = {}; }
        }

        function saveProgressStorage() {
            try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.progressStorage)); } catch {}
        }

        function getFilePath(file) {
            if (!file) return '';
            return String(file.path || file.name || '');
        }

        function getFileName(file) {
            if (!file) return '';
            return String(file.name || file.path || '');
        }

        function getVideoProgress(shareHash, fileKey) {
            return state.progressStorage[shareHash + ':' + fileKey] || null;
        }

        function setVideoProgress(shareHash, fileKey, currentTime, duration) {
            const key = shareHash + ':' + fileKey;
            if (duration && currentTime >= duration - CONFIG.RESUME_THRESHOLD) {
                delete state.progressStorage[key];
            } else if (currentTime > 5) {
                state.progressStorage[key] = { time: currentTime, duration: duration, updated: Date.now() };
            }
            saveProgressStorage();
        }

        function clearVideoProgress(shareHash, fileKey) {
            delete state.progressStorage[shareHash + ':' + fileKey];
            saveProgressStorage();
        }

        async function fetchFiles(shareHash, recursive) {
            try {
                const flag = recursive ? '1' : '0';
                const resp = await fetch('/api/share/' + shareHash + '/files?recursive=' + flag);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                return await resp.json();
            } catch (err) {
                console.error('Failed to fetch files:', err);
                return null;
            }
        }

        function extractFilesFromResponse(data) {
            if (Array.isArray(data)) return data;
            if (data && Array.isArray(data.files)) return data.files;
            if (data && Array.isArray(data.items)) return data.items;
            return null;
        }

        async function fetchShareMeta(shareHash) {
            try {
                const resp = await fetch('/api/public/share/' + shareHash);
                if (!resp.ok) throw new Error('HTTP ' + resp.status);
                const data = await resp.json();
                return data && typeof data === 'object' ? data : null;
            } catch (err) {
                console.warn('Failed to fetch share meta:', err);
                return null;
            }
        }

        async function updateEmptyStateHint() {
            if (!els.emptyTitle || !els.emptyMessage) return;
            if (state.files && state.files.length > 0) {
                els.emptyTitle.textContent = 'No Videos Found';
                els.emptyMessage.textContent = 'This share has files, but none look like videos. Use Gallery for images.';
                if (els.emptyEnableSubfolders) els.emptyEnableSubfolders.style.display = 'none';
                return;
            }

            const meta = state.shareMeta || (await fetchShareMeta(state.shareHash));
            if (meta && !state.shareMeta) state.shareMeta = meta;

            const numDirs = meta && Number.isFinite(Number(meta.numDirs)) ? Number(meta.numDirs) : 0;
            const hasDirs = numDirs > 0;

            if (hasDirs && !state.recursive) {
                els.emptyTitle.textContent = 'No Videos Found';
                els.emptyMessage.textContent = 'This folder only has subfolders. Enable Subfolders to include them.';
                if (els.emptyEnableSubfolders) els.emptyEnableSubfolders.style.display = '';
            } else {
                els.emptyTitle.textContent = 'No Videos Found';
                els.emptyMessage.textContent = 'This share does not contain any video files.';
                if (els.emptyEnableSubfolders) els.emptyEnableSubfolders.style.display = 'none';
            }
        }

        function getVideoUrl(shareHash, filePath) {
            return '/api/share/' + shareHash + '/file/' + encodePath(filePath) + '?inline=true';
        }

        function getDownloadUrl(shareHash, filePath) {
            return '/api/share/' + shareHash + '/file/' + encodePath(filePath) + '?download=1';
        }

        function getThumbnailUrl(shareHash, filePath, width) {
            let url = '/api/share/' + shareHash + '/preview/' + encodePath(filePath);
            const params = [];
            if (width) params.push('w=' + width);
            if (PREVIEW_FORMAT) params.push('format=' + encodeURIComponent(PREVIEW_FORMAT));
            if (params.length) url += '?' + params.join('&');
            return url;
        }

        function showStatus(text, isLoading) {
            els.statusText.textContent = text;
            els.statusIndicator.classList.add('show');
            if (!isLoading) {
                setTimeout(function() { els.statusIndicator.classList.remove('show'); }, 1500);
            }
        }

        function hideStatus() { els.statusIndicator.classList.remove('show'); }

        function showError(title, message) {
            els.errorTitle.textContent = title;
            els.errorMessage.textContent = message;
            els.errorOverlay.classList.add('show');
        }

        function hideError() { els.errorOverlay.classList.remove('show'); }

        function updatePlayButton() {
            els.playIcon.innerHTML = state.isPlaying ? '&#10074;&#10074;' : '&#9658;';
        }

        function updateVolumeIcon() {
            const vol = els.video.volume;
            const muted = els.video.muted;
            if (muted || vol === 0) els.volumeIcon.innerHTML = '&#128263;';
            else if (vol < 0.5) els.volumeIcon.innerHTML = '&#128265;';
            else els.volumeIcon.innerHTML = '&#128266;';
        }

        function updateTimeDisplay() {
            const current = els.video.currentTime || 0;
            const duration = els.video.duration || 0;
            els.timeDisplay.textContent = formatTime(current) + ' / ' + formatTime(duration);
        }

        function updateProgress() {
            const current = els.video.currentTime || 0;
            const duration = els.video.duration || 0;
            const percent = duration > 0 ? (current / duration) * 100 : 0;
            els.progressFill.style.width = percent + '%';
            els.progressHandle.style.left = percent + '%';
        }

        function updateBufferSegments() {
            const duration = els.video.duration;
            if (!duration || !Number.isFinite(duration)) {
                els.bufferSegments.innerHTML = '';
                els.progressBuffer.style.width = '0%';
                return;
            }
            const buffered = els.video.buffered;
            let segments = [];
            let maxEnd = 0;
            for (let i = 0; i < buffered.length; i++) {
                const start = buffered.start(i);
                const end = buffered.end(i);
                const startPercent = (start / duration) * 100;
                const widthPercent = ((end - start) / duration) * 100;
                segments.push('<div class="buffer-segment" style="left:' + startPercent + '%;width:' + widthPercent + '%"></div>');
                if (end > maxEnd) maxEnd = end;
            }
            els.bufferSegments.innerHTML = segments.join('');
            els.progressBuffer.style.width = (maxEnd / duration) * 100 + '%';
        }

        function showControls() {
            els.playerWrapper.classList.remove('hide-controls');
            clearTimeout(state.controlsTimer);
            if (state.isPlaying) {
                state.controlsTimer = setTimeout(function() {
                    els.playerWrapper.classList.add('hide-controls');
                }, CONFIG.CONTROLS_HIDE_DELAY);
            }
        }

        function renderFileList() {
            els.fileList.innerHTML = '';
            state.videoFiles.forEach(function(file, index) {
                const item = document.createElement('div');
                item.className = 'file-item';
                if (index === state.currentIndex) item.classList.add('active');
                const filePath = getFilePath(file);
                const fileName = getFileName(file);
                const progress = getVideoProgress(state.shareHash, filePath);
                const thumbWidths = THUMB_WIDTHS.length ? THUMB_WIDTHS : THUMB_DEFAULT_WIDTHS;
                const thumbSrc = getThumbnailUrl(state.shareHash, filePath, thumbWidths[0]);
                const thumbSrcSet = thumbWidths.map(function(width) {
                    return getThumbnailUrl(state.shareHash, filePath, width) + ' ' + width + 'w';
                }).join(', ');
                const thumbSrcSetAttr = thumbSrcSet ? ' srcset="' + thumbSrcSet + '" sizes="48px"' : '';
                item.innerHTML = '<div class="file-thumb"><img src="' + thumbSrc + '"' + thumbSrcSetAttr + ' alt="" loading="lazy" onerror="this.parentElement.innerHTML=\'&#128249;\'"></div>' +
                    '<div class="file-info"><div class="file-name">' + fileName + '</div>' +
                    '<div class="file-meta"><span>' + formatBytes(file.size) + '</span>' +
                    (progress ? '<span class="resume-badge">' + formatTime(progress.time) + '</span>' : '') +
                    '</div></div>';
                item.onclick = function() { loadVideo(index); };
                els.fileList.appendChild(item);
            });
            els.fileCount.textContent = state.videoFiles.length + ' video' + (state.videoFiles.length !== 1 ? 's' : '');
        }

        function updateRecursiveToggle() {
            if (!els.recursiveToggle) return;
            const label = state.recursive ? 'Subfolders: On' : 'Subfolders: Off';
            els.recursiveToggle.textContent = label;
            els.recursiveToggle.setAttribute('aria-pressed', state.recursive ? 'true' : 'false');
            els.recursiveToggle.classList.toggle('active', state.recursive);
            if (els.galleryBtn && state.shareHash) {
                var galleryUrl = '/gallery/' + state.shareHash;
                if (state.recursive) galleryUrl += '?recursive=1';
                els.galleryBtn.href = galleryUrl;
            }
        }

        function updateActiveFileItem() {
            var items = els.fileList.querySelectorAll('.file-item');
            items.forEach(function(item, i) {
                item.classList.toggle('active', i === state.currentIndex);
            });
            var activeItem = els.fileList.querySelector('.file-item.active');
            if (activeItem) activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        function loadVideo(index) {
            if (index < 0 || index >= state.videoFiles.length) return;
            if (state.currentIndex >= 0 && state.currentIndex < state.videoFiles.length) {
                var currentFile = state.videoFiles[state.currentIndex];
                setVideoProgress(state.shareHash, getFilePath(currentFile), els.video.currentTime, els.video.duration);
            }
            state.currentIndex = index;
            var file = state.videoFiles[index];
            var filePath = getFilePath(file);
            var fileName = getFileName(file);
            hideError();
            showStatus('Loading video...', true);
            els.videoTitle.textContent = fileName;
            els.downloadBtn.href = file.download_url || getDownloadUrl(state.shareHash, filePath);
            updateActiveFileItem();
            els.sidebar.classList.remove('show');
            els.sidebarBackdrop.classList.remove('show');
            var videoUrl = file.inline_url || getVideoUrl(state.shareHash, filePath);
            els.video.src = videoUrl;
            els.video.load();
            var progress = getVideoProgress(state.shareHash, filePath);
            if (progress && progress.time > 5) {
                els.video.addEventListener('loadedmetadata', function onMeta() {
                    els.video.removeEventListener('loadedmetadata', onMeta);
                    if (progress.time < els.video.duration - CONFIG.RESUME_THRESHOLD) {
                        els.video.currentTime = progress.time;
                        showStatus('Resuming from ' + formatTime(progress.time), false);
                    }
                }, { once: true });
            }
        }

        async function reloadFiles(options) {
            var keepCurrent = options && options.keepCurrent;
            var fileParam = options && options.fileParam;
            var currentPath = null;

            if (state.currentIndex >= 0 && state.currentIndex < state.videoFiles.length) {
                var currentFile = state.videoFiles[state.currentIndex];
                setVideoProgress(state.shareHash, getFilePath(currentFile), els.video.currentTime, els.video.duration);
                if (keepCurrent) currentPath = getFilePath(currentFile);
            }

            showStatus('Loading files...', true);
            var data = await fetchFiles(state.shareHash, state.recursive);
            var files = extractFilesFromResponse(data);
            if (!files) {
                hideStatus();
                showError('Failed to load files', 'Could not retrieve the file list from the server.');
                return false;
            }

            state.files = files || [];
            state.videoFiles = state.files.filter(function(f) { return isVideoEntry(f); });

            if (state.videoFiles.length === 0) {
                hideStatus();
                els.emptyState.style.display = 'flex';
                els.video.style.display = 'none';
                els.controls.style.display = 'none';
                els.fileList.innerHTML = '';
                els.fileCount.textContent = '0 videos';
                els.videoTitle.textContent = 'Select a video';
                els.downloadBtn.removeAttribute('href');
                state.currentIndex = -1;
                state.isPlaying = false;
                try { els.video.pause(); } catch (e) { /* ignore */ }
                els.video.removeAttribute('src');
                els.video.load();
                await updateEmptyStateHint();
                return false;
            }

            els.emptyState.style.display = 'none';
            els.video.style.display = '';
            els.controls.style.display = '';
            hideError();

            var idx = -1;
            if (fileParam) {
                idx = state.videoFiles.findIndex(function(f) { return f.name === fileParam || f.path === fileParam; });
            }
            if (idx < 0 && currentPath) {
                idx = state.videoFiles.findIndex(function(f) { return getFilePath(f) === currentPath; });
            }
            if (idx < 0) idx = 0;

            state.currentIndex = -1;
            renderFileList();
            loadVideo(idx);
            return true;
        }

        function playNext() {
            if (state.currentIndex < state.videoFiles.length - 1) loadVideo(state.currentIndex + 1);
        }

        function playPrev() {
            if (state.currentIndex > 0) loadVideo(state.currentIndex - 1);
        }

        function setupVideoEvents() {
            var video = els.video;
            video.addEventListener('loadedmetadata', function() {
                updateTimeDisplay();
                updateProgress();
                hideStatus();
            });
            video.addEventListener('canplay', function() {
                hideStatus();
                state.isBuffering = false;
            });
            video.addEventListener('play', function() {
                state.isPlaying = true;
                updatePlayButton();
                showControls();
            });
            video.addEventListener('pause', function() {
                state.isPlaying = false;
                updatePlayButton();
                showControls();
                if (state.currentIndex >= 0) {
                    var file = state.videoFiles[state.currentIndex];
                    setVideoProgress(state.shareHash, getFilePath(file), video.currentTime, video.duration);
                }
            });
            video.addEventListener('timeupdate', function() {
                updateTimeDisplay();
                updateProgress();
                if (Math.floor(video.currentTime) % 10 === 0 && state.currentIndex >= 0) {
                    var file = state.videoFiles[state.currentIndex];
                    setVideoProgress(state.shareHash, getFilePath(file), video.currentTime, video.duration);
                }
            });
            video.addEventListener('progress', updateBufferSegments);
            video.addEventListener('waiting', function() {
                state.isBuffering = true;
                showStatus('Buffering...', true);
            });
            video.addEventListener('seeking', function() {
                state.isSeeking = true;
                showStatus('Seeking...', true);
            });
            video.addEventListener('seeked', function() {
                state.isSeeking = false;
                hideStatus();
            });
            video.addEventListener('ended', function() {
                state.isPlaying = false;
                updatePlayButton();
                if (state.currentIndex >= 0) {
                    var file = state.videoFiles[state.currentIndex];
                    clearVideoProgress(state.shareHash, getFilePath(file));
                }
                playNext();
            });
            video.addEventListener('volumechange', function() {
                els.volumeSlider.value = video.muted ? 0 : video.volume;
                updateVolumeIcon();
            });
            video.addEventListener('error', function() {
                hideStatus();
                showError('Could not load video', 'The video file may be corrupted or in an unsupported format.');
            });
        }

        function setupControlEvents() {
            els.playBtn.onclick = function() {
                if (els.video.paused) els.video.play();
                else els.video.pause();
            };
            els.video.onclick = function() {
                if (els.video.paused) els.video.play();
                else els.video.pause();
            };
            els.prevBtn.onclick = playPrev;
            els.nextBtn.onclick = playNext;
            els.skipBackBtn.onclick = function() {
                els.video.currentTime = Math.max(0, els.video.currentTime - 10);
            };
            els.skipForwardBtn.onclick = function() {
                els.video.currentTime = Math.min(els.video.duration, els.video.currentTime + 10);
            };
            els.muteBtn.onclick = function() { els.video.muted = !els.video.muted; };
            els.volumeSlider.oninput = function() {
                els.video.volume = parseFloat(els.volumeSlider.value);
                els.video.muted = false;
            };
            els.speedBtn.onclick = function() { els.speedMenu.classList.toggle('show'); };
            document.querySelectorAll('.speed-option').forEach(function(btn) {
                btn.onclick = function() {
                    var speed = parseFloat(btn.dataset.speed);
                    els.video.playbackRate = speed;
                    els.speedBtn.textContent = speed + 'x';
                    document.querySelectorAll('.speed-option').forEach(function(b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    els.speedMenu.classList.remove('show');
                };
            });
            document.addEventListener('click', function(e) {
                if (!els.speedBtn.contains(e.target) && !els.speedMenu.contains(e.target)) {
                    els.speedMenu.classList.remove('show');
                }
            });
            els.fullscreenBtn.onclick = function() {
                if (document.fullscreenElement) document.exitFullscreen();
                else els.playerWrapper.requestFullscreen();
            };

            var isDragging = false;
            function seekToPosition(e) {
                var rect = els.progressContainer.getBoundingClientRect();
                return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            }
            function updateTooltip(e) {
                var percent = seekToPosition(e);
                var time = percent * (els.video.duration || 0);
                els.progressTooltip.textContent = formatTime(time);
                els.progressTooltip.style.left = (percent * 100) + '%';
            }
            els.progressContainer.addEventListener('mousemove', updateTooltip);
            els.progressContainer.addEventListener('mousedown', function(e) {
                isDragging = true;
                var percent = seekToPosition(e);
                els.video.currentTime = percent * els.video.duration;
            });
            document.addEventListener('mousemove', function(e) {
                if (isDragging) {
                    var percent = seekToPosition(e);
                    els.video.currentTime = percent * els.video.duration;
                }
            });
            document.addEventListener('mouseup', function() { isDragging = false; });
            els.progressContainer.addEventListener('touchstart', function(e) {
                isDragging = true;
                var touch = e.touches[0];
                var rect = els.progressContainer.getBoundingClientRect();
                var percent = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
                els.video.currentTime = percent * els.video.duration;
            });
            els.progressContainer.addEventListener('touchmove', function(e) {
                if (isDragging) {
                    var touch = e.touches[0];
                    var rect = els.progressContainer.getBoundingClientRect();
                    var percent = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
                    els.video.currentTime = percent * els.video.duration;
                }
            });
            els.progressContainer.addEventListener('touchend', function() { isDragging = false; });
            els.playerWrapper.addEventListener('mousemove', showControls);
            els.playerWrapper.addEventListener('mouseleave', function() {
                if (state.isPlaying) {
                    state.controlsTimer = setTimeout(function() {
                        els.playerWrapper.classList.add('hide-controls');
                    }, CONFIG.CONTROLS_HIDE_DELAY);
                }
            });
            els.sidebarToggle.onclick = function() {
                els.sidebar.classList.toggle('show');
                els.sidebarBackdrop.classList.toggle('show');
            };
            els.sidebarBackdrop.onclick = function() {
                els.sidebar.classList.remove('show');
                els.sidebarBackdrop.classList.remove('show');
            };
        }

        function setupKeyboardShortcuts() {
            document.addEventListener('keydown', function(e) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                switch (e.key) {
                    case ' ':
                    case 'k':
                        e.preventDefault();
                        if (els.video.paused) els.video.play();
                        else els.video.pause();
                        break;
                    case 'ArrowLeft':
                        e.preventDefault();
                        els.video.currentTime -= e.shiftKey ? 30 : 10;
                        break;
                    case 'ArrowRight':
                        e.preventDefault();
                        els.video.currentTime += e.shiftKey ? 30 : 10;
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        els.video.volume = Math.min(1, els.video.volume + 0.1);
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        els.video.volume = Math.max(0, els.video.volume - 0.1);
                        break;
                    case 'm': els.video.muted = !els.video.muted; break;
                    case 'f':
                        if (document.fullscreenElement) document.exitFullscreen();
                        else els.playerWrapper.requestFullscreen();
                        break;
                    case 'n':
                    case 'N': playNext(); break;
                    case 'p':
                    case 'P': playPrev(); break;
                    case 'Home':
                        e.preventDefault();
                        els.video.currentTime = 0;
                        break;
                    case 'End':
                        e.preventDefault();
                        els.video.currentTime = els.video.duration;
                        break;
                    case '0': case '1': case '2': case '3': case '4':
                    case '5': case '6': case '7': case '8': case '9':
                        e.preventDefault();
                        els.video.currentTime = (parseInt(e.key) / 10) * els.video.duration;
                        break;
                }
            });
        }

        function getShareHashFromLocation() {
            var params = new URLSearchParams(window.location.search);
            var share = params.get('share') || '';
            if (share && /^[A-Za-z0-9_-]{1,64}$/.test(share)) return share;

            var path = String(window.location.pathname || '');
            var m = path.match(/^\/stream\/([A-Za-z0-9_-]{1,64})\/?$/);
            if (m && m[1]) return m[1];
            return '';
        }

        async function init() {
            var params = new URLSearchParams(window.location.search);
            state.shareHash = getShareHashFromLocation();
            if (!state.shareHash || !/^[A-Za-z0-9_-]{1,64}$/.test(state.shareHash)) {
                showError('Invalid share link', 'The share hash is missing or invalid.');
                return;
            }
            setupResourceHints();
            loadProgressStorage();
            els.galleryBtn.href = '/gallery/' + state.shareHash;
            els.shareInfo.textContent = state.shareHash;

            var recursiveParam = parseBoolParam(params.get('recursive'));
            state.recursive = recursiveParam === null ? false : recursiveParam;
            updateRecursiveToggle();
            if (els.recursiveToggle) {
                els.recursiveToggle.onclick = function() {
                    state.recursive = !state.recursive;
                    updateRecursiveToggle();
                    reloadFiles({ keepCurrent: true });
                };
            }
            if (els.emptyEnableSubfolders) {
                els.emptyEnableSubfolders.onclick = function() {
                    state.recursive = true;
                    updateRecursiveToggle();
                    reloadFiles({ keepCurrent: false });
                };
            }

            setupVideoEvents();
            setupControlEvents();
            setupKeyboardShortcuts();

            await reloadFiles({ fileParam: params.get('file') });
        }

        init();
    })();

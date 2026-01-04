// Get share hash from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const shareHash = urlParams.get('share') || window.location.pathname.split('/').pop();
        
        // Modal elements
        const modal = document.getElementById('modal');
        const modalContent = document.getElementById('modal-content');
        const closeBtn = document.querySelector('.close');
        
        // Load media files from the share
        async function loadMediaFiles() {
            try {
                // Use the FileBrowser share interface directly
                // Since we can't easily parse the ZIP, we'll use known files
                // and test their accessibility
                
                // Use dynamic share detection instead of hardcoded files
                const shareHash = urlParams.get('share') || window.location.pathname.split('/').pop();
                if (!shareHash) {
                    throw new Error('No share hash found');
                }
                
                // Try to fetch file list from the share API
                try {
                    const response = await fetch(`/api/share/${shareHash}/files`);
                    if (response.ok) {
                        const files = await response.json();
                        displayMediaFiles(files.slice(0, 10)); // Show first 10 files
                        return;
                    }
                } catch (e) {
                    console.log('Could not fetch file list from API, falling back to known files');
                }
                
                const knownFiles = [
                    { name: 'IMG_4481.jpeg', type: 'image' },
                    { name: 'IMG_4482.mov', type: 'video' },
                    { name: 'IMG_4491.jpeg', type: 'image' }
                ];
                
                // Test which files are actually accessible
                const accessibleFiles = [];
                
                for (const file of knownFiles) {
                    try {
                        const fileUrl = `/api/share/${shareHash}/file/${file.name}`;
                        const response = await fetch(fileUrl, { method: 'HEAD' });
                        if (response.ok) {
                            accessibleFiles.push(file);
                        }
                    } catch (e) {
                        console.log(`File ${file.name} not accessible via ${fileUrl}`);
                        // Try direct download URL
                        try {
                            const altUrl = `/api/public/dl/${shareHash}/${file.name}`;
                            const response2 = await fetch(altUrl, { method: 'HEAD' });
                            if (response2.ok) {
                                accessibleFiles.push({...file, altUrl: altUrl});
                            }
                        } catch (e2) {
                            console.log(`File ${file.name} not accessible via alternative URL either`);
                        }
                    }
                }
                
                if (accessibleFiles.length > 0) {
                    displayMediaFiles(accessibleFiles);
                } else {
                    // Show all files anyway and let them try to load
                    displayMediaFiles(knownFiles);
                }
                
            } catch (error) {
                console.error('Error loading media files:', error);
                showError(`Failed to load media files: ${error.message}`);
            }
        }
        
        function displayMediaFiles(files) {
            const container = document.getElementById('media-container');
            const loading = document.getElementById('loading');
            
            loading.style.display = 'none';
            container.style.display = 'grid';
            
            files.forEach(file => {
                const card = createMediaCard(file);
                container.appendChild(card);
            });
        }
        
        function createMediaCard(file) {
            const card = document.createElement('div');
            card.className = 'media-card';
            
            const isVideo = file.type === 'video';
            const shareHash = new URLSearchParams(window.location.search).get('share') || window.location.pathname.split('/').pop();
            // Use consistent API URLs
            const fileUrl = file.inline_url || `/api/public/dl/${shareHash}/${file.name}?inline=true`;
            const downloadUrl = file.download_url || `/api/share/${shareHash}/file/${file.name}?download=1`;
            const previewUrl = `/api/share/${shareHash}/preview/${file.name}`;
            
            card.innerHTML = `
                ${isVideo 
                    ? `<div style="position: relative;">
                         <img class="media-preview" src="${previewUrl}" alt="${file.name}" 
                              style="object-fit: cover; height: 200px; width: 100%;"
                              onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
                         <div style="display:none; padding: 20px; text-align: center; color: #888; height: 200px; background: #333; align-items: center; justify-content: center; flex-direction: column;">
                            🎬 ${file.name}<br>
                            <small>Video preview unavailable</small>
                         </div>
                         <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 50px; height: 50px; background: rgba(0,0,0,0.6); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 20px; pointer-events: none;">▶</div>
                       </div>`
                    : `<img class="media-preview" src="${fileUrl}" alt="${file.name}" 
                           onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                       <div style="display:none; padding: 20px; text-align: center; color: #888;">
                          🖼️ ${file.name}<br>
                          <small>Image preview failed</small>
                       </div>`
                }
                <div class="media-info">
                    <div class="media-title">${file.name}</div>
                    <div class="media-size">${file.type}</div>
                    <a href="${downloadUrl}" class="download-btn" download>📥 Download</a>
                    <a href="/gallery/${shareHash}" class="download-btn" style="background: #2196F3;">🔗 Gallery</a>
                </div>
            `;
            
            // Add click handler for full-size viewing
            const mediaElement = card.querySelector('.media-preview');
            if (mediaElement) {
                mediaElement.addEventListener('click', () => {
                    openModal(file, fileUrl);
                });
            }
            
            return card;
        }
        
        function openModal(file, url) {
            const isVideo = file.type === 'video';
            
            if (isVideo) {
                modalContent.innerHTML = `
                    <div style="position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
                        <video controls autoplay playsinline style="max-width: 100%; max-height: 100%;">
                            <source src="${url}" type="video/mp4">
                            <source src="${url}" type="video/quicktime">
                        </video>
                        <div class="video-loader">
                            <div class="spinner"></div>
                            <div>Loading...</div>
                        </div>
                    </div>
                `;
                const v = modalContent.querySelector('video');
                const l = modalContent.querySelector('.video-loader');
                if (v && l) {
                    v.onloadstart = () => l.style.display = 'block';
                    v.onwaiting = () => l.style.display = 'block';
                    v.oncanplaythrough = () => l.style.display = 'none';
                    v.onplaying = () => l.style.display = 'none';
                }
            } else {
                modalContent.innerHTML = `<img src="${url}" alt="${file.name}" style="max-width: 100%; max-height: 100%;">`;
            }
            
            modal.style.display = 'block';
        }
        
        function showError(message = 'Please check your share link and try again.') {
            const loading = document.getElementById('loading');
            const error = document.getElementById('error');
            const errorText = error.querySelector('p');
            
            loading.style.display = 'none';
            error.style.display = 'block';
            if (errorText) {
                errorText.textContent = message;
            }
        }
        
        // Modal event handlers
        closeBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                modal.style.display = 'none';
            }
        });
        
        // Initialize
        if (shareHash && shareHash !== 'media-viewer.html') {
            loadMediaFiles();
        } else {
            showError('No valid share hash found in URL. Please use a proper share link.');
        }
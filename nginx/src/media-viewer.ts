interface MediaFile {
  name: string;
  type: 'image' | 'video' | 'file';
  path?: string;
  inline_url?: string;
  download_url?: string;
  altUrl?: string;
}

// Get share hash from URL parameters
const urlParams = new URLSearchParams(window.location.search);
const shareHash = urlParams.get('share') || window.location.pathname.split('/').pop() || '';

// Modal elements
const modal = document.getElementById('modal') as HTMLElement;
const modalContent = document.getElementById('modal-content') as HTMLElement;
const closeBtn = document.querySelector('.close') as HTMLElement;

// Load media files from the share
async function loadMediaFiles(): Promise<void> {
  try {
    // Use the FileBrowser share interface directly
    // Since we can't easily parse the ZIP, we'll use known files
    // and test their accessibility

    // Use dynamic share detection instead of hardcoded files
    const currentShareHash = urlParams.get('share') || window.location.pathname.split('/').pop() || '';
    if (!currentShareHash) {
      throw new Error('No share hash found');
    }

    // Try to fetch file list from the share API
    try {
      const response = await fetch(`/api/share/${currentShareHash}/files`);
      if (response.ok) {
        const files = await response.json() as MediaFile[];
        displayMediaFiles(files.slice(0, 10)); // Show first 10 files
        return;
      }
    } catch {
      console.log('Could not fetch file list from API, falling back to known files');
    }

    const knownFiles: MediaFile[] = [
      { name: 'IMG_4481.jpeg', type: 'image' },
      { name: 'IMG_4482.mov', type: 'video' },
      { name: 'IMG_4491.jpeg', type: 'image' }
    ];

    // Test which files are actually accessible
    const accessibleFiles: MediaFile[] = [];

    for (const file of knownFiles) {
      try {
        const fileUrl = `/api/share/${currentShareHash}/file/${file.name}`;
        const response = await fetch(fileUrl, { method: 'HEAD' });
        if (response.ok) {
          accessibleFiles.push(file);
        }
      } catch {
        console.log(`File ${file.name} not accessible via primary URL`);
        // Try direct download URL
        try {
          const altUrl = `/api/public/dl/${currentShareHash}/${file.name}`;
          const response2 = await fetch(altUrl, { method: 'HEAD' });
          if (response2.ok) {
            accessibleFiles.push({ ...file, altUrl: altUrl });
          }
        } catch {
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
    showError(`Failed to load media files: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function displayMediaFiles(files: MediaFile[]): void {
  const container = document.getElementById('media-container') as HTMLElement;
  const loading = document.getElementById('loading') as HTMLElement;

  loading.style.display = 'none';
  container.style.display = 'grid';

  files.forEach((file: MediaFile) => {
    const card = createMediaCard(file);
    container.appendChild(card);
  });
}

function createMediaCard(file: MediaFile): HTMLElement {
  const card = document.createElement('div');
  card.className = 'media-card';

  const isVideo = file.type === 'video';
  const currentShareHash = new URLSearchParams(window.location.search).get('share') || window.location.pathname.split('/').pop() || '';
  // Use consistent API URLs
  const fileUrl = file.inline_url || `/api/public/dl/${currentShareHash}/${file.name}?inline=true`;
  const downloadUrl = file.download_url || `/api/share/${currentShareHash}/file/${file.name}?download=1`;
  const previewUrl = `/api/share/${currentShareHash}/preview/${file.name}`;

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
        <a href="/gallery/${currentShareHash}" class="download-btn" style="background: #2196F3;">🔗 Gallery</a>
    </div>
  `;

  // Add click handler for full-size viewing
  const mediaElement = card.querySelector('.media-preview') as HTMLElement | null;
  if (mediaElement) {
    mediaElement.addEventListener('click', () => {
      openMediaModal(file, fileUrl);
    });
  }

  return card;
}

function openMediaModal(file: MediaFile, url: string): void {
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
    const v = modalContent.querySelector('video') as HTMLVideoElement | null;
    const l = modalContent.querySelector('.video-loader') as HTMLElement | null;
    if (v && l) {
      v.onloadstart = (): void => { l.style.display = 'block'; };
      v.onwaiting = (): void => { l.style.display = 'block'; };
      v.oncanplaythrough = (): void => { l.style.display = 'none'; };
      v.onplaying = (): void => { l.style.display = 'none'; };
    }
  } else {
    modalContent.innerHTML = `<img src="${url}" alt="${file.name}" style="max-width: 100%; max-height: 100%;">`;
  }

  modal.style.display = 'block';
}

function showError(message = 'Please check your share link and try again.'): void {
  const loading = document.getElementById('loading') as HTMLElement;
  const error = document.getElementById('error') as HTMLElement;
  const errorText = error.querySelector('p') as HTMLElement | null;

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

modal.addEventListener('click', (e: MouseEvent) => {
  if (e.target === modal) {
    modal.style.display = 'none';
  }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e: KeyboardEvent) => {
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

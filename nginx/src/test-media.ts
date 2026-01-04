// Add video loading behavior
document.querySelectorAll('video').forEach((video: HTMLVideoElement) => {
  const parent = video.parentElement;
  const loader = parent?.querySelector('.video-loader') as HTMLElement | null;
  if (loader) {
    video.onloadstart = (): void => { loader.style.display = 'block'; };
    video.onwaiting = (): void => { loader.style.display = 'block'; };
    video.oncanplaythrough = (): void => { loader.style.display = 'none'; };
    video.onplaying = (): void => { loader.style.display = 'none'; };
    video.onerror = (): void => {
      loader.style.display = 'none';
      console.error('Video failed to load:', video.src);
    };
  }
});

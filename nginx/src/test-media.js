// Add video loading behavior
        document.querySelectorAll('video').forEach(video => {
            const loader = video.parentElement.querySelector('.video-loader');
            if (loader) {
                video.onloadstart = () => loader.style.display = 'block';
                video.onwaiting = () => loader.style.display = 'block';
                video.oncanplaythrough = () => loader.style.display = 'none';
                video.onplaying = () => loader.style.display = 'none';
                video.onerror = () => {
                    loader.style.display = 'none';
                    console.error('Video failed to load:', video.src);
                };
            }
        });
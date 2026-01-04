(function (): void {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err: Error) => {
      console.warn('Service worker registration failed:', err);
    });
  });
})();

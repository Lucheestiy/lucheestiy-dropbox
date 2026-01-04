(function () {
  "serviceWorker" in navigator &&
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((r) => {
        console.warn("Service worker registration failed:", r);
      });
    });
})();
//# sourceMappingURL=sw-register.js.map

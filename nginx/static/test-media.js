document.querySelectorAll("video").forEach((l) => {
  const e = l.parentElement,
    o = e == null ? void 0 : e.querySelector(".video-loader");
  o &&
    ((l.onloadstart = () => {
      o.style.display = "block";
    }),
    (l.onwaiting = () => {
      o.style.display = "block";
    }),
    (l.oncanplaythrough = () => {
      o.style.display = "none";
    }),
    (l.onplaying = () => {
      o.style.display = "none";
    }),
    (l.onerror = () => {
      ((o.style.display = "none"), console.error("Video failed to load:", l.src));
    }));
});
//# sourceMappingURL=test-media.js.map

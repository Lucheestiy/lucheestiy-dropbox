import { defineConfig } from "vite";
import { resolve } from "node:path";

const rootDir = resolve(__dirname, "src");

export default defineConfig({
  root: rootDir,
  publicDir: false,
  build: {
    outDir: resolve(__dirname, "static"),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: {
        analytics: resolve(rootDir, "analytics.js"),
        config: resolve(rootDir, "config.js"),
        "gallery.min": resolve(rootDir, "gallery.js"),
        "media-viewer": resolve(rootDir, "media-viewer.js"),
        request: resolve(rootDir, "request.js"),
        "sentry-init": resolve(rootDir, "sentry-init.js"),
        "stream-gallery": resolve(rootDir, "stream-gallery.js"),
        "sw-register": resolve(rootDir, "sw-register.js"),
        sw: resolve(rootDir, "sw.js"),
        "test-media": resolve(rootDir, "test-media.js"),
        "video-player.min": resolve(rootDir, "video-player.js"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});

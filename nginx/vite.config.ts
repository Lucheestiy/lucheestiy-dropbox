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
        analytics: resolve(rootDir, "analytics.ts"),
        config: resolve(rootDir, "config.ts"),
        "gallery.min": resolve(rootDir, "gallery.ts"),
        "media-viewer": resolve(rootDir, "media-viewer.ts"),
        request: resolve(rootDir, "request.ts"),
        "sentry-init": resolve(rootDir, "sentry-init.ts"),
        "stream-gallery": resolve(rootDir, "stream-gallery.ts"),
        "sw-register": resolve(rootDir, "sw-register.ts"),
        sw: resolve(rootDir, "sw.ts"),
        "test-media": resolve(rootDir, "test-media.ts"),
        "video-player.min": resolve(rootDir, "video-player.ts"),
        "droppr-panel": resolve(rootDir, "droppr-panel.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});

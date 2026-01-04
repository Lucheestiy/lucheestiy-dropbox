import { describe, it, expect, vi, beforeEach } from "vitest";
import { VideoListHydrator } from "../../../src/components/Panel/VideoListHydrator";
import { videoMetaService } from "../../../src/services/video-meta";

vi.mock("../../../src/services/video-meta", () => ({
  videoMetaService: {
    fetch: vi.fn(() => Promise.resolve({ status: "ready" })),
    getCached: vi.fn(),
    isInFlight: vi.fn(() => false),
    debugStats: { ok: 0, notFound: 0, unauth: 0, other: 0 },
  },
}));

vi.mock("../../../src/utils/debug", () => ({
  isDropprDebugEnabled: vi.fn(() => false),
}));

describe("VideoListHydrator", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();

    // Setup a mock file list
    document.body.innerHTML = `
      <div id="listing" class="list">
        <div class="row list-item">
          <div class="icon-wrap"><i class="material-icons">movie</i></div>
          <div class="name">video.mp4</div>
          <a href="/files/video.mp4">link</a>
        </div>
        <div class="row list-item">
          <div class="icon-wrap"><i class="material-icons">image</i></div>
          <div class="name">image.jpg</div>
          <a href="/files/image.jpg">link</a>
        </div>
      </div>
    `;

    window.history.pushState({}, "Test", "/files/");
  });

  async function flush() {
    // Run all pending microtasks and timers
    await Promise.resolve();
    await Promise.resolve();
  }

  it("should initialize and add styles", () => {
    new VideoListHydrator();
    expect(document.getElementById("droppr-video-meta-style")).toBeTruthy();
  });

  it("should detect video files and call videoMetaService", async () => {
    vi.useFakeTimers();
    new VideoListHydrator();

    vi.advanceTimersByTime(300);
    await flush();

    expect(videoMetaService.fetch).toHaveBeenCalledWith("/video.mp4");
    vi.useRealTimers();
  });

  it("should render metadata details", async () => {
    vi.useFakeTimers();
    vi.mocked(videoMetaService.fetch).mockResolvedValue({
      status: "ready",
      processed_size: 10 * 1024 * 1024,
      uploaded_at: 1600000000,
    });

    new VideoListHydrator();
    vi.advanceTimersByTime(300);

    await flush();
    await flush();

    const details = document.querySelector(".droppr-video-meta-inline");
    expect(details).toBeTruthy();
    expect(details?.textContent).toContain("Size: 10.0 MB");
    expect(details?.textContent).toContain("Status: ready");
    vi.useRealTimers();
  });

  it("should apply thumbnail to video items", async () => {
    vi.useFakeTimers();
    new VideoListHydrator();
    vi.advanceTimersByTime(300);
    await flush();

    const img = document.querySelector(".droppr-video-thumb") as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.src).toContain("/api/share/__files__/preview/video.mp4");

    // In VideoListHydrator.ts, iconEl.style.display = "none" is called.
    // iconEl is row.querySelector(".material-icons, .icon, i")
    const icon = document.querySelector(".material-icons") as HTMLElement;
    expect(icon.style.display).toBe("none");
    vi.useRealTimers();
  });
});

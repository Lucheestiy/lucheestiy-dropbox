/**
 * Web Vitals Tracking
 *
 * Tracks Core Web Vitals metrics (LCP, FID, CLS, FCP, TTFB) and reports them
 * to analytics endpoints for performance monitoring.
 */

export interface WebVitalsMetric {
  name: "CLS" | "FID" | "LCP" | "FCP" | "TTFB" | "INP";
  value: number;
  rating: "good" | "needs-improvement" | "poor";
  delta: number;
  id: string;
  navigationType: string;
}

// Thresholds based on web.dev recommendations
const THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 },
  FID: { good: 100, poor: 300 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
  INP: { good: 200, poor: 500 },
};

/**
 * Gets the rating for a metric value
 */
function getRating(name: WebVitalsMetric["name"], value: number): WebVitalsMetric["rating"] {
  const threshold = THRESHOLDS[name];
  if (value <= threshold.good) return "good";
  if (value <= threshold.poor) return "needs-improvement";
  return "poor";
}

/**
 * Reports a metric to the analytics endpoint
 */
function reportMetric(metric: WebVitalsMetric): void {
  // Send to analytics API
  const endpoint = "/api/analytics/events";
  const body = JSON.stringify({
    event_type: "web_vital",
    event_data: {
      metric_name: metric.name,
      value: metric.value,
      rating: metric.rating,
      page: window.location.pathname,
      id: metric.id,
    },
  });

  // Use sendBeacon if available (better for page unload)
  if (navigator.sendBeacon) {
    navigator.sendBeacon(endpoint, body);
  } else {
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Silently fail - we don't want to interrupt the user experience
    });
  }

  // Also log to console in development
  if (process.env.NODE_ENV === "development") {
    console.log(`[Web Vitals] ${metric.name}:`, {
      value: metric.value,
      rating: metric.rating,
    });
  }
}

/**
 * Tracks Largest Contentful Paint (LCP)
 */
function trackLCP(): void {
  if (!("PerformanceObserver" in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1] as PerformancePaintTiming;

      const metric: WebVitalsMetric = {
        name: "LCP",
        value: lastEntry.renderTime || lastEntry.loadTime,
        rating: getRating("LCP", lastEntry.renderTime || lastEntry.loadTime),
        delta: lastEntry.renderTime || lastEntry.loadTime,
        id: crypto.randomUUID(),
        navigationType:
          (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)?.type ||
          "navigate",
      };

      reportMetric(metric);
    });

    observer.observe({ type: "largest-contentful-paint", buffered: true });
  } catch (err) {
    // Browser doesn't support this metric
  }
}

/**
 * Tracks First Input Delay (FID)
 */
function trackFID(): void {
  if (!("PerformanceObserver" in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const firstInput = entries[0] as PerformanceEventTiming;

      const metric: WebVitalsMetric = {
        name: "FID",
        value: firstInput.processingStart - firstInput.startTime,
        rating: getRating("FID", firstInput.processingStart - firstInput.startTime),
        delta: firstInput.processingStart - firstInput.startTime,
        id: crypto.randomUUID(),
        navigationType:
          (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)?.type ||
          "navigate",
      };

      reportMetric(metric);
      observer.disconnect();
    });

    observer.observe({ type: "first-input", buffered: true });
  } catch (err) {
    // Browser doesn't support this metric
  }
}

/**
 * Tracks Cumulative Layout Shift (CLS)
 */
function trackCLS(): void {
  if (!("PerformanceObserver" in window)) return;

  try {
    let clsValue = 0;
    const clsEntries: PerformanceEntry[] = [];

    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry as any).hadRecentInput) {
          clsValue += (entry as any).value;
          clsEntries.push(entry);
        }
      }
    });

    observer.observe({ type: "layout-shift", buffered: true });

    // Report CLS when page is hidden or unloaded
    const reportCLS = () => {
      if (clsEntries.length === 0) return;

      const metric: WebVitalsMetric = {
        name: "CLS",
        value: clsValue,
        rating: getRating("CLS", clsValue),
        delta: clsValue,
        id: crypto.randomUUID(),
        navigationType:
          (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)?.type ||
          "navigate",
      };

      reportMetric(metric);
      observer.disconnect();
    };

    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        reportCLS();
      }
    });
    addEventListener("pagehide", reportCLS);
  } catch (err) {
    // Browser doesn't support this metric
  }
}

/**
 * Tracks First Contentful Paint (FCP)
 */
function trackFCP(): void {
  if (!("PerformanceObserver" in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const fcpEntry = entries.find((entry) => entry.name === "first-contentful-paint");

      if (fcpEntry) {
        const metric: WebVitalsMetric = {
          name: "FCP",
          value: fcpEntry.startTime,
          rating: getRating("FCP", fcpEntry.startTime),
          delta: fcpEntry.startTime,
          id: crypto.randomUUID(),
          navigationType:
            (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)?.type ||
            "navigate",
        };

        reportMetric(metric);
        observer.disconnect();
      }
    });

    observer.observe({ type: "paint", buffered: true });
  } catch (err) {
    // Browser doesn't support this metric
  }
}

/**
 * Tracks Time to First Byte (TTFB)
 */
function trackTTFB(): void {
  try {
    const navigationEntry = performance.getEntriesByType(
      "navigation"
    )[0] as PerformanceNavigationTiming;

    if (navigationEntry) {
      const ttfb = navigationEntry.responseStart - navigationEntry.requestStart;

      const metric: WebVitalsMetric = {
        name: "TTFB",
        value: ttfb,
        rating: getRating("TTFB", ttfb),
        delta: ttfb,
        id: crypto.randomUUID(),
        navigationType: navigationEntry.type || "navigate",
      };

      reportMetric(metric);
    }
  } catch (err) {
    // Browser doesn't support this metric
  }
}

/**
 * Initializes Web Vitals tracking
 */
export function initWebVitals(): void {
  // Only track in production
  if (process.env.NODE_ENV === "development") {
    console.log("[Web Vitals] Tracking enabled (development mode)");
  }

  // Wait for page to be interactive
  if (document.readyState === "complete") {
    startTracking();
  } else {
    addEventListener("load", startTracking);
  }
}

function startTracking(): void {
  trackLCP();
  trackFID();
  trackCLS();
  trackFCP();
  trackTTFB();
}

/**
 * Gets a performance summary
 */
export function getPerformanceSummary(): Record<string, any> {
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
  const paint = performance.getEntriesByType("paint");

  return {
    dns: nav ? nav.domainLookupEnd - nav.domainLookupStart : 0,
    tcp: nav ? nav.connectEnd - nav.connectStart : 0,
    request: nav ? nav.responseStart - nav.requestStart : 0,
    response: nav ? nav.responseEnd - nav.responseStart : 0,
    dom: nav ? nav.domContentLoadedEventEnd - nav.domContentLoadedEventStart : 0,
    load: nav ? nav.loadEventEnd - nav.loadEventStart : 0,
    fcp: paint.find((p) => p.name === "first-contentful-paint")?.startTime || 0,
    total: nav ? nav.loadEventEnd - nav.fetchStart : 0,
  };
}

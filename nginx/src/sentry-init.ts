(function (): void {
  "use strict";
  if (!window.Sentry) return;
  const cfg = window.DROPPR_CONFIG || {};
  if (!cfg.sentryDsn) return;

  window.Sentry.init({
    dsn: cfg.sentryDsn,
    environment: cfg.sentryEnv || "production",
    release: cfg.sentryRelease || undefined,
    tracesSampleRate: Number(cfg.sentryTracesSampleRate || 0),
  });
})();

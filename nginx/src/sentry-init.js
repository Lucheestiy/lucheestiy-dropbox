(function () {
  "use strict";
  if (!window.Sentry) return;
  var cfg = window.DROPPR_CONFIG || {};
  if (!cfg.sentryDsn) return;

  window.Sentry.init({
    dsn: cfg.sentryDsn,
    environment: cfg.sentryEnv || "production",
    release: cfg.sentryRelease || undefined,
    tracesSampleRate: Number(cfg.sentryTracesSampleRate || 0)
  });
})();

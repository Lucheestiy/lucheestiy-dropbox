(function(){if(!window.Sentry)return;const e=window.DROPPR_CONFIG||{};e.sentryDsn&&window.Sentry.init({dsn:e.sentryDsn,environment:e.sentryEnv||"production",release:e.sentryRelease||void 0,tracesSampleRate:Number(e.sentryTracesSampleRate||0)})})();
//# sourceMappingURL=sentry-init.js.map

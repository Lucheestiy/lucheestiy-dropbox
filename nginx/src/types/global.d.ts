// Global type declarations for Droppr frontend

declare global {
  interface Window {
    DROPPR_CONFIG: DropprConfig;
    Sentry?: SentrySDK;
    Hls?: HlsConstructor;
    turnstile?: TurnstileAPI;
    // Gallery modal/media functions - set by gallery.ts
    openModal?: ((index: number) => void) | undefined;
    openMedia?: ((index: number, evt?: MouseEvent) => void) | undefined;
  }

  interface DropprConfig {
    sentryDsn?: string;
    sentryEnv?: string;
    sentryRelease?: string;
    sentryTracesSampleRate?: number;
    assetBaseUrl?: string;
    previewFormat?: string;
    previewWidths?: number[];
    previewSizes?: string;
    previewThumbWidths?: number[];
  }

  interface SentrySDK {
    init(options: {
      dsn: string;
      environment?: string;
      release?: string;
      tracesSampleRate?: number;
    }): void;
  }

  interface HlsConstructor {
    new (config?: HlsConfig): HlsInstance;
    isSupported(): boolean;
    Events: {
      MEDIA_ATTACHED: string;
      MANIFEST_PARSED: string;
      ERROR: string;
    };
  }

  interface HlsConfig {
    maxBufferLength?: number;
    backBufferLength?: number;
  }

  interface HlsInstance {
    attachMedia(video: HTMLVideoElement): void;
    loadSource(url: string): void;
    on(event: string, callback: (event: string, data?: HlsErrorData) => void): void;
    destroy(): void;
  }

  interface HlsErrorData {
    fatal?: boolean;
    type?: string;
    details?: string;
  }

  interface TurnstileAPI {
    render(element: HTMLElement, options: TurnstileOptions): string;
    reset(widgetId: string): void;
  }

  interface TurnstileOptions {
    sitekey: string;
    callback?: (token: string) => void;
    "expired-callback"?: () => void;
    "error-callback"?: () => void;
  }

  // Service Worker types
  interface ServiceWorkerGlobalScope {
    skipWaiting(): Promise<void>;
    clients: Clients;
  }
}

export {};

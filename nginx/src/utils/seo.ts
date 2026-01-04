/**
 * SEO and Social Sharing Utilities
 *
 * Provides helper functions for dynamically updating Open Graph, Twitter Cards,
 * and other meta tags for improved social sharing and SEO.
 */

export interface MetaTagsConfig {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  type?: "website" | "article" | "video.other" | "image";
  siteName?: string;
  twitterCard?: "summary" | "summary_large_image" | "player";
  twitterSite?: string;
}

const DEFAULT_CONFIG: Required<MetaTagsConfig> = {
  title: "Droppr - Secure File Sharing",
  description:
    "Share files securely with password protection, expiration dates, and download limits.",
  image: "/static/og-image.png",
  url: window.location.href,
  type: "website",
  siteName: "Droppr",
  twitterCard: "summary_large_image",
  twitterSite: "@droppr",
};

/**
 * Updates or creates a meta tag with the given property and content
 */
function setMetaTag(property: string, content: string, useProperty = true): void {
  const attribute = useProperty ? "property" : "name";
  let meta = document.querySelector(`meta[${attribute}="${property}"]`) as HTMLMetaElement;

  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute(attribute, property);
    document.head.appendChild(meta);
  }

  meta.content = content;
}

/**
 * Updates all SEO and social meta tags
 */
export function updateMetaTags(config: MetaTagsConfig): void {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Update page title
  if (cfg.title) {
    document.title = cfg.title;
  }

  // Standard meta tags
  setMetaTag("description", cfg.description, false);

  // Open Graph tags
  setMetaTag("og:title", cfg.title);
  setMetaTag("og:description", cfg.description);
  setMetaTag("og:image", new URL(cfg.image, window.location.origin).href);
  setMetaTag("og:url", cfg.url);
  setMetaTag("og:type", cfg.type);
  setMetaTag("og:site_name", cfg.siteName);

  // Twitter Card tags
  setMetaTag("twitter:card", cfg.twitterCard, false);
  setMetaTag("twitter:title", cfg.title, false);
  setMetaTag("twitter:description", cfg.description, false);
  setMetaTag("twitter:image", new URL(cfg.image, window.location.origin).href, false);

  if (cfg.twitterSite) {
    setMetaTag("twitter:site", cfg.twitterSite, false);
  }
}

/**
 * Updates meta tags for a shared gallery page
 */
export function updateGalleryMetaTags(shareHash: string, fileCount: number): void {
  const shareImage = `${window.location.origin}/og/share/${shareHash}.png`;

  updateMetaTags({
    title: `Shared Media Gallery (${fileCount} files) - Droppr`,
    description: `View ${fileCount} shared file${fileCount !== 1 ? "s" : ""} on Droppr. Secure file sharing with expiration and download limits.`,
    image: shareImage,
    url: `${window.location.origin}/gallery.html#${shareHash}`,
    type: "website",
  });
}

/**
 * Updates meta tags for a file request page
 */
export function updateRequestMetaTags(): void {
  updateMetaTags({
    title: "Upload Files - Droppr",
    description:
      "Upload your files securely to Droppr. Files are encrypted and can be password protected.",
    url: window.location.href,
    type: "website",
  });
}

/**
 * Updates meta tags for a video player page
 */
export function updateVideoMetaTags(filename: string, thumbnailUrl?: string): void {
  updateMetaTags({
    title: `${filename} - Droppr`,
    description: `Watch ${filename} on Droppr. Secure video sharing with adaptive streaming.`,
    image: thumbnailUrl || "/static/og-image.png",
    url: window.location.href,
    type: "video.other",
    twitterCard: "player",
  });
}

/**
 * Generates a canonical URL link tag
 */
export function setCanonicalUrl(url?: string): void {
  const canonicalUrl = url || window.location.href.split("#")[0].split("?")[0];

  let link = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;

  if (!link) {
    link = document.createElement("link");
    link.rel = "canonical";
    document.head.appendChild(link);
  }

  link.href = canonicalUrl;
}

/**
 * Adds structured data (JSON-LD) for better SEO
 */
export function addStructuredData(data: Record<string, any>): void {
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

/**
 * Adds WebApplication structured data
 */
export function addWebApplicationStructuredData(): void {
  addStructuredData({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Droppr",
    description:
      "Secure file sharing with password protection, expiration dates, and download limits",
    url: window.location.origin,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
  });
}

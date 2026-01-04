# SEO and Social Sharing Guide

This document describes the SEO (Search Engine Optimization) and social sharing features implemented in Droppr.

## Overview

Droppr includes comprehensive SEO features to improve discoverability and social sharing:
- Dynamic Open Graph meta tags
- Twitter Card support
- Schema.org structured data
- XML sitemap generation
- Enhanced robots.txt
- Core Web Vitals tracking

## Features

### 1. Open Graph Meta Tags

Open Graph meta tags enable rich social sharing on platforms like Facebook, LinkedIn, and Slack.

**Location:** `nginx/src/utils/seo.ts`

**Usage:**

```typescript
import { updateMetaTags, updateGalleryMetaTags } from './utils/seo';

// Update meta tags for a gallery page
updateGalleryMetaTags(shareHash, fileCount);

// Custom meta tags
updateMetaTags({
  title: 'My Custom Page Title',
  description: 'A detailed description of the page',
  image: '/path/to/image.png',
  url: window.location.href,
  type: 'website'
});
```

**Supported Pages:**
- Gallery pages: Dynamic title with file count and share hash
- Video player: Includes thumbnail as preview image
- File request pages: Upload-focused description
- Custom pages: Full control over all meta tags

**Meta Tags Generated:**
- `og:title` - Page title
- `og:description` - Page description
- `og:image` - Preview image (full URL)
- `og:url` - Canonical URL
- `og:type` - Content type (website, video.other, etc.)
- `og:site_name` - Site name (Droppr)
- **Share preview images**
  - Endpoint: `/og/share/<share_hash>.png`
  - Optimized 1200x630 preview with share name, hash, download stats, and last-updated timestamp.
  - Automatically used by `updateGalleryMetaTags` so every share has a matching OG image.
  - Responds with WebP when the client prefers it and falls back to optimized PNG otherwise (supports `Accept: image/webp` or `?format=webp`).

### 2. Twitter Cards

Twitter Cards enhance how links appear when shared on Twitter/X.

**Supported Card Types:**
- `summary` - Default card with small image
- `summary_large_image` - Card with large featured image
- `player` - Video player card for video content

**Meta Tags Generated:**
- `twitter:card` - Card type
- `twitter:title` - Tweet title
- `twitter:description` - Tweet description
- `twitter:image` - Preview image
- `twitter:site` - Twitter handle (optional)

### 3. Structured Data (Schema.org)

Structured data helps search engines understand the content and purpose of the application.

**Usage:**

```typescript
import { addWebApplicationStructuredData } from './utils/seo';

// Add WebApplication schema on page load
addWebApplicationStructuredData();
```

**Schema Types:**
- `WebApplication` - Describes Droppr as a web application
  - Name, description, URL
  - Application category
  - Operating system compatibility
  - Pricing information

### 4. XML Sitemap

An XML sitemap helps search engines discover and index all public pages.

**Endpoint:** `https://dropbox.lucheestiy.com/sitemap.xml`

**Pages Included:**
- Homepage (`/`)
- File request page (`/request.html`)
- Gallery page (`/gallery.html`)
- Stream gallery (`/stream-gallery.html`)
- Video player (`/video-player.html`)

**Sitemap Fields:**
- `<loc>` - Page URL
- `<lastmod>` - Last modification date
- `<changefreq>` - Update frequency (daily/weekly)
- `<priority>` - Page importance (0.1-1.0)

**Priority Levels:**
- Homepage: 1.0 (highest)
- Request page: 0.9
- Gallery: 0.8
- Stream gallery: 0.7
- Video player: 0.7

### 5. Robots.txt

The robots.txt file controls how search engine crawlers interact with the site.

**Location:** `nginx/robots.txt` (static) and `/robots.txt` (API fallback)

**Rules:**

**Disallowed Paths:**
- `/api/` - API endpoints
- `/files/` - File storage
- `/settings/` - Settings pages
- `/users/` - User management
- `/analytics/` - Analytics data
- `/metrics` - Metrics endpoint
- `/health` - Health checks

**Allowed Paths:**
- `/gallery.html` - Public galleries
- `/request.html` - File upload requests
- `/video-player.html` - Video player
- `/stream-gallery.html` - Streaming gallery
- `/static/` - Static assets
- `/` - Homepage

**Bot-Specific Rules:**

| Bot | Crawl Delay | Notes |
|-----|------------|-------|
| Googlebot | Default (10s) | Full access to public pages |
| Googlebot-Image | Default | Access to static assets only |
| Bingbot | Default | Full access |
| AhrefsBot | 30s | Slower crawl for SEO tool |
| SemrushBot | 30s | Slower crawl for SEO tool |

### 6. Web Vitals Tracking

Core Web Vitals are user-centric performance metrics tracked and reported to analytics.

**Location:** `nginx/src/utils/webvitals.ts`

**Usage:**

```typescript
import { initWebVitals } from './utils/webvitals';

// Initialize tracking on page load
initWebVitals();
```

**Metrics Tracked:**

| Metric | Name | Good | Needs Improvement | Poor |
|--------|------|------|-------------------|------|
| LCP | Largest Contentful Paint | ≤2.5s | ≤4.0s | >4.0s |
| FID | First Input Delay | ≤100ms | ≤300ms | >300ms |
| CLS | Cumulative Layout Shift | ≤0.1 | ≤0.25 | >0.25 |
| FCP | First Contentful Paint | ≤1.8s | ≤3.0s | >3.0s |
| TTFB | Time to First Byte | ≤800ms | ≤1.8s | >1.8s |

**Reporting:**
- Metrics are sent to `/api/analytics/events` endpoint
- Uses `navigator.sendBeacon()` for reliability
- Includes rating (good/needs-improvement/poor)
- Page path and navigation type included
- Non-blocking (won't impact user experience)

## Best Practices

### 1. Update Meta Tags Dynamically

Always update meta tags when content changes:

```typescript
// When gallery loads
fetchGalleryData(shareHash).then(data => {
  updateGalleryMetaTags(shareHash, data.files.length);
});

// When video loads
loadVideo(filename, thumbnailUrl).then(() => {
  updateVideoMetaTags(filename, thumbnailUrl);
});
```

### 2. Set Canonical URLs

Prevent duplicate content issues by setting canonical URLs:

```typescript
import { setCanonicalUrl } from './utils/seo';

// Use current URL without hash/query params
setCanonicalUrl();

// Or specify exact URL
setCanonicalUrl('https://dropbox.lucheestiy.com/gallery.html');
```

### 3. Provide High-Quality Images

For best social sharing:
- Use images at least 1200x630px for `og:image`
- Ensure images are served over HTTPS
- Use absolute URLs (handled automatically by utility)
- Create custom Open Graph images for key pages

### 4. Monitor Web Vitals

Check Web Vitals in analytics dashboard:
```sql
SELECT
  event_data->>'metric_name' as metric,
  AVG(CAST(event_data->>'value' AS FLOAT)) as avg_value,
  event_data->>'rating' as rating,
  COUNT(*) as count
FROM events
WHERE event_type = 'web_vital'
  AND created_at > NOW() - INTERVAL '7 days'
GROUP BY metric, rating
ORDER BY metric, rating;
```

### 5. Keep Sitemap Updated

The sitemap is generated dynamically, but if you add new public pages:

1. Update `media-server/app/routes/seo.py`
2. Add new URL to the `urls` array:
   ```python
   urls.append({
       "loc": f"{base_url}/new-page.html",
       "lastmod": today,
       "changefreq": "weekly",
       "priority": "0.8",
   })
   ```

### 6. Test Social Sharing

Use these tools to test social sharing:
- **Facebook:** [Sharing Debugger](https://developers.facebook.com/tools/debug/)
- **Twitter:** [Card Validator](https://cards-dev.twitter.com/validator)
- **LinkedIn:** [Post Inspector](https://www.linkedin.com/post-inspector/)
- **General:** [OpenGraph.xyz](https://www.opengraph.xyz/)

## Troubleshooting

### Open Graph Tags Not Updating

**Problem:** Social platforms show old preview when sharing

**Solutions:**
1. Clear platform's cache using their debug tools
2. Verify meta tags are in `<head>` (use browser inspector)
3. Ensure tags are set before page is shared
4. Check that image URLs are absolute and accessible

### Sitemap Not Found

**Problem:** `/sitemap.xml` returns 404

**Solutions:**
1. Verify SEO blueprint is registered in `media-server/app/legacy.py`
2. Check Flask logs for routing errors
3. Ensure nginx is proxying requests to media-server
4. Test directly: `curl https://dropbox.lucheestiy.com/sitemap.xml`

### Web Vitals Not Reporting

**Problem:** No Web Vitals data in analytics

**Solutions:**
1. Check browser console for errors
2. Verify `initWebVitals()` is called on page load
3. Check `/api/analytics/events` endpoint is accessible
4. Ensure browser supports Performance Observer API
5. Check analytics database for `web_vital` event types

### Robots.txt Rules Not Working

**Problem:** Bots ignoring robots.txt rules

**Solutions:**
1. Verify robots.txt is accessible: `curl https://dropbox.lucheestiy.com/robots.txt`
2. Check nginx is serving static file correctly
3. Validate syntax with [robots.txt tester](https://www.google.com/webmasters/tools/robots-testing-tool)
4. Note: robots.txt is advisory; bots can ignore it

## Performance Considerations

### Meta Tag Updates

- Meta tag updates are synchronous and fast (< 1ms)
- No network requests required
- Safe to call multiple times

### Web Vitals Tracking

- Uses PerformanceObserver (non-blocking)
- Metrics sent after measurement (doesn't block page)
- sendBeacon ensures delivery even on page unload
- Minimal overhead (< 5KB total)

### Sitemap Generation

- Cached for 1 hour (`Cache-Control: max-age=3600`)
- Generated on-demand (no disk I/O)
- Small payload (< 2KB)

## Future Enhancements

Planned improvements:
- [x] Dynamic sitemap with active shares
- [ ] Image optimization for Open Graph images
- [ ] Automatic generation of share-specific preview images
- [ ] Enhanced video metadata (duration, resolution)
- [ ] Local Business schema for contact information
- [ ] Review/rating schema for user feedback

## References

- [Open Graph Protocol](https://ogp.me/)
- [Twitter Cards](https://developer.twitter.com/en/docs/twitter-for-websites/cards/overview/abouts-cards)
- [Schema.org](https://schema.org/)
- [Google Search Central - Sitemaps](https://developers.google.com/search/docs/advanced/sitemaps/overview)
- [robots.txt Specifications](https://developers.google.com/search/docs/advanced/robots/intro)
- [Web Vitals](https://web.dev/vitals/)

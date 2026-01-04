from __future__ import annotations

import os
import time
import typing
from datetime import datetime
from io import BytesIO

from flask import Blueprint, Response, request
from PIL import Image, ImageDraw, ImageFont

from ..services.aliases import (
    _get_share_alias_meta,
    _list_share_aliases,
    _resolve_share_hash,
)
from ..utils.validation import is_valid_share_hash

try:
    SHARE_SITEMAP_LIMIT = max(
        0,
        min(
            5000,
            int(os.environ.get("DROPPR_SITEMAP_SHARE_LIMIT", "250")),
        ),
    )
except (TypeError, ValueError):
    SHARE_SITEMAP_LIMIT = 250

IMAGE_WIDTH = 1200
IMAGE_HEIGHT = 630

seo_bp = Blueprint("seo", __name__)


@seo_bp.route("/sitemap.xml")
def sitemap():
    """
    Generates an XML sitemap for search engines
    """
    base_url = "https://dropbox.lucheestiy.com"
    today = datetime.utcnow().strftime("%Y-%m-%d")

    # Static pages with priorities and change frequencies
    urls = [
        {
            "loc": f"{base_url}/",
            "lastmod": today,
            "changefreq": "daily",
            "priority": "1.0",
        },
        {
            "loc": f"{base_url}/request.html",
            "lastmod": today,
            "changefreq": "weekly",
            "priority": "0.9",
        },
        {
            "loc": f"{base_url}/gallery.html",
            "lastmod": today,
            "changefreq": "weekly",
            "priority": "0.8",
        },
        {
            "loc": f"{base_url}/stream-gallery.html",
            "lastmod": today,
            "changefreq": "weekly",
            "priority": "0.7",
        },
        {
            "loc": f"{base_url}/video-player.html",
            "lastmod": today,
            "changefreq": "weekly",
            "priority": "0.7",
        },
    ]

    urls.extend(_build_share_urls(base_url, today))

    # Build XML sitemap
    xml_content = ['<?xml version="1.0" encoding="UTF-8"?>']
    xml_content.append('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')

    for url in urls:
        xml_content.append("  <url>")
        xml_content.append(f"    <loc>{url['loc']}</loc>")
        xml_content.append(f"    <lastmod>{url['lastmod']}</lastmod>")
        xml_content.append(f"    <changefreq>{url['changefreq']}</changefreq>")
        xml_content.append(f"    <priority>{url['priority']}</priority>")
        xml_content.append("  </url>")

    xml_content.append("</urlset>")

    return Response(
        "\n".join(xml_content),
        mimetype="application/xml",
        headers={"Cache-Control": "public, max-age=3600"},
    )


def _format_iso_date(timestamp: int | None, fallback: str) -> str:
    if isinstance(timestamp, int) and timestamp > 0:
        try:
            return datetime.utcfromtimestamp(timestamp).strftime("%Y-%m-%d")
        except (OSError, OverflowError, ValueError):
            pass
    return fallback


def _is_share_active(alias: dict, now: int) -> bool:
    expiration = alias.get("target_expire")
    if isinstance(expiration, int) and expiration > 0 and expiration < now:
        return False

    download_limit = alias.get("download_limit")
    download_count = alias.get("download_count") or 0

    try:
        limit = int(download_limit) if download_limit is not None else None
    except (TypeError, ValueError):
        limit = None

    try:
        count = int(download_count)
    except (TypeError, ValueError):
        count = 0

    if limit is not None and limit > 0 and count >= limit:
        return False

    return True


def _build_share_urls(base_url: str, fallback_lastmod: str) -> list[dict]:
    if SHARE_SITEMAP_LIMIT <= 0:
        return []

    try:
        aliases = _list_share_aliases(limit=SHARE_SITEMAP_LIMIT)
    except Exception:
        return []

    now = int(time.time())
    share_urls: list[dict] = []
    seen_hashes: set[str] = set()

    for alias in aliases:
        share_hash = alias.get("from_hash")
        if not isinstance(share_hash, str) or not share_hash.strip():
            continue
        if share_hash in seen_hashes:
            continue
        if not _is_share_active(alias, now):
            continue

        lastmod = _format_iso_date(
            alias.get("updated_at") or alias.get("created_at"),
            fallback_lastmod,
        )

        share_urls.append(
            {
                "loc": f"{base_url}/gallery.html#{share_hash}",
                "lastmod": lastmod,
                "changefreq": "weekly",
                "priority": "0.5",
            }
        )
        seen_hashes.add(share_hash)

    return share_urls


def _load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype("DejaVuSans-Bold.ttf", size)
    except Exception:
        return ImageFont.load_default()


def _draw_gradient(draw: ImageDraw.ImageDraw) -> None:
    for x in range(IMAGE_WIDTH):
        ratio = x / max(1, IMAGE_WIDTH - 1)
        r = int(14 + ratio * 80)
        g = int(20 + ratio * 30)
        b = int(40 + (1 - ratio) * 60)
        draw.line((x, 0, x, IMAGE_HEIGHT), fill=(r, g, b))


def _pick_image_format() -> tuple[str, str]:
    query_format = request.args.get("format", "").lower()
    if query_format == "webp":
        return "webp", "image/webp"

    preferred = request.accept_mimetypes.best_match(
        ["image/webp", "image/png"], default="image/png"
    )
    if preferred == "image/webp":
        return "webp", "image/webp"

    return "png", "image/png"


def _render_image_bytes(image: Image.Image, fmt: str) -> bytes:
    buffer = BytesIO()
    if fmt == "webp":
        image.save(buffer, format="WEBP", quality=78, method=6)
    else:
        image.save(buffer, format="PNG", optimize=True)
    buffer.seek(0)
    return buffer.getvalue()


def _create_share_preview_image(share_hash: str, alias_meta: dict[str, typing.Any]) -> Image.Image:
    image = Image.new("RGB", (IMAGE_WIDTH, IMAGE_HEIGHT), "#0e0e0e")
    draw = ImageDraw.Draw(image)
    _draw_gradient(draw)

    title_font = _load_font(64)
    subtitle_font = _load_font(42)
    detail_font = _load_font(28)

    margin = 80
    current_y = 160
    draw.text(
        (margin, current_y),
        "Droppr Share",
        font=title_font,
        fill=(245, 245, 245),
    )

    current_y += 90
    path_label = alias_meta.get("path") or f"Share #{share_hash[:8]}"
    draw.text(
        (margin, current_y),
        path_label,
        font=subtitle_font,
        fill=(220, 235, 255),
    )

    share_id_text = f"Share ID: {share_hash}"
    current_y += 60
    draw.text(
        (margin, current_y),
        share_id_text,
        font=detail_font,
        fill=(200, 215, 220),
    )

    download_limit = alias_meta.get("download_limit")
    download_count = alias_meta.get("download_count") or 0
    downloads_text = "Downloads: " + (
        f"{download_count}/{download_limit}" if download_limit not in (None, 0) else f"{download_count}/∞"
    )
    current_y += 40
    draw.text(
        (margin, current_y),
        downloads_text,
        font=detail_font,
        fill=(200, 215, 220),
    )

    lastmod = _format_iso_date(
        alias_meta.get("updated_at") or alias_meta.get("created_at"),
        datetime.utcnow().strftime("%Y-%m-%d"),
    )
    current_y += 40
    draw.text(
        (margin, current_y),
        f"Last updated: {lastmod}",
        font=detail_font,
        fill=(200, 215, 220),
    )

    footer_text = "Secure previews · Powered by Droppr"
    footer_font = _load_font(24)
    try:
        footer_bbox = draw.textbbox((0, 0), footer_text, font=footer_font)
        footer_width = footer_bbox[2] - footer_bbox[0]
    except AttributeError:
        getlength = getattr(footer_font, "getlength", None)
        if callable(getlength):
            footer_width = int(getlength(footer_text))
        else:
            getsize = getattr(footer_font, "getsize", None)
            if callable(getsize):
                footer_width = getsize(footer_text)[0]
            else:
                footer_width = len(footer_text) * 10
    draw.text(
        (IMAGE_WIDTH - margin - footer_width, IMAGE_HEIGHT - 60),
        footer_text,
        font=footer_font,
        fill=(180, 190, 200),
    )

    return image


@seo_bp.route("/og/share/<share_hash>.png")
def share_og_image(share_hash: str):
    if not is_valid_share_hash(share_hash):
        return Response(status=404)

    resolved_hash = _resolve_share_hash(share_hash)
    if not resolved_hash:
        return Response(status=404)

    alias_meta = _get_share_alias_meta(share_hash) or {}
    image = _create_share_preview_image(share_hash, alias_meta)
    fmt, mimetype = _pick_image_format()
    payload = _render_image_bytes(image, fmt)

    return Response(
        payload,
        mimetype=mimetype,
        headers={"Cache-Control": "public, max-age=7200"},
    )


@seo_bp.route("/robots.txt")
def robots():
    """
    Serves robots.txt (this is a fallback if nginx doesn't serve it)
    """
    content = """# Droppr File Sharing - Robots.txt
# Updated: 2026-01-04

User-agent: *
Disallow: /api/
Disallow: /files/
Disallow: /settings/
Disallow: /users/
Disallow: /analytics/
Disallow: /metrics
Disallow: /health

# Allow public pages
Allow: /gallery.html
Allow: /request.html
Allow: /video-player.html
Allow: /stream-gallery.html
Allow: /static/
Allow: /

# Crawl delay (be respectful)
Crawl-delay: 10

# Sitemap location
Sitemap: https://dropbox.lucheestiy.com/sitemap.xml

# Specific bot rules
User-agent: Googlebot
Allow: /

User-agent: Googlebot-Image
Allow: /static/
Disallow: /files/

User-agent: Bingbot
Allow: /

# Block aggressive scrapers
User-agent: AhrefsBot
Crawl-delay: 30

User-agent: SemrushBot
Crawl-delay: 30
"""

    return Response(
        content,
        mimetype="text/plain",
        headers={"Cache-Control": "public, max-age=86400"},
    )

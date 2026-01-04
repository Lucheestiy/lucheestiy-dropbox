from __future__ import annotations

import os
from urllib.parse import quote

from ..utils.validation import IMAGE_EXTS, VIDEO_EXTS, _safe_rel_path
from .filebrowser import _fetch_public_share_json


def _infer_gallery_type(item: dict, extension: str) -> str:
    """
    Infers the gallery media type (image, video, or file) based on the item's
    metadata or file extension.

    Args:
        item: The file metadata dictionary from FileBrowser.
        extension: The file extension (lowercase, without dot).

    Returns:
        A string: "image", "video", or "file".
    """
    raw_type = (item.get("type") or "").strip().lower()
    if raw_type in {"image", "video"}:
        return raw_type
    if extension in IMAGE_EXTS:
        return "image"
    if extension in VIDEO_EXTS:
        return "video"
    return "file"


def _build_folder_share_file_list(
    *, request_hash: str, source_hash: str, root: dict, recursive: bool
) -> list[dict]:
    """
    Constructs a list of files within a folder share, optionally scanning
    subdirectories recursively.

    Args:
        request_hash: The public share hash used in the request.
        source_hash: The resolved internal share hash.
        root: The root folder metadata.
        recursive: Whether to scan subfolders.

    Returns:
        A list of dictionaries containing file details (name, path, type, size, etc.).
    """
    files: list[dict] = []
    dirs_to_scan: list[str] = []
    visited_dirs: set[str] = set()

    root_items = root.get("items")
    if not isinstance(root_items, list):
        return files

    for item in root_items:
        if not isinstance(item, dict):
            continue
        if item.get("isDir"):
            path = item.get("path")
            if recursive and isinstance(path, str) and path.startswith("/"):
                dirs_to_scan.append(path)
            continue
        files.append(item)

    if recursive:
        while dirs_to_scan:
            dir_path = dirs_to_scan.pop()
            if dir_path in visited_dirs:
                continue
            visited_dirs.add(dir_path)

            data = _fetch_public_share_json(source_hash, subpath=dir_path)
            if not data:
                continue
            items = data.get("items")
            if not isinstance(items, list):
                continue

            for item in items:
                if not isinstance(item, dict):
                    continue
                if item.get("isDir"):
                    path = item.get("path")
                    if isinstance(path, str) and path.startswith("/"):
                        dirs_to_scan.append(path)
                    continue
                files.append(item)

    result = []
    for item in files:
        raw_path = item.get("path")
        if not isinstance(raw_path, str) or not raw_path:
            continue
        rel_path = raw_path[1:] if raw_path.startswith("/") else raw_path
        rel_path = _safe_rel_path(rel_path)
        if not rel_path:
            continue

        name = item.get("name") if isinstance(item.get("name"), str) else os.path.basename(rel_path)
        ext = item.get("extension") if isinstance(item.get("extension"), str) else ""
        ext = ext[1:] if ext.startswith(".") else ext
        ext = ext.lower()

        result.append(
            {
                "name": name,
                "path": rel_path,
                "type": _infer_gallery_type(item, ext),
                "extension": ext,
                "size": int(item.get("size") or 0),
                "modified": int(item.get("modified") or 0),
                "inline_url": f"/api/public/dl/{source_hash}/{quote(rel_path, safe='/')}?inline=true",
                "download_url": f"/api/share/{request_hash}/file/{quote(rel_path, safe='/')}?download=1",
            }
        )

    return result


def _build_file_share_file_list(*, request_hash: str, source_hash: str, meta: dict) -> list[dict]:
    """
    Constructs a file list for a single-file share.

    Args:
        request_hash: The public share hash used in the request.
        source_hash: The resolved internal share hash.
        meta: The file metadata.

    Returns:
        A list containing a single dictionary with the file details.
    """
    raw_path = meta.get("path")
    name = meta.get("name")
    if not isinstance(name, str) or not name:
        if isinstance(raw_path, str) and raw_path:
            name = os.path.basename(raw_path)
        else:
            name = source_hash

    ext = meta.get("extension") if isinstance(meta.get("extension"), str) else ""
    ext = ext[1:] if ext.startswith(".") else ext
    ext = ext.lower()

    return [
        {
            "name": name,
            "path": name,
            "type": _infer_gallery_type(meta, ext),
            "extension": ext,
            "size": int(meta.get("size") or 0),
            "modified": int(meta.get("modified") or 0),
            "inline_url": f"/api/public/file/{source_hash}?inline=true",
            "download_url": f"/api/share/{request_hash}/download",
        }
    ]

from __future__ import annotations

import os


def _ensure_unique_path(path: str) -> str:
    if not os.path.exists(path):
        return path
    base, ext = os.path.splitext(path)
    for idx in range(1, 1000):
        candidate = f"{base} ({idx}){ext}"
        if not os.path.exists(candidate):
            return candidate
    raise RuntimeError("Too many duplicate filenames")

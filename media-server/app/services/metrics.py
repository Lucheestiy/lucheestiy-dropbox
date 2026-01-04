from __future__ import annotations

import os

from prometheus_client import REGISTRY, CollectorRegistry, multiprocess

from ..config import parse_bool

METRICS_ENABLED = parse_bool(os.environ.get("DROPPR_METRICS_ENABLED", "true"))
PROMETHEUS_MULTIPROC_DIR = (os.environ.get("PROMETHEUS_MULTIPROC_DIR") or "").strip()
PROMETHEUS_MULTIPROC_ENABLED = bool(PROMETHEUS_MULTIPROC_DIR)


def _get_metrics_registry() -> CollectorRegistry:
    if PROMETHEUS_MULTIPROC_ENABLED:
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)
        return registry
    return REGISTRY

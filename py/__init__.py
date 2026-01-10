"""
Internal ComfyData backend package.

This package contains the backend implementation used by the plugin entrypoint
and (later) by ComfyUI nodes + frontend JS extension.

Kept intentionally small; most modules are imported directly where needed.
"""

from __future__ import annotations

# Optional: re-export a couple of commonly used helpers for convenience
from .paths import ensure_storage_dirs, get_paths  # noqa: F401

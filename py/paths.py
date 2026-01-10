from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


# -----------------------------------------------------------------------------
# ComfyUI base directory resolution
# -----------------------------------------------------------------------------

def find_comfyui_base_dir(start: Optional[Path] = None, max_levels: int = 12) -> Path:
    """
    Best-effort detection of the ComfyUI base directory.

    We expect a ComfyUI base directory to contain:
      - custom_nodes/
      - user/

    Strategy:
      - Walk upward from `start` (defaults to this file) up to `max_levels`
      - Pick the first directory that contains BOTH `custom_nodes` and `user`
      - If not found, fall back to current working directory
    """
    here = (start or Path(__file__)).resolve()

    # If start is a file, use its parent
    cur = here if here.is_dir() else here.parent

    for _ in range(max_levels):
        if (cur / "custom_nodes").is_dir() and (cur / "user").is_dir():
            return cur
        if cur.parent == cur:
            break
        cur = cur.parent

    # Fallback: useful for unit tests or non-ComfyUI imports
    return Path.cwd().resolve()


# -----------------------------------------------------------------------------
# Storage locations
# -----------------------------------------------------------------------------

@dataclass(frozen=True)
class ComfyDataPaths:
    comfyui_base: Path
    user_default: Path
    comfy_data_root: Path
    schemas_dir: Path
    instances_dir: Path


def get_paths() -> ComfyDataPaths:
    """
    Resolve canonical storage locations for ComfyData.

    Storage conventions (v1):
      - Schemas:   ComfyUI/user/default/comfy_data/schemas/
      - Instances: ComfyUI/user/default/comfy_data/instances/
    """
    base = find_comfyui_base_dir()
    user_default = base / "user" / "default"
    comfy_data_root = user_default / "comfy_data"
    schemas_dir = comfy_data_root / "schemas"
    instances_dir = comfy_data_root / "instances"

    return ComfyDataPaths(
        comfyui_base=base,
        user_default=user_default,
        comfy_data_root=comfy_data_root,
        schemas_dir=schemas_dir,
        instances_dir=instances_dir,
    )


def ensure_storage_dirs() -> ComfyDataPaths:
    """
    Ensure ComfyData storage directories exist.
    Safe to call repeatedly.
    """
    p = get_paths()
    p.schemas_dir.mkdir(parents=True, exist_ok=True)
    p.instances_dir.mkdir(parents=True, exist_ok=True)
    return p


# -----------------------------------------------------------------------------
# Name / filename sanitization
# -----------------------------------------------------------------------------

_NAME_RE = re.compile(r"[^A-Za-z0-9_.-]+")


def sanitize_schema_name(name: str) -> str:
    """
    Sanitize a schema name for safe use as a filename.

    - Allows: letters, digits, underscore, dash, dot
    - Replaces other characters with underscore
    - Trims leading/trailing separators

    Raises ValueError if result is empty.
    """
    n = (name or "").strip()
    if not n:
        raise ValueError("schema name cannot be empty")

    n = _NAME_RE.sub("_", n)
    n = n.strip("._- ")

    if not n:
        raise ValueError("schema name contains no valid characters after sanitization")

    return n


def schema_file_path(schema_name: str) -> Path:
    """
    Return the absolute path for a schema YAML file under the ComfyData schemas dir.
    """
    p = ensure_storage_dirs()
    safe = sanitize_schema_name(schema_name)
    return p.schemas_dir / f"{safe}.yaml"

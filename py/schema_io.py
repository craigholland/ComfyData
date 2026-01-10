from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml

from .paths import ensure_storage_dirs, sanitize_schema_name, schema_file_path


class SchemaIOError(Exception):
    """Raised for schema load/save contract violations."""


@dataclass(frozen=True)
class LoadedSchema:
    name: str
    doc: Dict[str, Any]          # full YAML document as dict
    path: Path


def _require_schema_contract(doc: Any, *, fallback_name: Optional[str] = None) -> Dict[str, Any]:
    """
    Enforce the top-level schema contract:

      doc == {"schema": {"name": <str>, "fields": <dict>}}

    Returns the normalized top-level dict (same shape) or raises SchemaIOError.
    """
    if doc is None:
        raise SchemaIOError("Schema YAML is empty (no document).")

    if not isinstance(doc, dict):
        raise SchemaIOError(f"Schema YAML must be a mapping/dict. Got: {type(doc).__name__}")

    if "schema" not in doc:
        raise SchemaIOError("Schema YAML must have a top-level 'schema' key.")

    schema = doc.get("schema")
    if not isinstance(schema, dict):
        raise SchemaIOError("Top-level 'schema' must be a mapping/dict.")

    name = schema.get("name") or fallback_name
    if not isinstance(name, str) or not name.strip():
        raise SchemaIOError("schema.name must be a non-empty string.")

    fields = schema.get("fields")
    if fields is None:
        # allow missing fields -> treat as empty (helpful for early editing)
        fields = {}
        schema["fields"] = fields

    if not isinstance(fields, dict):
        raise SchemaIOError("schema.fields must be a mapping/dict.")

    # Ensure the doc is in the canonical shape (mutating local copy)
    schema["name"] = name.strip()
    doc["schema"] = schema
    return doc


def list_schema_names() -> List[str]:
    """
    Return a sorted list of schema names found on disk.
    We infer schema name from filename (sanitized), not from file contents.
    """
    p = ensure_storage_dirs()
    names: List[str] = []
    for f in p.schemas_dir.glob("*.yaml"):
        if f.is_file():
            names.append(f.stem)
    return sorted(set(names), key=lambda s: s.lower())


def schema_exists(schema_name: str) -> bool:
    path = schema_file_path(schema_name)
    return path.exists() and path.is_file()


def load_schema(schema_name: str) -> LoadedSchema:
    """
    Load a schema YAML file by schema name (filename stem).
    Enforces the schema contract.
    """
    safe = sanitize_schema_name(schema_name)
    path = schema_file_path(safe)
    if not path.exists():
        raise FileNotFoundError(f"Schema '{safe}' not found at: {path}")

    text = path.read_text(encoding="utf-8")
    try:
        doc = yaml.safe_load(text)
    except Exception as e:
        raise SchemaIOError(f"Invalid YAML in schema '{safe}': {e}") from e

    doc = _require_schema_contract(doc, fallback_name=safe)

    # Optionally: ensure schema.name matches the requested name.
    # For v1, we allow mismatch but return the file's declared name.
    declared_name = str(doc["schema"]["name"]).strip()

    return LoadedSchema(name=declared_name, doc=doc, path=path)


def save_schema(schema_name: str, doc: Dict[str, Any]) -> Path:
    """
    Save schema YAML to disk under the schemas directory using schema_name as filename.
    Enforces schema contract. Returns path written.

    Note: schema_name is the filename identity; schema.name is the declared type name.
    For v1, we don't force them to match.
    """
    safe = sanitize_schema_name(schema_name)
    path = schema_file_path(safe)

    # Enforce/normalize contract before writing
    doc = _require_schema_contract(doc, fallback_name=safe)

    # Write YAML (readable, stable-ish)
    text = yaml.safe_dump(doc, sort_keys=False, default_flow_style=False)

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return path


def save_schema_from_yaml(schema_name: str, yaml_text: str) -> Path:
    """
    Convenience: parse YAML text then save.
    """
    try:
        doc = yaml.safe_load(yaml_text)
    except Exception as e:
        raise SchemaIOError(f"Invalid YAML: {e}") from e

    doc = _require_schema_contract(doc, fallback_name=schema_name)
    return save_schema(schema_name, doc)


def delete_schema(schema_name: str) -> bool:
    """
    Delete a schema file. Returns True if deleted, False if not found.
    """
    safe = sanitize_schema_name(schema_name)
    path = schema_file_path(safe)
    if not path.exists():
        return False
    path.unlink()
    return True


def dump_schema_yaml(doc: Dict[str, Any]) -> str:
    """
    Dump a schema doc dict to YAML. Enforces contract first.
    """
    doc = _require_schema_contract(doc)
    return yaml.safe_dump(doc, sort_keys=False, default_flow_style=False)

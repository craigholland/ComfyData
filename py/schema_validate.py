from __future__ import annotations
import yaml

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

from .schema_normalize import (
    ALLOWED_PRIMITIVES,
    ALLOWED_COMPLEX,
    SchemaNormalizeError,
    normalize_schema_doc,
)


@dataclass(frozen=True)
class ValidationError:
    """
    A lightweight validation error record suitable for UI consumption.
    """
    path: str          # e.g. "schema.fields.hair.fields.color"
    message: str       # human-readable message


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    errors: List[ValidationError]


def validate_schema_doc(doc: Dict[str, Any]) -> ValidationResult:
    """
    Minimal v1 validation for a schema doc.

    Assumptions:
    - schema_io has already enforced the top-level contract:
      doc["schema"]["name"] and doc["schema"]["fields"] exist.

    Behavior:
    - Returns all errors found (does not raise)
    - Uses normalization to detect invalid shapes/types early
    """
    errors: List[ValidationError] = []

    # Validate schema.name
    schema = doc.get("schema", {})
    name = schema.get("name")
    if not isinstance(name, str) or not name.strip():
        errors.append(ValidationError("schema.name", "schema.name must be a non-empty string."))

    # Validate schema.fields is a dict
    fields = schema.get("fields")
    if not isinstance(fields, dict):
        errors.append(ValidationError("schema.fields", "schema.fields must be a mapping/dict."))
        return ValidationResult(ok=False, errors=errors)

    # Validate field names and duplicates (dict already guarantees uniqueness by key,
    # but we still validate key shape and reserved words later if needed)
    for k in fields.keys():
        if not isinstance(k, str) or not k.strip():
            errors.append(ValidationError("schema.fields", "All field names must be non-empty strings."))

    # Try normalization; if it fails, return that as validation errors.
    # Normalization also implicitly validates allowed types and nested shapes.
    try:
        _ = normalize_schema_doc(doc)
    except SchemaNormalizeError as e:
        # Surface the normalize error at schema.fields for v1 simplicity.
        errors.append(ValidationError("schema.fields", str(e)))

    return ValidationResult(ok=(len(errors) == 0), errors=errors)


def validate_schema_yaml_text(yaml_text: str) -> ValidationResult:
    """
    Optional helper if you validate raw YAML text upstream.
    Kept minimal for v1; intended to be used by API if desired.
    """


    try:
        doc = yaml.safe_load(yaml_text)
    except Exception as e:
        return ValidationResult(
            ok=False,
            errors=[ValidationError("yaml", f"Invalid YAML: {e}")],
        )

    if not isinstance(doc, dict):
        return ValidationResult(
            ok=False,
            errors=[ValidationError("yaml", "Top-level YAML document must be a mapping/dict.")],
        )

    if "schema" not in doc:
        return ValidationResult(
            ok=False,
            errors=[ValidationError("schema", "Schema YAML must have a top-level 'schema' key.")],
        )

    # Let validate_schema_doc do the rest (schema_io contract enforcement is stricter;
    # we keep this helper permissive and report issues rather than throwing).
    # Ensure minimal keys exist to avoid KeyErrors.
    schema = doc.get("schema")
    if not isinstance(schema, dict):
        return ValidationResult(
            ok=False,
            errors=[ValidationError("schema", "Top-level 'schema' must be a mapping/dict.")],
        )

    schema.setdefault("name", "")
    schema.setdefault("fields", {})
    doc["schema"] = schema

    return validate_schema_doc(doc)

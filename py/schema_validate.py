from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List

import yaml

from .schema_io import schema_exists
from .schema_normalize import (
    NormalizedField,
    SchemaNormalizeError,
    normalize_schema_doc,
)


@dataclass(frozen=True)
class ValidationError:
    """
    A lightweight validation error record suitable for UI consumption.
    """
    path: str          # e.g. "schema.fields.hair.fields.color.ref"
    message: str       # human-readable message


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    errors: List[ValidationError]


def _walk_and_validate_refs(
    *,
    fields: Dict[str, NormalizedField],
    base_path: str,
    errors: List[ValidationError],
) -> None:
    """
    Recursively walk normalized fields and validate `ref` targets exist on disk.

    Path conventions (match existing style):
      - Root: "schema.fields"
      - Nested object fields append: ".<field>.fields"
      - Ref target path: ".<field>.ref"
    """
    for field_name, nf in (fields or {}).items():
        # Only validate shape for path correctness here; normalization already enforced
        # field_name non-empty, etc.
        if nf.kind == "object":
            nested = nf.fields or {}
            _walk_and_validate_refs(
                fields=nested,
                base_path=f"{base_path}.{field_name}.fields",
                errors=errors,
            )
            continue

        if nf.kind == "ref":
            ref_name = (nf.ref or "").strip()
            # Normalization should already enforce non-empty string, but keep this defensive.
            if not ref_name:
                errors.append(
                    ValidationError(
                        path=f"{base_path}.{field_name}.ref",
                        message="ref.ref must be a non-empty string (target schema name).",
                    )
                )
                continue

            if not schema_exists(ref_name):
                errors.append(
                    ValidationError(
                        path=f"{base_path}.{field_name}.ref",
                        message=f"Referenced schema '{ref_name}' does not exist on disk.",
                    )
                )
            continue

        # primitives and single-select require no additional checks here


def validate_schema_doc(doc: Dict[str, Any]) -> ValidationResult:
    """
    Minimal v1 validation for a schema doc.

    Assumptions:
    - schema_io has already enforced the top-level contract:
      doc["schema"]["name"] and doc["schema"]["fields"] exist.

    Behavior:
    - Returns all errors found (does not raise)
    - Uses normalization to detect invalid shapes/types early
    - Adds `ref` existence validation (must reference an existing YAML schema file)
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

    # Validate field names
    for k in fields.keys():
        if not isinstance(k, str) or not k.strip():
            errors.append(ValidationError("schema.fields", "All field names must be non-empty strings."))

    # Normalize (captures invalid types, malformed structures, missing ref/ref, etc.)
    try:
        normalized = normalize_schema_doc(doc)
    except SchemaNormalizeError as e:
        # Surface normalize error at schema.fields for v1 simplicity
        errors.append(ValidationError("schema.fields", str(e)))
        return ValidationResult(ok=False, errors=errors)

    # Additional pass: enforce `ref` targets exist on disk (named schemas only)
    _walk_and_validate_refs(fields=normalized.fields, base_path="schema.fields", errors=errors)

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

    schema = doc.get("schema")
    if not isinstance(schema, dict):
        return ValidationResult(
            ok=False,
            errors=[ValidationError("schema", "Top-level 'schema' must be a mapping/dict.")],
        )

    # Ensure minimal keys exist to avoid KeyErrors.
    schema.setdefault("name", "")
    schema.setdefault("fields", {})
    doc["schema"] = schema

    return validate_schema_doc(doc)

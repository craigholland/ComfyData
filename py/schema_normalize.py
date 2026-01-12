from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional


PrimitiveType = Literal["uuid", "int", "str", "decimal"]
FieldKind = Literal["primitive", "single-select", "object", "ref"]


ALLOWED_PRIMITIVES: set[str] = {"uuid", "int", "str", "decimal"}
ALLOWED_COMPLEX: set[str] = {"single-select", "object", "ref"}


class SchemaNormalizeError(Exception):
    """Raised when a schema cannot be normalized due to invalid structure."""


@dataclass(frozen=True)
class NormalizedField:
    kind: FieldKind
    # For kind == "primitive"
    primitive: Optional[PrimitiveType] = None
    # For kind == "single-select"
    values: Optional[List[Any]] = None
    # For kind == "object"
    fields: Optional[Dict[str, "NormalizedField"]] = None
    # For kind == "ref"
    ref: Optional[str] = None


@dataclass(frozen=True)
class NormalizedSchema:
    name: str
    fields: Dict[str, NormalizedField]


def normalize_schema_doc(doc: Dict[str, Any]) -> NormalizedSchema:
    """
    Normalize an in-memory schema document (already contract-validated by schema_io).

    Input shape (required):
      doc["schema"]["name"]   : str
      doc["schema"]["fields"] : dict

    Output:
      NormalizedSchema with recursively normalized fields.

    Notes:
    - `null` for single-select is *implicit* and is NOT injected into stored values.
    - We keep values as-is (preserve order), but we remove duplicates while preserving order.
    - `ref` fields are normalized for shape only (presence/type of `ref`); existence checks occur in validation.
    """
    try:
        schema = doc["schema"]
        name = str(schema["name"]).strip()
        raw_fields = schema.get("fields") or {}
    except Exception as e:
        raise SchemaNormalizeError(f"Invalid schema doc structure: {e}") from e

    if not isinstance(raw_fields, dict):
        raise SchemaNormalizeError("schema.fields must be a dict.")

    normalized_fields: Dict[str, NormalizedField] = {}
    for field_name, field_def in raw_fields.items():
        if not isinstance(field_name, str) or not field_name.strip():
            raise SchemaNormalizeError("Field names must be non-empty strings.")
        normalized_fields[field_name] = normalize_field(field_def)

    return NormalizedSchema(name=name, fields=normalized_fields)


def normalize_field(field_def: Any) -> NormalizedField:
    """
    Normalize a single field definition.

    Supported v1 input patterns:
    1) Primitive shorthand:
       age_years: int

    2) single-select:
       eye_color:
         type: single-select
         values: [blue, green]

    3) object:
       hair:
         type: object
         fields:
           color: {type: single-select, values: [...]}

    4) ref:
       address:
         type: ref
         ref: Address
    """
    # Primitive shorthand: "int", "uuid", etc.
    if isinstance(field_def, str):
        t = field_def.strip()
        if t in ALLOWED_PRIMITIVES:
            return NormalizedField(kind="primitive", primitive=t)  # type: ignore[arg-type]
        raise SchemaNormalizeError(f"Unknown primitive type string: '{t}'")

    if not isinstance(field_def, dict):
        raise SchemaNormalizeError(
            f"Field definition must be a string (primitive) or dict. Got: {type(field_def).__name__}"
        )

    # Must have a type
    t = field_def.get("type")
    if not isinstance(t, str) or not t.strip():
        raise SchemaNormalizeError("Field dict definitions must include non-empty 'type'.")

    t = t.strip()

    if t == "single-select":
        values = field_def.get("values", [])
        if values is None:
            values = []
        if not isinstance(values, list):
            raise SchemaNormalizeError("single-select.values must be a list.")

        # Deduplicate while preserving order; do NOT inject 'null'
        seen = set()
        deduped: List[Any] = []
        for v in values:
            key = _stable_hashable(v)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(v)

        return NormalizedField(kind="single-select", values=deduped)

    if t == "object":
        raw_fields = field_def.get("fields", {})
        if raw_fields is None:
            raw_fields = {}
        if not isinstance(raw_fields, dict):
            raise SchemaNormalizeError("object.fields must be a dict.")

        nested: Dict[str, NormalizedField] = {}
        for k, v in raw_fields.items():
            if not isinstance(k, str) or not k.strip():
                raise SchemaNormalizeError("Nested field names must be non-empty strings.")
            nested[k] = normalize_field(v)

        return NormalizedField(kind="object", fields=nested)

    if t == "ref":
        ref_name = field_def.get("ref")
        if not isinstance(ref_name, str) or not ref_name.strip():
            raise SchemaNormalizeError("ref.ref must be a non-empty string (target schema name).")
        # Trim whitespace; existence is validated later.
        return NormalizedField(kind="ref", ref=ref_name.strip())

    raise SchemaNormalizeError(f"Unsupported field type '{t}'. Allowed: {sorted(ALLOWED_COMPLEX)}")


def _stable_hashable(value: Any) -> Any:
    """
    Convert a value to something hashable for deduping while preserving semantics.

    - Scalars remain as-is if hashable
    - Dict/list are converted to repr() as a fallback
    """
    try:
        hash(value)
        return value
    except Exception:
        return repr(value)


# -----------------------------------------------------------------------------
# Optional helper: normalized -> canonical YAML doc
# -----------------------------------------------------------------------------


def normalized_to_doc(schema: NormalizedSchema) -> Dict[str, Any]:
    """
    Convert a NormalizedSchema back into a canonical schema document dict
    suitable for YAML serialization.

    Canonical field representations:
    - primitive: "int"
    - single-select: {type: single-select, values: [...]}
    - object: {type: object, fields: {...}}
    - ref: {type: ref, ref: <SchemaName>}
    """

    def field_to_obj(f: NormalizedField) -> Any:
        if f.kind == "primitive":
            if not f.primitive:
                raise SchemaNormalizeError("primitive field missing primitive type")
            return f.primitive
        if f.kind == "single-select":
            return {"type": "single-select", "values": list(f.values or [])}
        if f.kind == "object":
            out: Dict[str, Any] = {}
            for k, v in (f.fields or {}).items():
                out[k] = field_to_obj(v)
            return {"type": "object", "fields": out}
        if f.kind == "ref":
            if not f.ref or not str(f.ref).strip():
                raise SchemaNormalizeError("ref field missing ref target")
            return {"type": "ref", "ref": str(f.ref).strip()}
        raise SchemaNormalizeError(f"Unhandled normalized field kind: {f.kind}")

    fields_obj: Dict[str, Any] = {}
    for k, v in schema.fields.items():
        fields_obj[k] = field_to_obj(v)

    return {"schema": {"name": schema.name, "fields": fields_obj}}

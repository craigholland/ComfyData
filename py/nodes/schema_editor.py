from __future__ import annotations

from typing import Any, Dict, Tuple

from ..schema_normalize import normalize_schema_doc, normalized_to_doc
from ..schema_validate import validate_schema_doc


class ComfyDataSchemaEditor:
    """
    Minimal v1 Schema Editor node.

    Responsibilities:
    - Act as a stable anchor node in the ComfyUI graph
    - Hold editor state (JSON/YAML) in a hidden widget
    - Optionally validate + normalize schema docs
    - Output canonical YAML for debugging / downstream use

    NOTE:
    The real UX lives in the frontend JS extension.
    """

    @classmethod
    def INPUT_TYPES(cls) -> Dict[str, Any]:
        return {
            "required": {},
            "optional": {},
            "hidden": {
                "schema_yaml": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("schema_yaml",)
    FUNCTION = "run"
    CATEGORY = "ComfyData"

    def run(self, schema_yaml: str = "") -> Tuple[str]:
        """
        Node execution hook.

        For v1:
        - If schema_yaml is empty, output empty string
        - If provided, attempt to validate + normalize
        - Output canonical YAML (or original if validation fails)

        We do NOT throw hard exceptions here — errors should be
        surfaced via the JS editor UI, not crash the graph.
        """
        if not schema_yaml.strip():
            return ("",)

        try:
            import yaml

            doc = yaml.safe_load(schema_yaml)
            if not isinstance(doc, dict):
                return (schema_yaml,)

            validation = validate_schema_doc(doc)
            if not validation.ok:
                # For now, just return original YAML.
                # JS UI will surface errors later.
                return (schema_yaml,)

            normalized = normalize_schema_doc(doc)
            canonical_doc = normalized_to_doc(normalized)

            out_yaml = yaml.safe_dump(
                canonical_doc,
                sort_keys=False,
                default_flow_style=False,
            )
            return (out_yaml,)

        except Exception:
            # Never hard-fail a ComfyUI node
            return (schema_yaml,)

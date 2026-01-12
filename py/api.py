from __future__ import annotations

from typing import Any, Dict, Optional

from aiohttp import web

from .paths import ensure_storage_dirs
from .schema_io import (
    SchemaIOError,
    delete_schema,
    list_schema_names,
    load_schema,
    save_schema,
    save_schema_from_yaml,
    schema_exists,
)
from .schema_validate import ValidationResult, validate_schema_doc, validate_schema_yaml_text

# -----------------------------------------------------------------------------
# Duplicate route guard
# -----------------------------------------------------------------------------

_ROUTES_REGISTERED = False


def _json(ok: bool, **data: Any) -> web.Response:
    return web.json_response({"ok": ok, **data})


def _bad_request(message: str, **data: Any) -> web.Response:
    return _json(False, error=message, **data)


def _get_prompt_server_routes():
    """
    Return the ComfyUI routes registry if running inside ComfyUI, else None.

    ComfyUI typically exposes:
      from server import PromptServer
      PromptServer.instance.routes

    We keep this import soft so the module can be imported outside ComfyUI.
    """
    try:
        from server import PromptServer  # type: ignore
    except Exception:
        return None

    try:
        return PromptServer.instance.routes
    except Exception:
        return None


def _validation_payload(result: ValidationResult) -> dict[str, Any]:
    return {
        "ok": bool(result.ok),
        "errors": [{"path": e.path, "message": e.message} for e in (result.errors or [])],
    }


def _extract_validation_flags(payload: Dict[str, Any]) -> tuple[bool, bool]:
    """
    validate:
      - if True: run validation and include it in the response (and optionally block saves)
      - if False: skip validation entirely
    strict:
      - if True: reject save when validation errors exist
      - if False: treat validation errors as warnings (save still proceeds)
    """
    validate = payload.get("validate", True)
    strict = payload.get("strict", False)

    # Be permissive: accept common stringy inputs
    def to_bool(v: Any, default: bool) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)):
            return bool(v)
        if isinstance(v, str):
            s = v.strip().lower()
            if s in {"1", "true", "yes", "y", "on"}:
                return True
            if s in {"0", "false", "no", "n", "off"}:
                return False
        return default

    return to_bool(validate, True), to_bool(strict, False)


def register_routes() -> None:
    """
    Register ComfyData backend API routes with ComfyUI (if available).

    Safe to call multiple times. ComfyUI will error on duplicate routes,
    so we guard with a module-level flag.
    """
    global _ROUTES_REGISTERED

    if _ROUTES_REGISTERED:
        return

    routes = _get_prompt_server_routes()
    if routes is None:
        return

    ensure_storage_dirs()

    # Mark as registered *before* adding decorators, so even if something below
    # throws, we won't repeatedly attempt to register on subsequent imports.
    _ROUTES_REGISTERED = True

    # -------------------------
    # Schema listing + loading
    # -------------------------

    @routes.get("/comfydata/schemas")
    async def get_schemas(_request: web.Request) -> web.Response:
        try:
            schemas = list_schema_names()
            return _json(True, schemas=schemas)
        except Exception as e:
            return _json(False, error=str(e))

    @routes.get("/comfydata/schema")
    async def get_schema(request: web.Request) -> web.Response:
        name = (request.query.get("name") or "").strip()
        if not name:
            return _bad_request("Missing required query parameter: name")

        try:
            loaded = load_schema(name)
            return _json(True, name=loaded.name, doc=loaded.doc, path=str(loaded.path))
        except FileNotFoundError:
            return _json(False, error=f"Schema not found: {name}")
        except SchemaIOError as e:
            return _json(False, error=str(e))
        except Exception as e:
            return _json(False, error=str(e))

    @routes.get("/comfydata/schema/exists")
    async def get_schema_exists(request: web.Request) -> web.Response:
        name = (request.query.get("name") or "").strip()
        if not name:
            return _bad_request("Missing required query parameter: name")

        try:
            return _json(True, name=name, exists=schema_exists(name))
        except Exception as e:
            return _json(False, error=str(e))

    # -------------------------
    # Validation endpoint (new)
    # -------------------------

    @routes.post("/comfydata/schema/validate")
    async def post_schema_validate(request: web.Request) -> web.Response:
        """
        Validate a schema doc or raw YAML without saving.

        Accepts JSON body:
          - doc: dict   OR
          - yaml: str

        Returns:
          { ok: true, validation: { ok: bool, errors: [{path, message}, ...] } }
        """
        try:
            payload: Dict[str, Any] = await request.json()
        except Exception:
            return _bad_request("Request body must be JSON")

        doc = payload.get("doc")
        yaml_text = payload.get("yaml")

        try:
            if doc is not None:
                if not isinstance(doc, dict):
                    return _bad_request("Field 'doc' must be a JSON object (dict).")
                vr = validate_schema_doc(doc)
                return _json(True, validation=_validation_payload(vr))

            if yaml_text is not None:
                if not isinstance(yaml_text, str):
                    return _bad_request("Field 'yaml' must be a string.")
                vr = validate_schema_yaml_text(yaml_text)
                return _json(True, validation=_validation_payload(vr))

            return _bad_request("Must provide either 'doc' (dict) or 'yaml' (string).")
        except Exception as e:
            return _json(False, error=str(e))

    # -------------------------
    # Save / Delete
    # -------------------------

    @routes.post("/comfydata/schema/save")
    async def post_schema_save(request: web.Request) -> web.Response:
        """
        Save a schema by name.

        Accepts JSON body:
          - name: str (filename identity)
          - doc: dict (full schema doc)   OR
          - yaml: str (yaml text)
          - validate: bool (default True)  -> include validation in response
          - strict: bool (default False)   -> reject save when validation errors exist

        One of doc/yaml must be provided.
        """
        try:
            payload: Dict[str, Any] = await request.json()
        except Exception:
            return _bad_request("Request body must be JSON")

        name = str(payload.get("name", "")).strip()
        if not name:
            return _bad_request("Missing required field: name")

        doc = payload.get("doc")
        yaml_text = payload.get("yaml")
        do_validate, strict = _extract_validation_flags(payload)

        validation: Optional[ValidationResult] = None

        try:
            if doc is not None:
                if not isinstance(doc, dict):
                    return _bad_request("Field 'doc' must be a JSON object (dict).")

                if do_validate:
                    validation = validate_schema_doc(doc)
                    if strict and not validation.ok:
                        return _json(
                            False,
                            error="Validation failed (strict=true).",
                            validation=_validation_payload(validation),
                        )

                path = save_schema(name, doc)
                resp: dict[str, Any] = {"name": name, "path": str(path)}
                if validation is not None:
                    resp["validation"] = _validation_payload(validation)
                return _json(True, **resp)

            if yaml_text is not None:
                if not isinstance(yaml_text, str):
                    return _bad_request("Field 'yaml' must be a string.")

                if do_validate:
                    validation = validate_schema_yaml_text(yaml_text)
                    if strict and not validation.ok:
                        return _json(
                            False,
                            error="Validation failed (strict=true).",
                            validation=_validation_payload(validation),
                        )

                path = save_schema_from_yaml(name, yaml_text)
                resp = {"name": name, "path": str(path)}
                if validation is not None:
                    resp["validation"] = _validation_payload(validation)
                return _json(True, **resp)

            return _bad_request("Must provide either 'doc' (dict) or 'yaml' (string).")

        except SchemaIOError as e:
            return _json(False, error=str(e))
        except ValueError as e:
            # sanitize_schema_name may raise ValueError
            return _json(False, error=str(e))
        except Exception as e:
            return _json(False, error=str(e))

    @routes.post("/comfydata/schema/delete")
    async def post_schema_delete(request: web.Request) -> web.Response:
        """
        Delete a schema by name.

        Accepts JSON body:
          - name: str
        """
        try:
            payload: Dict[str, Any] = await request.json()
        except Exception:
            return _bad_request("Request body must be JSON")

        name = str(payload.get("name", "")).strip()
        if not name:
            return _bad_request("Missing required field: name")

        try:
            deleted = delete_schema(name)
            return _json(True, name=name, deleted=deleted)
        except ValueError as e:
            return _json(False, error=str(e))
        except Exception as e:
            return _json(False, error=str(e))


# -----------------------------------------------------------------------------
# Auto-register on import (safe no-op outside ComfyUI)
# -----------------------------------------------------------------------------
register_routes()

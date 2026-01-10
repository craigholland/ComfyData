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


def register_routes() -> None:
    """
    Register ComfyData backend API routes with ComfyUI (if available).

    Safe to call multiple times (ComfyUI will error on duplicate routes, so we
    guard with a module-level flag).
    """
    routes = _get_prompt_server_routes()
    if routes is None:
        return

    ensure_storage_dirs()

    # NOTE: ComfyUI uses aiohttp; PromptServer.instance.routes behaves like a route table.
    # We'll add endpoints under /comfydata/*

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

    @routes.post("/comfydata/schema/save")
    async def post_schema_save(request: web.Request) -> web.Response:
        """
        Save a schema by name.

        Accepts JSON body:
          - name: str (filename identity)
          - doc: dict (full schema doc)   OR
          - yaml: str (yaml text)

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

        try:
            if doc is not None:
                if not isinstance(doc, dict):
                    return _bad_request("Field 'doc' must be a JSON object (dict).")
                path = save_schema(name, doc)
                return _json(True, name=name, path=str(path))
            if yaml_text is not None:
                if not isinstance(yaml_text, str):
                    return _bad_request("Field 'yaml' must be a string.")
                path = save_schema_from_yaml(name, yaml_text)
                return _json(True, name=name, path=str(path))

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

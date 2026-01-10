"""
ComfyData - ComfyUI custom nodes plugin.

This is the plugin entrypoint. ComfyUI imports this module to discover:
- NODE_CLASS_MAPPINGS / NODE_DISPLAY_NAME_MAPPINGS
- WEB_DIRECTORY (optional), which enables loading frontend JS from ./web

Backend HTTP routes are registered on import via py.api (guarded so the
package can still be imported outside of ComfyUI without hard failure).
"""

from __future__ import annotations

from typing import Dict, Type

# ComfyUI will load JavaScript from this folder if provided.
WEB_DIRECTORY = "./web"

from .py.nodes.schema_editor import ComfyDataSchemaEditor

# ---------------------------------------------------------------------
# ComfyUI Node Registration
# ---------------------------------------------------------------------

NODE_CLASS_MAPPINGS: Dict[str, Type] = {
    "ComfyDataSchemaEditor": ComfyDataSchemaEditor,
}

NODE_DISPLAY_NAME_MAPPINGS: Dict[str, str] = {
    "ComfyDataSchemaEditor": "ComfyData – Schema Editor",
}



def _try_register_api_routes() -> None:
    """
    Register backend HTTP endpoints with the ComfyUI PromptServer if available.

    This is safe to call during import; if ComfyUI isn't running, it no-ops.
    """
    try:
        from .py import api as _api  # noqa: F401
    except Exception:
        # Intentionally swallow all errors here.
        # When running inside ComfyUI, we'll see plugin load errors in the console
        # if something truly breaks. Outside ComfyUI, this keeps imports safe.
        return


_try_register_api_routes()

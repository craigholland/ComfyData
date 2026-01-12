// ComfyData – Sync Helpers (web/functions/sync.js)
//
// Purpose
// - Centralize the “state sync” patterns used by the canvas editor.
// - Keep call-sites consistent and small:
//     setState() -> syncYamlWidget() -> setDirtyCanvas()
//
// What this file DOES
// - Syncs the hidden `schema_yaml` widget (debug/output) from the editor state
// - Provides “commit” helpers to apply state + redraw
//
// What this file does NOT do
// - API calls / persistence (api.js)
// - UI drawing / hit-testing (draw.js, hit_test.js, etc.)

import { getState, setState, getSchemaYamlWidget } from "./state.js";
import { buildDocFromState, dumpYamlish } from "./yamlish.js";

/**
 * Updates the hidden `schema_yaml` widget from the node's current editor state.
 * Non-fatal: any errors are swallowed to avoid breaking the UI loop.
 */
export function syncYamlWidget(node) {
  try {
    const state = getState(node);
    const doc = buildDocFromState(state);
    const w = getSchemaYamlWidget(node);
    if (w) w.value = dumpYamlish(doc);
  } catch (_) {
    // Intentionally non-fatal.
  }
}

/**
 * Commits an editor state to the node:
 *  - setState(node, state)
 *  - syncYamlWidget(node)  (optional)
 *  - node.setDirtyCanvas(true, true) (optional)
 *
 * Returns the committed state (handy for call-sites).
 */
export function commitState(node, state, opts = {}) {
  const { syncYaml = true, dirty = true } = opts;

  setState(node, state);

  if (syncYaml) syncYamlWidget(node);

  if (dirty && typeof node?.setDirtyCanvas === "function") {
    node.setDirtyCanvas(true, true);
  }

  return state;
}

/**
 * Convenience helper:
 * - pulls current state
 * - calls `mutate(state)` (you mutate in-place)
 * - commits the result
 *
 * Useful to reduce repeated boilerplate at call sites.
 */
export function withState(node, mutate, opts = {}) {
  const state = getState(node);
  try {
    mutate?.(state);
  } finally {
    commitState(node, state, opts);
  }
  return state;
}

/**
 * Convenience helper to replace state with a fresh state object and redraw.
 * Returns the committed state.
 */
export function replaceState(node, nextState, opts = {}) {
  return commitState(node, nextState, opts);
}

/**
 * Alias used by comfydata_schema_editor.js call-sites.
 * This is intentionally named to match the import in the main file.
 *
 * Returns the committed state.
 */
export function commitNewState(node, nextState, opts = {}) {
  return commitState(node, nextState, opts);
}

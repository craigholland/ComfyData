// ComfyData – Sync Helpers (web/functions/sync.js)
//
// Purpose
// - Centralize the “state sync” patterns used by the canvas editor.
// - Keep call-sites consistent and small:
//     setState() -> syncYamlWidget() -> setDirtyCanvas()
//
// What this file DOES
// - syncs the hidden `schema_yaml` widget (debug/output) from the editor state
// - provides a single “commit” helper to apply state + redraw
//
// What this file does NOT do
// - API calls / persistence (that lives in api.js)
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
 *  - syncYamlWidget(node)
 *  - node.setDirtyCanvas(true, true)
 *
 * Returns the committed state (so call sites can do: state = commitState(node, state))
 */
export function commitState(node, state, opts = {}) {
  const { syncYaml = true, dirty = true } = opts;

  setState(node, state);

  if (syncYaml) {
    syncYamlWidget(node);
  }

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
 * Returns the committed state.
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
 *
 * Returns the committed state.
 */
export function replaceState(node, nextState, opts = {}) {
  return commitState(node, nextState, opts);
}

/**
 * Optional alias to make intent explicit at call sites.
 * (If your editor imports commitNewState, point it here.)
 */
export function commitNewState(node, nextState, opts = {}) {
  return commitState(node, nextState, opts);
}

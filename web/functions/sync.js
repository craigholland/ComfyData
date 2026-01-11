// ComfyData – Sync Utilities (Frontend)
//
// Purpose
// - Centralize the editor “commit” flow used throughout the schema editor UI.
// - Keep state persistence + debug widget sync + canvas redraw in one place.
//
// Responsibilities
// - syncYamlWidget(node): Writes a YAML-ish debug view of the current editor doc into the hidden schema_yaml widget.
// - commitState(node, state): Persists state to node.properties, syncs the YAML widget, and dirties the canvas.
// - commitNewState(node, newState): Replaces editor state and performs the same commit flow.
//
// Notes
// - All functions are designed to be non-throwing. Failures are treated as non-fatal (debug widget only).
// - This file should NOT show toasts; the caller decides when to notify the user.

import { buildDocFromState } from "./doc.js";
import { dumpYamlish } from "./yaml.js";
import { getSchemaYamlWidget } from "./widgets.js";
import { getState, setState } from "./state.js";

/**
 * Sync the hidden schema_yaml widget (debug/output) from the node's current state.
 * Non-fatal: if anything fails, we just skip updating the widget.
 */
export function syncYamlWidget(node) {
  try {
    const state = getState(node);
    const doc = buildDocFromState(state);
    const w = getSchemaYamlWidget(node);
    if (w) w.value = dumpYamlish(doc);
  } catch (_) {
    // Non-fatal; schema_yaml is debug/output only
  }
}

/**
 * Commit an existing (possibly mutated) state object onto the node, sync widgets, and redraw.
 */
export function commitState(node, state) {
  setState(node, state);
  syncYamlWidget(node);

  // LiteGraph nodes expose setDirtyCanvas; safe-guard just in case
  try {
    node?.setDirtyCanvas?.(true, true);
  } catch (_) {
    // ignore
  }
}

/**
 * Replace current editor state with a new object and commit it.
 * Returns the new state for convenience.
 */
export function commitNewState(node, newState) {
  commitState(node, newState);
  return newState;
}

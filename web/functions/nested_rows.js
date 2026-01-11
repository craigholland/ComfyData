// ComfyData – Nested Object Row Helpers
//
// Purpose:
// - Support Phase D nested object rendering and edits by:
//   - Flattening nested field trees into a linear row list for drawing.
//   - Resolving fields by path (array of indexes) for stable hit testing.
//
// Notes:
// - Paths are arrays of indices, e.g. [0,2,1] meaning:
//     root.fields[0].fields[2].fields[1]

import { ensureFieldShape } from "./state.js";

export function pathKey(path) {
  return (path || []).join(".");
}

export function getFieldByPath(state, path) {
  let list = state.fields;
  let cur = null;

  for (let i = 0; i < (path || []).length; i++) {
    const idx = path[i];
    if (!Array.isArray(list) || idx < 0 || idx >= list.length) return null;

    cur = ensureFieldShape(list[idx]);
    if (i === path.length - 1) return cur;

    // descend
    if (cur.type !== "object") return null;
    if (!Array.isArray(cur.fields)) cur.fields = [];
    list = cur.fields;
  }
  return cur;
}

export function getFieldsListAtPath(state, parentPath) {
  // parentPath points to an object field; its children live in that field.fields
  if (!parentPath || parentPath.length === 0) return state.fields;

  const parent = getFieldByPath(state, parentPath);
  if (!parent || parent.type !== "object") return null;
  if (!Array.isArray(parent.fields)) parent.fields = [];
  return parent.fields;
}

export function flattenRows(fields, depth = 0, basePath = []) {
  const out = [];
  const list = Array.isArray(fields) ? fields : [];

  for (let i = 0; i < list.length; i++) {
    const f = ensureFieldShape(list[i]);
    const p = basePath.concat([i]);

    out.push({ kind: "field", path: p, depth, field: f });

    if (f.type === "object" && f.expanded) {
      out.push(...flattenRows(f.fields || [], depth + 1, p));
      // Option A: add-child row
      out.push({ kind: "add_child", parentPath: p, depth: depth + 1 });
    }
  }

  return out;
}

export function newPlaceholderField() {
  return ensureFieldShape({ name: "", type: "str" });
}

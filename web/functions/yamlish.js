// ComfyData – Schema <-> State Conversion + YAML-ish Debug Dump
//
// Purpose:
// - Convert between the UI editor state (array-of-rows form) and the persisted
//   schema document shape:
//     { schema: { name, fields } }
// - Provide a human-readable "YAML-ish" dump for the hidden schema_yaml widget
//   (debug/output only; not a strict YAML emitter).

import { PRIMITIVE_TYPES } from "./constants.js";
import { ensureFieldShape, defaultState } from "./state.js";

export function buildFieldsDocFromList(fieldsList) {
  const fields = {};
  for (const f0 of fieldsList || []) {
    const f = ensureFieldShape({ ...f0 });
    const name = (f.name || "").trim();
    if (!name) continue;

    if (PRIMITIVE_TYPES.includes(f.type)) {
      fields[name] = f.type;
      continue;
    }

    if (f.type === "single-select") {
      const csv = (f.values_csv || "").trim();
      const values = csv
        ? csv
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
      fields[name] = { type: "single-select", values };
      continue;
    }

    if (f.type === "object") {
      fields[name] = { type: "object", fields: buildFieldsDocFromList(f.fields || []) };
    }
  }
  return fields;
}

export function buildDocFromState(state) {
  return {
    schema: {
      name: (state.schema_name || "").trim(),
      fields: buildFieldsDocFromList(state.fields),
    },
  };
}

export function docFieldsToStateList(fieldsObj) {
  const out = [];
  const fields = fieldsObj || {};
  if (!fields || typeof fields !== "object") return out;

  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") {
      out.push(ensureFieldShape({ name: k, type: v }));
      continue;
    }

    if (!v || typeof v !== "object") continue;
    const t = v.type;

    if (t === "single-select") {
      const values = Array.isArray(v.values) ? v.values : [];
      out.push(
        ensureFieldShape({
          name: k,
          type: "single-select",
          values_csv: values.join(", "),
        })
      );
      continue;
    }

    if (t === "object") {
      out.push(
        ensureFieldShape({
          name: k,
          type: "object",
          fields: docFieldsToStateList(v.fields || {}),
          expanded: false,
        })
      );
    }
  }

  return out;
}

export function docToState(doc) {
  const out = defaultState();
  const schema = doc?.schema;
  out.schema_name = String(schema?.name || "");
  out.fields = docFieldsToStateList(schema?.fields || {});
  return out;
}

export function dumpYamlish(doc) {
  const schemaName = doc?.schema?.name ?? "";
  const fields = doc?.schema?.fields ?? {};
  const lines = [];

  function dumpFields(obj, indent) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (typeof v === "string") {
        lines.push(`${" ".repeat(indent)}${k}: ${v}`);
        continue;
      }

      if (!v || typeof v !== "object") continue;

      lines.push(`${" ".repeat(indent)}${k}:`);
      lines.push(`${" ".repeat(indent + 2)}type: ${v.type}`);

      if (v.type === "single-select") {
        lines.push(`${" ".repeat(indent + 2)}values:`);
        const vals = Array.isArray(v.values) ? v.values : [];
        for (const item of vals) lines.push(`${" ".repeat(indent + 4)}- ${item}`);
      } else if (v.type === "object") {
        lines.push(`${" ".repeat(indent + 2)}fields:`);
        dumpFields(v.fields || {}, indent + 4);
      }
    }
  }

  lines.push("schema:");
  lines.push(`  name: ${schemaName}`);
  lines.push("  fields:");
  dumpFields(fields, 4);

  return lines.join("\n");
}

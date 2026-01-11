// ComfyData - YAML-ish Serialization Helpers
//
// Responsibility:
// - Build/parse schema documents between editor-state and ComfyData's schema YAML model.
// - Provide a human-readable "YAML-ish" dump for the hidden debug widget.
//
// Exports:
// - buildDocFromState(state)
// - docToState(doc)
// - dumpYamlish(doc)

function buildFieldsDocFromList(fieldsList) {
  const fields = {};
  for (const f0 of fieldsList || []) {
    const f = ensureFieldShape({ ...f0 });
    const name = (f.name || "").trim();
    if (!name) continue;

    if (PRIMITIVE_TYPES.includes(f.type)) {
      fields[name] = f.type;
    } else if (f.type === "single-select") {
      const csv = (f.values_csv || "").trim();
      const values = csv
        ? csv
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : [];
      fields[name] = { type: "single-select", values };
    } else if (f.type === "object") {
      fields[name] = { type: "object", fields: buildFieldsDocFromList(f.fields || []) };
    }
  }
  return fields;
}

function buildDocFromState(state) {
  return {
    schema: {
      name: (state.schema_name || "").trim(),
      fields: buildFieldsDocFromList(state.fields),
    },
  };
}

function docFieldsToStateList(fieldsObj) {
  const out = [];
  const fields = fieldsObj || {};

  if (fields && typeof fields === "object") {
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v === "string") {
        out.push(ensureFieldShape({ name: k, type: v }));
        continue;
      }

      if (v && typeof v === "object") {
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
        } else if (t === "object") {
          out.push(
            ensureFieldShape({
              name: k,
              type: "object",
              fields: docFieldsToStateList(v.fields || {}),
              expanded: false, // collapsed by default on load
            })
          );
        }
      }
    }
  }

  return out;
}

function docToState(doc) {
  const out = defaultState();
  const schema = doc?.schema;
  out.schema_name = String(schema?.name || "");
  out.fields = docFieldsToStateList(schema?.fields || {});
  return out;
}

// YAML-ish dump for output/debug
function dumpYamlish(doc) {
  const schemaName = doc?.schema?.name ?? "";
  const fields = doc?.schema?.fields ?? {};
  const lines = [];

  function dumpFields(obj, indent) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (typeof v === "string") {
        lines.push(`${" ".repeat(indent)}${k}: ${v}`);
      } else if (v && typeof v === "object") {
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
  }

  lines.push("schema:");
  lines.push(`  name: ${schemaName}`);
  lines.push("  fields:");
  dumpFields(fields, 4);

  return lines.join("\n");
}

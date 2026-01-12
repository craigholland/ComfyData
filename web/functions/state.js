// ComfyData – Editor State Utilities

export function defaultState() {
  return {
    schema_name: "",
    fields: [], // field: { name, type, values_csv?, fields?, expanded?, required?, ref? }

    // scrolling (rows) for large schemas/nested objects
    scroll_row: 0,
    validation: null, // { ok: boolean, errors: [{ path, message }] } or null
  };
}

export function ensureFieldShape(f) {
  if (!f || typeof f !== "object") return { name: "", type: "str" };
  if (typeof f.name !== "string") f.name = "";
  if (typeof f.type !== "string") f.type = "str";

  if (f.type === "single-select" && typeof f.values_csv !== "string") {
    f.values_csv = f.values_csv ?? "";
  }

  if (f.type === "object") {
    if (!Array.isArray(f.fields)) f.fields = [];
    if (typeof f.expanded !== "boolean") f.expanded = false;
  } else {
    delete f.fields;
    delete f.expanded;
  }

  if (f.type === "ref") {
    if (typeof f.ref !== "string") f.ref = f.ref ?? "";
  } else {
    delete f.ref;
  }

  if (typeof f.required !== "boolean") f.required = false;
  return f;
}

export function getState(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties.comfydata_state) node.properties.comfydata_state = defaultState();

  const s = node.properties.comfydata_state;
  if (!Array.isArray(s.fields)) s.fields = [];
  if (typeof s.schema_name !== "string") s.schema_name = "";

  if (typeof s.scroll_row !== "number" || !Number.isFinite(s.scroll_row)) s.scroll_row = 0;
  s.scroll_row = Math.max(0, Math.floor(s.scroll_row));
  if (s.validation !== null && typeof s.validation !== "object") s.validation = null;
  if (s.validation && !Array.isArray(s.validation.errors)) s.validation.errors = [];

  s.fields = s.fields.map((f) => ensureFieldShape(f));
  return s;
}

export function setState(node, newState) {
  if (!node.properties) node.properties = {};
  node.properties.comfydata_state = newState;
}

export function getSchemaYamlWidget(node) {
  if (!node.widgets) return null;
  return node.widgets.find((w) => w && w.name === "schema_yaml") || null;
}

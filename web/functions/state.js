// ComfyData - Editor State Model
//
// Responsibility:
// - Define default editor state shape and enforce/normalize field structures.
// - Read/write node.properties.comfydata_state.
//
// Exports:
// - defaultState()
// - ensureFieldShape(field)
// - getState(node)
// - setState(node, state)

function defaultState() {
  return {
    schema_name: "",
    fields: [], // field: { name, type, values_csv?, fields?, expanded?, required? }
  };
}

function ensureFieldShape(f) {
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
    // keep schema clean if leaving object
    delete f.fields;
    delete f.expanded;
  }

  if (typeof f.required !== "boolean") f.required = false;
  return f;
}

function getState(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties.comfydata_state) node.properties.comfydata_state = defaultState();

  const s = node.properties.comfydata_state;
  if (!Array.isArray(s.fields)) s.fields = [];
  if (typeof s.schema_name !== "string") s.schema_name = "";

  // normalize shape
  s.fields = s.fields.map((f) => ensureFieldShape(f));

  return s;
}

function setState(node, newState) {
  if (!node.properties) node.properties = {};
  node.properties.comfydata_state = newState;
}

function getSchemaYamlWidget(node) {
  if (!node.widgets) return null;
  return node.widgets.find((w) => w && w.name === "schema_yaml") || null;
}

const EXT_NAME = "ComfyData.SchemaEditor";
const TARGET_NODE_TYPE = "ComfyDataSchemaEditor";

const PRIMITIVE_TYPES = ["uuid", "int", "str", "decimal"];
const FIELD_TYPES = ["uuid", "int", "str", "decimal", "single-select", "object"];

// Layout constants
const UI = {
  pad: 8,
  rowH: 22,
  btnH: 20,
  headerH: 26,
  colNameW: 150,
  colTypeW: 110,
  colValsW: 180,
  colRemoveW: 22,
  indentW: 18,
};
// ComfyData – Web UI Constants
//
// Purpose:
// - Centralize constants shared across the ComfyData Schema Editor frontend.
// - Keep the main editor file small and focused on node lifecycle + orchestration.
//
// Notes:
// - These values are intentionally plain exports (no side effects).
// - Layout values are in node-local canvas coordinates.

export const EXT_NAME = "ComfyData.SchemaEditor";
export const TARGET_NODE_TYPE = "ComfyDataSchemaEditor";

export const PRIMITIVE_TYPES = ["uuid", "int", "str", "decimal"];
export const FIELD_TYPES = ["uuid", "int", "str", "decimal", "single-select", "object"];

// Layout constants
export const UI = {
  pad: 8,
  rowH: 22,
  btnH: 20,
  headerH: 26,
  colNameW: 150,
  colTypeW: 110,
  colValsW: 180,
  colRemoveW: 22,
  indentW: 18, // nested object indentation
};

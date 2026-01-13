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
export const FIELD_TYPES = ["uuid", "int", "str", "decimal", "single-select", "object", "ref"];

// Layout constants
export const UI = {
  pad: 4,
  rowH: 16,
  btnH: 16,
  headerH: 20,
  colNameW: 90,
  colTypeW: 80,
  colValsW: 150,
  colRemoveW: 16,
  indentW: 12, // nested object indentation
};

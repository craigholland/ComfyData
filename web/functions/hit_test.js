// ComfyData – Hit Testing Helpers
//
// Purpose:
// - Provide lightweight point-in-rect checks for canvas-drawn UI.
//
// Notes:
// - All coordinates here are *node-local* coordinates (not screen space).
// - The Schema Editor stores these rects in node._comfydata_hits.

export function hit(pt, rect) {
  return pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h;
}

// ComfyData – Mouse Capture Hook (web/functions/mouse_capture.js)
//
// Purpose
// - Prevent ComfyUI/LiteGraph canvas from “stealing” pointer events intended for
//   our inline HTML editors (input/textarea overlays).
// - This is a defensive, low-risk hook: it only stops events when the event
//   originated from an element inside our overlay container.
//
// Notes
// - The Schema Editor draws UI on the canvas, but inline editing uses real DOM
//   inputs layered on top of the canvas.
// - Without capture-phase stopping, LiteGraph can interpret clicks/drags as node
//   interactions and interfere with typing/selection.
//
// Contract
// - `installMouseCaptureHook()` is safe to call multiple times.
// - If the canvas or app isn’t ready yet, it fails gracefully (no throw).

import { app } from "../../../scripts/app.js";

let _installed = false;

/**
 * Install capture-phase event listeners to keep LiteGraph from intercepting
 * events that belong to our inline editor DOM overlays.
 */
export function installMouseCaptureHook() {
  if (_installed) return;
  _installed = true;

  const canvasEl = app?.canvas?.canvas;
  if (!canvasEl || typeof canvasEl.addEventListener !== "function") return;

  // Anything inside this container class is considered “ours”.
  // (Your inline editor helpers should attach this class to the overlay root.)
  const isInInlineEditor = (target) => {
    try {
      return !!target?.closest?.(".comfydata-inline-editor");
    } catch (_) {
      return false;
    }
  };

  const stopIfInline = (ev) => {
    if (!ev) return;
    const t = ev.target;
    if (!t) return;

    if (isInInlineEditor(t)) {
      ev.stopPropagation();
      // Don’t call preventDefault universally here; allow text selection/caret.
      // Individual editors can preventDefault on Enter/Escape as needed.
    }
  };

  // Capture phase so we beat LiteGraph’s handlers.
  canvasEl.addEventListener("pointerdown", stopIfInline, true);
  canvasEl.addEventListener("mousedown", stopIfInline, true);
  canvasEl.addEventListener("mouseup", stopIfInline, true);
  canvasEl.addEventListener("click", stopIfInline, true);
  canvasEl.addEventListener("dblclick", stopIfInline, true);

  // Wheel events can also trigger canvas zoom/scroll while editing.
  canvasEl.addEventListener(
    "wheel",
    (ev) => {
      if (isInInlineEditor(ev?.target)) {
        ev.stopPropagation();
        // Let the textarea scroll normally.
      }
    },
    true
  );
}

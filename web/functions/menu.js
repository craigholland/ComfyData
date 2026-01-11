// ComfyData – Context Menu + Mouse Anchor Helpers
//
// Purpose:
// - Provide a consistent way to show LiteGraph context menus for simple pickers.
// - Capture the last DOM mouse event so menus can be anchored correctly even
//   when LiteGraph only gives graph coordinates.
//
// Notes:
// - LiteGraph.ContextMenu is a global provided by ComfyUI/LiteGraph.
// - We store the last mouse event in-module to avoid polluting window globals.

let LAST_MOUSE_EVENT = null;

export function captureMouseEvent(evt) {
  if (evt && typeof evt.clientX === "number" && typeof evt.clientY === "number") {
    LAST_MOUSE_EVENT = evt;
  }
}

export function getLastMouseEvent() {
  return LAST_MOUSE_EVENT;
}

export function makeContextMenu(values, onPick, evt) {
  const items = (values || []).map((v) => ({ content: v, value: v }));

  const anchorEvt =
    evt && typeof evt.clientX === "number" && typeof evt.clientY === "number" ? evt : LAST_MOUSE_EVENT;

  // eslint-disable-next-line no-undef
  new LiteGraph.ContextMenu(items, {
    event: anchorEvt || null,
    callback: (item) => {
      if (!item) return;
      onPick?.(item.value ?? item.content);
    },
  });
}

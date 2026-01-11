
let LAST_MOUSE_EVENT = null;

function captureMouseEvent(evt) {
  if (evt && typeof evt.clientX === "number" && typeof evt.clientY === "number") {
    LAST_MOUSE_EVENT = evt;
  }
}

function hit(pt, rect) {
  return pt.x >= rect.x && pt.x <= rect.x + rect.w && pt.y >= rect.y && pt.y <= rect.y + rect.h;
}

function makeContextMenu(values, onPick, evt) {
  const items = values.map((v) => ({ content: v, value: v }));

  const anchorEvt =
    evt && typeof evt.clientX === "number" && typeof evt.clientY === "number" ? evt : LAST_MOUSE_EVENT;

  // eslint-disable-next-line no-undef
  new LiteGraph.ContextMenu(items, {
    event: anchorEvt || null,
    callback: (item) => {
      if (!item) return;
      onPick(item.value ?? item.content);
    },
  });
}

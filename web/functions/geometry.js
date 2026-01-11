function getCanvasElement() {
  return app?.canvas?.canvas || app?.canvas?.canvas_element || null;
}

function toScreenRect(node, rect) {
  const gc = app?.canvas;
  const canvasEl = getCanvasElement();
  if (!gc || !canvasEl) return null;

  const scale = gc.ds?.scale ?? 1;
  const offx = gc.ds?.offset?.[0] ?? 0;
  const offy = gc.ds?.offset?.[1] ?? 0;

  // node-local -> graph coords
  const gx = node.pos[0] + rect.x;
  const gy = node.pos[1] + rect.y;

  // graph -> canvas pixels
  const cx = (gx + offx) * scale;
  const cy = (gy + offy) * scale;

  const canvasBounds = canvasEl.getBoundingClientRect();
  return {
    left: canvasBounds.left + cx,
    top: canvasBounds.top + cy,
    width: rect.w * scale,
    height: rect.h * scale,
  };
}

// ComfyData – Canvas Drawing Primitives
//
// Purpose:
// - Provide small, reusable canvas drawing helpers for the Schema Editor UI.
//
// Notes:
// - These functions intentionally avoid global state.
// - Styling is kept simple and in one place to keep UX consistent.

export function ensureNodeSize(node, minW = 560, minH = 300) {
  node.size[0] = Math.max(node.size[0], minW);
  node.size[1] = Math.max(node.size[1], minH);
}

export function drawButton(ctx, x, y, w, h, label) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "12px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(String(label ?? ""), x + 8, y + h / 2);
  ctx.restore();
}

export function drawChip(ctx, x, y, w, h, text) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fillStyle = "rgba(80,160,255,0.14)";
  ctx.fill();
  ctx.strokeStyle = "rgba(80,160,255,0.28)";
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = "12px sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(String(text ?? ""), x + 8, y + h / 2);
  ctx.restore();
}

export function drawX(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fillStyle = "rgba(255,80,80,0.12)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,80,80,0.26)";
  ctx.stroke();

  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 6, y + 6);
  ctx.lineTo(x + w - 6, y + h - 6);
  ctx.moveTo(x + w - 6, y + 6);
  ctx.lineTo(x + 6, y + h - 6);
  ctx.stroke();
  ctx.restore();
}

export function drawPort(ctx, x, y, kind = "default", r = 5) {
  ctx.save();

  // subtle outer ring
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fill();

  // inner fill (same family, different alpha by kind)
  let fill = "rgba(80,160,255,0.55)";
  let stroke = "rgba(80,160,255,0.95)";
  if (kind === "ref") {
    fill = "rgba(180,120,255,0.55)";
    stroke = "rgba(180,120,255,0.95)";
  } else if (kind === "object") {
    fill = "rgba(80,220,180,0.55)";
    stroke = "rgba(80,220,180,0.95)";
  }

  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = stroke;
  ctx.stroke();

  ctx.restore();
}

export function drawBezierEdge(ctx, x1, y1, x2, y2, kind = "default") {
  ctx.save();

  // control points: horizontal curve
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
  const c1x = x1 + dx;
  const c1y = y1;
  const c2x = x2 - dx;
  const c2y = y2;

  let stroke = "rgba(255,255,255,0.22)";
  if (kind === "ref") stroke = "rgba(180,120,255,0.28)";
  if (kind === "object") stroke = "rgba(80,220,180,0.28)";

  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo(c1x, c1y, c2x, c2y, x2, y2);
  ctx.stroke();

  ctx.restore();
}
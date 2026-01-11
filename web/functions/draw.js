// ComfyData - Canvas Drawing Primitives
//
// Responsibility:
// - Low-level drawing helpers for consistent node UI rendering.
// - Button/chip/delete glyph drawing with rounded rects.
//
// Exports:
// - drawButton(ctx, x, y, w, h, label)
// - drawChip(ctx, x, y, w, h, text)
// - drawX(ctx, x, y, w, h)

function ensureNodeSize(node) {
  const minW = 560;
  const minH = 300;
  node.size[0] = Math.max(node.size[0], minW);
  node.size[1] = Math.max(node.size[1], minH);
}

function drawButton(ctx, x, y, w, h, label) {
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
  ctx.fillText(label, x + 8, y + h / 2);
  ctx.restore();
}

function drawChip(ctx, x, y, w, h, text) {
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
  ctx.fillText(text, x + 8, y + h / 2);
  ctx.restore();
}

function drawX(ctx, x, y, w, h) {
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

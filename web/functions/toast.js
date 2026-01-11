
function showToast(node, message, kind = "info", anchorRect = null, ms = 2200) {
  const canvasEl = getCanvasElement();
  if (!canvasEl) return;

  // Remove any existing toast for this node
  if (node._comfydata_toast_el) {
    try {
      node._comfydata_toast_el.remove();
    } catch (_) {}
    node._comfydata_toast_el = null;
  }

  // Anchor near a rect if given; otherwise anchor to top-left of node
  const fallback = { x: UI.pad, y: UI.pad, w: 220, h: UI.btnH };
  const rect = anchorRect || fallback;

  const screen = toScreenRect(node, rect);
  if (!screen) return;

  const el = document.createElement("div");
  el.textContent = String(message ?? "");

  const top = Math.max(6, Math.round(screen.top - 28));

  el.style.position = "fixed";
  el.style.left = `${Math.round(screen.left)}px`;
  el.style.top = `${top}px`; // slightly above the rect
  el.style.maxWidth = `${Math.max(240, Math.round(screen.width))}px`;
  el.style.zIndex = "10000";
  el.style.padding = "6px 10px";
  el.style.borderRadius = "10px";
  el.style.fontSize = "12px";
  el.style.lineHeight = "16px";
  el.style.backdropFilter = "blur(2px)";
  el.style.border = "1px solid rgba(255,255,255,0.18)";
  el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.35)";
  el.style.color = "rgba(255,255,255,0.92)";

  // Simple kind styling
  if (kind === "error") {
    el.style.background = "rgba(120,30,30,0.92)";
  } else if (kind === "success") {
    el.style.background = "rgba(30,120,60,0.92)";
  } else {
    el.style.background = "rgba(20,20,20,0.92)";
  }

  // Fade-in
  el.style.opacity = "0";
  el.style.transform = "translateY(4px)";
  el.style.transition = "opacity 120ms ease, transform 120ms ease";

  document.body.appendChild(el);
  node._comfydata_toast_el = el;

  // animate in
  requestAnimationFrame(() => {
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";
  });

  // auto dismiss
  const t = setTimeout(() => {
    // animate out
    el.style.opacity = "0";
    el.style.transform = "translateY(4px)";
    setTimeout(() => {
      try {
        el.remove();
      } catch (_) {}
      if (node._comfydata_toast_el === el) node._comfydata_toast_el = null;
    }, 140);
  }, ms);

  // allow click-to-dismiss
  el.addEventListener("mousedown", (ev) => {
    ev.stopPropagation();
    ev.preventDefault();
    clearTimeout(t);
    try {
      el.remove();
    } catch (_) {}
    if (node._comfydata_toast_el === el) node._comfydata_toast_el = null;
  });
}

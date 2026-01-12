// ComfyData – Inline Editing Overlays
//
// Purpose:
// - Provide HTML input/textarea overlays anchored to canvas-drawn rectangles.
// - Replace disruptive modal dialogs (prompt/alert) with inline, in-context edits.
//
// Important:
// - Overlays are wrapped in a container with class "comfydata-inline-editor" so
//   our mouse-capture hook can reliably detect and prevent LiteGraph from stealing events.

import { getCanvasElement, toScreenRect } from "./geometry.js";

function removePriorEditor(node) {
  if (node._comfydata_inline_editor) {
    try {
      node._comfydata_inline_editor.remove();
    } catch (_) {}
    node._comfydata_inline_editor = null;
  }
}

function makeWrapper(screen) {
  const wrap = document.createElement("div");
  wrap.className = "comfydata-inline-editor";
  wrap.style.position = "fixed";
  wrap.style.left = `${Math.round(screen.left)}px`;
  wrap.style.top = `${Math.round(screen.top)}px`;
  wrap.style.width = `${Math.round(screen.width)}px`;
  wrap.style.height = `${Math.round(screen.height)}px`;
  wrap.style.zIndex = "9999";

  // Make sure pointer events are captured by the overlay
  wrap.style.pointerEvents = "auto";
  return wrap;
}

export function beginInlineEdit(node, rect, initialValue, onCommit) {
  const canvasEl = getCanvasElement();
  if (!canvasEl) return;

  removePriorEditor(node);

  const screen = toScreenRect(node, rect);
  if (!screen) return;

  const wrap = makeWrapper({
    ...screen,
    width: Math.max(40, Math.round(screen.width)),
    height: Math.max(18, Math.round(screen.height)),
  });

  const input = document.createElement("input");
  input.type = "text";
  input.value = initialValue ?? "";

  // Style on input (not wrapper) so focus ring / selection feels normal
  input.style.width = "100%";
  input.style.height = "100%";
  input.style.boxSizing = "border-box";
  input.style.fontSize = "12px";
  input.style.padding = "2px 6px";
  input.style.borderRadius = "6px";
  input.style.border = "1px solid rgba(255,255,255,0.25)";
  input.style.color = "white";
  input.style.background = "rgba(20,20,20,0.92)";
  input.style.outline = "none";

  const finish = (commit) => {
    try {
      wrap.remove();
    } catch (_) {}
    if (node._comfydata_inline_editor === wrap) node._comfydata_inline_editor = null;

    if (commit) {
      const v = input.value;
      onCommit?.(v);
    }
    node.setDirtyCanvas(true, true);
  };

  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      finish(true);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      finish(false);
    }
  });

  input.addEventListener("blur", () => finish(true));

  wrap.appendChild(input);
  document.body.appendChild(wrap);
  node._comfydata_inline_editor = wrap;

  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}

export function beginInlineEditTextarea(node, rect, initialValue, onCommit) {
  const canvasEl = getCanvasElement();
  if (!canvasEl) return;

  removePriorEditor(node);

  const screen = toScreenRect(node, rect);
  if (!screen) return;

  const height = Math.max(60, Math.round(screen.height * 3));
  const wrap = makeWrapper({
    ...screen,
    width: Math.max(80, Math.round(screen.width)),
    height,
  });

  const ta = document.createElement("textarea");
  ta.value = initialValue ?? "";

  ta.style.width = "100%";
  ta.style.height = "100%";
  ta.style.boxSizing = "border-box";
  ta.style.fontSize = "12px";
  ta.style.padding = "6px 8px";
  ta.style.borderRadius = "8px";
  ta.style.border = "1px solid rgba(255,255,255,0.25)";
  ta.style.color = "white";
  ta.style.background = "rgba(20,20,20,0.92)";
  ta.style.outline = "none";
  ta.style.resize = "none";
  ta.style.lineHeight = "16px";

  const finish = (commit) => {
    try {
      wrap.remove();
    } catch (_) {}
    if (node._comfydata_inline_editor === wrap) node._comfydata_inline_editor = null;

    if (commit) onCommit?.(ta.value);
    node.setDirtyCanvas(true, true);
  };

  ta.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      ev.preventDefault();
      finish(false);
      return;
    }
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      finish(true);
    }
  });

  ta.addEventListener("blur", () => finish(true));

  wrap.appendChild(ta);
  document.body.appendChild(wrap);
  node._comfydata_inline_editor = wrap;

  setTimeout(() => {
    ta.focus();
    ta.select();
  }, 0);
}

export function normalizeValuesToCsv(text) {
  const raw = String(text ?? "");
  const parts = raw
    .split(/[,|\n]/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set();
  const out = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }

  return out.join(", ");
}


function beginInlineEdit(node, rect, initialValue, onCommit) {
  const canvasEl = getCanvasElement();
  if (!canvasEl) return;

  if (node._comfydata_inline_input) {
    try {
      node._comfydata_inline_input.remove();
    } catch (_) {}
    node._comfydata_inline_input = null;
  }

  const screen = toScreenRect(node, rect);
  if (!screen) return;

  const input = document.createElement("input");
  input.type = "text";
  input.value = initialValue ?? "";

  input.style.position = "fixed";
  input.style.left = `${Math.round(screen.left)}px`;
  input.style.top = `${Math.round(screen.top)}px`;
  input.style.width = `${Math.max(40, Math.round(screen.width))}px`;
  input.style.height = `${Math.max(18, Math.round(screen.height))}px`;
  input.style.zIndex = "9999";
  input.style.fontSize = "12px";
  input.style.padding = "2px 6px";
  input.style.borderRadius = "6px";
  input.style.border = "1px solid rgba(255,255,255,0.25)";
  input.style.color = "white";
  input.style.background = "rgba(20,20,20,0.92)";
  input.style.outline = "none";

  const finish = (commit) => {
    try {
      input.remove();
    } catch (_) {}
    if (node._comfydata_inline_input === input) node._comfydata_inline_input = null;

    if (commit) onCommit?.(input.value);
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

  document.body.appendChild(input);
  node._comfydata_inline_input = input;

  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
}

function normalizeValuesToCsv(text) {
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

function beginInlineEditTextarea(node, rect, initialValue, onCommit) {
  const canvasEl = getCanvasElement();
  if (!canvasEl) return;

  if (node._comfydata_inline_input) {
    try {
      node._comfydata_inline_input.remove();
    } catch (_) {}
    node._comfydata_inline_input = null;
  }

  const screen = toScreenRect(node, rect);
  if (!screen) return;

  const ta = document.createElement("textarea");
  ta.value = initialValue ?? "";

  const height = Math.max(60, Math.round(screen.height * 3));

  ta.style.position = "fixed";
  ta.style.left = `${Math.round(screen.left)}px`;
  ta.style.top = `${Math.round(screen.top)}px`;
  ta.style.width = `${Math.max(80, Math.round(screen.width))}px`;
  ta.style.height = `${height}px`;
  ta.style.zIndex = "9999";
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
      ta.remove();
    } catch (_) {}
    if (node._comfydata_inline_input === ta) node._comfydata_inline_input = null;

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

  document.body.appendChild(ta);
  node._comfydata_inline_input = ta;

  setTimeout(() => {
    ta.focus();
    ta.select();
  }, 0);
}

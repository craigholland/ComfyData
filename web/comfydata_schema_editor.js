// ComfyData Schema Editor - v1
//
// Custom UI layer for ComfyDataSchemaEditor node.
// Draws editor directly on the node canvas and uses backend HTTP endpoints
// for schema persistence.
//
// Endpoints (implemented in Python):
//   GET  /comfydata/schemas
//   GET  /comfydata/schema?name=...
//   POST /comfydata/schema/save   { name, doc }
//
// Notes:
// - Editor state stored in node.properties.comfydata_state
// - schema_yaml widget (hidden) updated with YAML-ish text for debug/output

import { app } from "../../scripts/app.js";

const EXT_NAME = "ComfyData.SchemaEditor";
const TARGET_NODE_TYPE = "ComfyDataSchemaEditor";

const PRIMITIVE_TYPES = ["uuid", "int", "str", "decimal"];
const FIELD_TYPES = ["uuid", "int", "str", "decimal", "single-select", "object"];

// Layout constants
const UI = {
  pad: 8,
  rowH: 22,
  btnH: 20,
  headerH: 26,
  colNameW: 150,
  colTypeW: 110,
  colValsW: 180,
  colRemoveW: 22,
  indentW: 18, // Phase D: nested object indentation
};

let LAST_MOUSE_EVENT = null;

function captureMouseEvent(evt) {
  if (evt && typeof evt.clientX === "number" && typeof evt.clientY === "number") {
    LAST_MOUSE_EVENT = evt;
  }
}

function defaultState() {
  return {
    schema_name: "",
    fields: [], // field: { name, type, values_csv?, fields?, expanded?, required? }
  };
}

function ensureFieldShape(f) {
  if (!f || typeof f !== "object") return { name: "", type: "str" };
  if (typeof f.name !== "string") f.name = "";
  if (typeof f.type !== "string") f.type = "str";
  if (f.type === "single-select" && typeof f.values_csv !== "string") f.values_csv = f.values_csv ?? "";
  if (f.type === "object") {
    if (!Array.isArray(f.fields)) f.fields = [];
    if (typeof f.expanded !== "boolean") f.expanded = false;
  } else {
    // keep schema clean if leaving object
    delete f.fields;
    delete f.expanded;
  }
  if (typeof f.required !== "boolean") f.required = false;
  return f;
}

function getState(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties.comfydata_state) node.properties.comfydata_state = defaultState();

  const s = node.properties.comfydata_state;
  if (!Array.isArray(s.fields)) s.fields = [];
  if (typeof s.schema_name !== "string") s.schema_name = "";

  // normalize shape
  s.fields = s.fields.map((f) => ensureFieldShape(f));

  return s;
}

function setState(node, newState) {
  if (!node.properties) node.properties = {};
  node.properties.comfydata_state = newState;
}

function getSchemaYamlWidget(node) {
  if (!node.widgets) return null;
  return node.widgets.find((w) => w && w.name === "schema_yaml") || null;
}

function buildFieldsDocFromList(fieldsList) {
  const fields = {};
  for (const f0 of fieldsList || []) {
    const f = ensureFieldShape({ ...f0 });
    const name = (f.name || "").trim();
    if (!name) continue;

    if (PRIMITIVE_TYPES.includes(f.type)) {
      fields[name] = f.type;
    } else if (f.type === "single-select") {
      const csv = (f.values_csv || "").trim();
      const values = csv ? csv.split(",").map((x) => x.trim()).filter(Boolean) : [];
      fields[name] = { type: "single-select", values };
    } else if (f.type === "object") {
      fields[name] = { type: "object", fields: buildFieldsDocFromList(f.fields || []) };
    }
  }
  return fields;
}

function buildDocFromState(state) {
  return {
    schema: {
      name: (state.schema_name || "").trim(),
      fields: buildFieldsDocFromList(state.fields),
    },
  };
}

function docFieldsToStateList(fieldsObj) {
  const out = [];
  const fields = fieldsObj || {};
  if (fields && typeof fields === "object") {
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v === "string") {
        out.push(ensureFieldShape({ name: k, type: v }));
      } else if (v && typeof v === "object") {
        const t = v.type;
        if (t === "single-select") {
          const values = Array.isArray(v.values) ? v.values : [];
          out.push(
            ensureFieldShape({
              name: k,
              type: "single-select",
              values_csv: values.join(", "),
            })
          );
        } else if (t === "object") {
          out.push(
            ensureFieldShape({
              name: k,
              type: "object",
              fields: docFieldsToStateList(v.fields || {}),
              expanded: false, // collapsed by default on load
            })
          );
        }
      }
    }
  }
  return out;
}

function docToState(doc) {
  const out = defaultState();
  const schema = doc?.schema;
  out.schema_name = String(schema?.name || "");
  out.fields = docFieldsToStateList(schema?.fields || {});
  return out;
}

// YAML-ish dump for output/debug
function dumpYamlish(doc) {
  const schemaName = doc?.schema?.name ?? "";
  const fields = doc?.schema?.fields ?? {};
  const lines = [];

  function dumpFields(obj, indent) {
    for (const [k, v] of Object.entries(obj || {})) {
      if (typeof v === "string") {
        lines.push(`${" ".repeat(indent)}${k}: ${v}`);
      } else if (v && typeof v === "object") {
        lines.push(`${" ".repeat(indent)}${k}:`);
        lines.push(`${" ".repeat(indent + 2)}type: ${v.type}`);
        if (v.type === "single-select") {
          lines.push(`${" ".repeat(indent + 2)}values:`);
          const vals = Array.isArray(v.values) ? v.values : [];
          for (const item of vals) lines.push(`${" ".repeat(indent + 4)}- ${item}`);
        } else if (v.type === "object") {
          lines.push(`${" ".repeat(indent + 2)}fields:`);
          dumpFields(v.fields || {}, indent + 4);
        }
      }
    }
  }

  lines.push("schema:");
  lines.push(`  name: ${schemaName}`);
  lines.push("  fields:");
  dumpFields(fields, 4);

  return lines.join("\n");
}

async function apiGetJson(path) {
  const res = await fetch(path, { method: "GET" });
  return await res.json();
}

async function apiPostJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json();
}

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

// ---------- Inline editing overlay ----------

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

// ---------- Phase D helpers: nested object rows ----------

function pathKey(path) {
  return (path || []).join(".");
}

function getFieldsListAtPath(state, parentPath) {
  // parentPath points to an object field; its children live in that field.fields
  if (!parentPath || parentPath.length === 0) return state.fields;
  const parent = getFieldByPath(state, parentPath);
  if (!parent) return null;
  if (parent.type !== "object") return null;
  if (!Array.isArray(parent.fields)) parent.fields = [];
  return parent.fields;
}

function getFieldByPath(state, path) {
  let list = state.fields;
  let cur = null;
  for (let i = 0; i < (path || []).length; i++) {
    const idx = path[i];
    if (!Array.isArray(list) || idx < 0 || idx >= list.length) return null;
    cur = list[idx];
    cur = ensureFieldShape(cur);
    if (i === path.length - 1) return cur;
    // descend
    if (cur.type !== "object") return null;
    if (!Array.isArray(cur.fields)) cur.fields = [];
    list = cur.fields;
  }
  return cur;
}

function flattenRows(fields, depth = 0, basePath = []) {
  const out = [];
  const list = Array.isArray(fields) ? fields : [];
  for (let i = 0; i < list.length; i++) {
    const f = ensureFieldShape(list[i]);
    const p = basePath.concat([i]);
    out.push({ kind: "field", path: p, depth, field: f });

    if (f.type === "object" && f.expanded) {
      out.push(...flattenRows(f.fields || [], depth + 1, p));
      // Option A: add-child row
      out.push({ kind: "add_child", parentPath: p, depth: depth + 1 });
    }
  }
  return out;
}

function newPlaceholderField() {
  return ensureFieldShape({ name: "", type: "str" });
}

// ---------- Extension registration ----------

app.registerExtension({
  name: EXT_NAME,

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!nodeData || nodeData.name !== TARGET_NODE_TYPE) return;

    const proto = nodeType.prototype;
    const origOnNodeCreated = proto.onNodeCreated;
    const origOnDrawForeground = proto.onDrawForeground;
    const origOnMouseDown = proto.onMouseDown;

    proto.onNodeCreated = function () {
      // Capture mouse events so menus anchor correctly
      if (!app?.canvas?._comfydata_mousehook_installed) {
        app.canvas._comfydata_mousehook_installed = true;

        const oldProcess = app.canvas.processMouseDown;
        app.canvas.processMouseDown = function (evt) {
          captureMouseEvent(evt);
          return oldProcess.apply(this, arguments);
        };
      }

      const r = origOnNodeCreated?.apply(this, arguments);

      ensureNodeSize(this);

      // Initialize state
      getState(this);

      // Hide schema_yaml widget if created
      const w = getSchemaYamlWidget(this);
      if (w) {
        w.hidden = true;
        w.type = "hidden";
        w.computeSize = () => [0, -4];
      }

      this._comfydata_hits = {
        buttons: {},
        rows: [],
        header: {},
      };

      return r;
    };

    proto.onDrawForeground = function (ctx) {
      const r = origOnDrawForeground?.apply(this, arguments);
      if (this.flags?.collapsed) return r;

      ensureNodeSize(this);
      const state = getState(this);

      const x0 = UI.pad;
      const y0 = UI.pad;
      const w = this.size[0] - UI.pad * 2;

      // Title
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.88)";
      ctx.font = "13px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("ComfyData Schema Editor", x0, y0 + UI.headerH / 2);
      ctx.restore();

      // Schema name chip
      const schemaLabel = state.schema_name?.trim() ? state.schema_name.trim() : "(click to name schema)";
      const chipRect = { x: x0 + 180, y: y0 + 3, w: w - 180, h: UI.btnH };
      drawChip(ctx, chipRect.x, chipRect.y, chipRect.w, chipRect.h, `schema.name: ${schemaLabel}`);
      this._comfydata_hits.header.schemaName = chipRect;

      // Buttons
      const btnY = y0 + UI.headerH + 4;
      const btnW = 86;
      const gap = 8;

      const buttons = [
        { key: "new", label: "New" },
        { key: "load", label: "Load" },
        { key: "save", label: "Save" },
        { key: "saveas", label: "Save As" },
        { key: "add", label: "+ Field" },
      ];

      let bx = x0;
      this._comfydata_hits.buttons = {};
      for (const b of buttons) {
        const rect = { x: bx, y: btnY, w: btnW, h: UI.btnH };
        drawButton(ctx, rect.x, rect.y, rect.w, rect.h, b.label);
        this._comfydata_hits.buttons[b.key] = rect;
        bx += btnW + gap;
      }

      // Table header
      const tableY = btnY + UI.btnH + 10;
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "12px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("Field", x0, tableY + UI.rowH / 2);
      ctx.fillText("Type", x0 + UI.colNameW + 10, tableY + UI.rowH / 2);
      ctx.fillText("Values / Expand", x0 + UI.colNameW + UI.colTypeW + 20, tableY + UI.rowH / 2);
      ctx.restore();

      // Rows (Phase D: flattened with nesting)
      this._comfydata_hits.rows = [];
      let ry = tableY + UI.rowH + 6;

      const flat = flattenRows(state.fields, 0, []);
      const maxRows = Math.floor((this.size[1] - ry - 10) / (UI.rowH + 6));
      const rows = flat.slice(0, Math.max(maxRows, 0));

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        const depth = row.depth || 0;
        const indent = depth * UI.indentW;

        const nameRect = { x: x0 + indent, y: ry, w: UI.colNameW - indent, h: UI.rowH };
        const typeRect = { x: x0 + UI.colNameW + 10, y: ry, w: UI.colTypeW, h: UI.rowH };
        const valsRect = { x: x0 + UI.colNameW + UI.colTypeW + 20, y: ry, w: UI.colValsW, h: UI.rowH };
        const delRect = {
          x: x0 + UI.colNameW + UI.colTypeW + UI.colValsW + 30,
          y: ry,
          w: UI.colRemoveW,
          h: UI.rowH,
        };

        if (row.kind === "add_child") {
          // Option A: "+ add field" row inside object block
          const addRect = {
            x: x0 + indent,
            y: ry,
            w: (delRect.x - 10) - (x0 + indent),
            h: UI.rowH,
          };
          drawButton(ctx, addRect.x, addRect.y, addRect.w, addRect.h, "+ Add field");
          // no delete X for add row
          this._comfydata_hits.rows.push({
            kind: "add_child",
            parentPath: row.parentPath,
            depth,
            addRect,
          });

          ry += UI.rowH + 6;
          continue;
        }

        // field row
        const f = row.field;

        // name chip
        const nameText = f.name?.trim() || "(name)";
        drawChip(ctx, nameRect.x, nameRect.y, nameRect.w, nameRect.h, nameText);

        // type chip
        drawChip(ctx, typeRect.x, typeRect.y, typeRect.w, typeRect.h, f.type || "(type)");

        // values / expand chip
        let valuesText = "(n/a)";
        if (f.type === "single-select") {
          valuesText = f.values_csv?.trim() || "(click to set)";
        } else if (f.type === "object") {
          const caret = f.expanded ? "▾" : "▸";
          const childCount = Array.isArray(f.fields) ? f.fields.length : 0;
          valuesText = `${caret} ${childCount} field${childCount === 1 ? "" : "s"}`;
        }
        drawChip(ctx, valsRect.x, valsRect.y, valsRect.w, valsRect.h, valuesText);

        // delete
        drawX(ctx, delRect.x, delRect.y, delRect.w, delRect.h);

        this._comfydata_hits.rows.push({
          kind: "field",
          path: row.path,
          pathKey: pathKey(row.path),
          depth,
          nameRect,
          typeRect,
          valsRect,
          delRect,
        });

        ry += UI.rowH + 6;
      }

      return r;
    };

    proto.onMouseDown = function (e, pos, graphcanvas) {
      captureMouseEvent(e);

      if (this.flags?.collapsed) {
        return origOnMouseDown?.apply(this, arguments);
      }

      const state = getState(this);

      // pos -> node-local coords
      let lx = pos[0];
      let ly = pos[1];

      if (lx > this.size[0] + 40 || ly > this.size[1] + 40 || lx < -40 || ly < -40) {
        lx = pos[0] - this.pos[0];
        ly = pos[1] - this.pos[1];
      }

      const local = { x: lx, y: ly };
      const hits = this._comfydata_hits || {};
      const btns = hits.buttons || {};

      const syncYamlWidget = () => {
        try {
          const doc = buildDocFromState(getState(this));
          const yamlish = dumpYamlish(doc);
          const w = getSchemaYamlWidget(this);
          if (w) w.value = yamlish;
        } catch (_) {}
      };

      const stop = () => {
        e?.stopPropagation?.();
        e?.preventDefault?.();
      };

      const doNew = () => {
        setState(this, defaultState());
        syncYamlWidget();
        this.setDirtyCanvas(true, true);
      };

      const doSaveAs = async () => {
        // Still prompt for now (we can inline this later)
        const name = prompt("Save As (filename identity):", state.schema_name || "");
        if (!name) return;

        const doc = buildDocFromState(state);
        const resp = await apiPostJson("/comfydata/schema/save", { name: name.trim(), doc });

        if (!resp?.ok) {
          alert(resp?.error || "Save failed");
          return;
        }

        state.schema_name = doc.schema.name || state.schema_name;
        setState(this, state);
        syncYamlWidget();
        this.setDirtyCanvas(true, true);
      };

      const doSave = async () => {
        const filename = (state.schema_name || "").trim();
        if (!filename) {
          await doSaveAs();
          return;
        }

        const doc = buildDocFromState(state);
        const resp = await apiPostJson("/comfydata/schema/save", { name: filename, doc });

        if (!resp?.ok) {
          alert(resp?.error || "Save failed");
          return;
        }

        syncYamlWidget();
        this.setDirtyCanvas(true, true);
      };

      const doLoad = async () => {
        const list = await apiGetJson("/comfydata/schemas");
        if (!list?.ok) {
          alert(list?.error || "Failed to list schemas");
          return;
        }

        const schemas = list.schemas || [];
        if (!schemas.length) {
          alert("No schemas found.");
          return;
        }

        makeContextMenu(
          schemas,
          async (picked) => {
            const resp = await apiGetJson(`/comfydata/schema?name=${encodeURIComponent(picked)}`);
            if (!resp?.ok) {
              alert(resp?.error || "Load failed");
              return;
            }

            const newState = docToState(resp.doc);
            setState(this, newState);
            syncYamlWidget();
            this.setDirtyCanvas(true, true);
          },
          e
        );
      };

      const startInlineEditForFieldName = (fieldPath, fallbackRect) => {
        // After insertion, find the current hit rect for that path and edit it.
        const rowHit = (this._comfydata_hits?.rows || []).find(
          (r) => r.kind === "field" && r.pathKey === pathKey(fieldPath)
        );
        const nameRect = rowHit?.nameRect || fallbackRect;
        setTimeout(() => {
          beginInlineEdit(this, nameRect, "", (val) => {
            const name = (val || "").trim();
            const f = getFieldByPath(state, fieldPath);
            if (!f) return;

            // if empty -> remove the field
            if (!name) {
              // remove by path
              const parentPath = fieldPath.slice(0, -1);
              const idx = fieldPath[fieldPath.length - 1];
              const list = getFieldsListAtPath(state, parentPath);
              if (Array.isArray(list) && idx >= 0 && idx < list.length) {
                list.splice(idx, 1);
              }
            } else {
              f.name = name;
            }

            setState(this, state);
            syncYamlWidget();
            this.setDirtyCanvas(true, true);
          });
        }, 0);
      };

      const doAddRootField = () => {
        state.fields.push(newPlaceholderField());
        setState(this, state);
        syncYamlWidget();
        this.setDirtyCanvas(true, true);

        const idx = state.fields.length - 1;
        const fieldPath = [idx];

        const fallbackRect = {
          x: UI.pad,
          y: UI.pad + UI.headerH + 4 + UI.btnH + 10 + UI.rowH + 6 + idx * (UI.rowH + 6),
          w: UI.colNameW,
          h: UI.rowH,
        };

        startInlineEditForFieldName(fieldPath, fallbackRect);
      };

      const toggleObjectExpanded = (f) => {
        if (f.type !== "object") return;
        f.expanded = !f.expanded;
      };

      // ---- Handle clicks FIRST ----

      // Schema name
      if (hits.header?.schemaName && hit(local, hits.header.schemaName)) {
        beginInlineEdit(this, hits.header.schemaName, state.schema_name || "", (val) => {
          state.schema_name = (val || "").trim();
          setState(this, state);
          syncYamlWidget();
          this.setDirtyCanvas(true, true);
        });
        stop();
        return true;
      }

      // Buttons
      if (btns.new && hit(local, btns.new)) {
        doNew();
        stop();
        return true;
      }
      if (btns.load && hit(local, btns.load)) {
        void doLoad();
        stop();
        return true;
      }
      if (btns.save && hit(local, btns.save)) {
        void doSave();
        stop();
        return true;
      }
      if (btns.saveas && hit(local, btns.saveas)) {
        void doSaveAs();
        stop();
        return true;
      }
      if (btns.add && hit(local, btns.add)) {
        doAddRootField();
        stop();
        return true;
      }

      // Rows
      for (const row of hits.rows || []) {
        if (row.kind === "add_child") {
          if (row.addRect && hit(local, row.addRect)) {
            const parent = getFieldByPath(state, row.parentPath);
            if (!parent || parent.type !== "object") {
              stop();
              return true;
            }
            if (!Array.isArray(parent.fields)) parent.fields = [];

            parent.fields.push(newPlaceholderField());
            parent.expanded = true;

            setState(this, state);
            syncYamlWidget();
            this.setDirtyCanvas(true, true);

            const newIdx = parent.fields.length - 1;
            const newPath = row.parentPath.concat([newIdx]);

            // Use the addRect as a fallback to place the editor roughly correctly
            const fallbackRect = {
              x: row.addRect.x,
              y: row.addRect.y,
              w: Math.max(40, UI.colNameW - (row.depth * UI.indentW)),
              h: UI.rowH,
            };

            startInlineEditForFieldName(newPath, fallbackRect);

            stop();
            return true;
          }
          continue;
        }

        // field row
        const f = getFieldByPath(state, row.path);
        if (!f) continue;

        if (row.delRect && hit(local, row.delRect)) {
          const parentPath = row.path.slice(0, -1);
          const idx = row.path[row.path.length - 1];
          const list = getFieldsListAtPath(state, parentPath);
          if (Array.isArray(list) && idx >= 0 && idx < list.length) {
            list.splice(idx, 1);
          }
          setState(this, state);
          syncYamlWidget();
          this.setDirtyCanvas(true, true);
          stop();
          return true;
        }

        if (row.nameRect && hit(local, row.nameRect)) {
          beginInlineEdit(this, row.nameRect, f.name || "", (val) => {
            f.name = (val || "").trim();
            setState(this, state);
            syncYamlWidget();
            this.setDirtyCanvas(true, true);
          });
          stop();
          return true;
        }

        if (row.typeRect && hit(local, row.typeRect)) {
          makeContextMenu(
            FIELD_TYPES,
            (picked) => {
              f.type = picked;

              // Clear values if leaving single-select
              if (f.type !== "single-select") delete f.values_csv;

              // Clear object children if leaving object
              if (f.type !== "object") {
                delete f.fields;
                delete f.expanded;
              }

              // If switching to object, init children + collapse by default, then expand (nice UX)
              if (f.type === "object") {
                if (!Array.isArray(f.fields)) f.fields = [];
                if (typeof f.expanded !== "boolean") f.expanded = true;
              }

              // If switching to single-select, open textarea inline
              if (f.type === "single-select") {
                setTimeout(() => {
                  beginInlineEditTextarea(this, row.valsRect, f.values_csv || "", (val) => {
                    f.values_csv = normalizeValuesToCsv(val);
                    if (!f.values_csv.trim()) delete f.values_csv;

                    setState(this, state);
                    syncYamlWidget();
                    this.setDirtyCanvas(true, true);
                  });
                }, 0);
              }

              setState(this, state);
              syncYamlWidget();
              this.setDirtyCanvas(true, true);
            },
            e
          );
          stop();
          return true;
        }

        if (row.valsRect && hit(local, row.valsRect)) {
          if (f.type === "single-select") {
            beginInlineEditTextarea(this, row.valsRect, f.values_csv || "", (val) => {
              f.values_csv = normalizeValuesToCsv(val);
              if (!f.values_csv.trim()) delete f.values_csv;

              setState(this, state);
              syncYamlWidget();
              this.setDirtyCanvas(true, true);
            });
            stop();
            return true;
          }

          if (f.type === "object") {
            toggleObjectExpanded(f);
            setState(this, state);
            syncYamlWidget();
            this.setDirtyCanvas(true, true);
            stop();
            return true;
          }

          // (n/a) for primitives
          stop();
          return true;
        }
      }

      // Not handled by us -> pass to default
      return origOnMouseDown?.apply(this, arguments);
    };
  },
});

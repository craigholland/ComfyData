// ComfyData Schema Editor - v1
//
// This implements a custom UI layer for the ComfyDataSchemaEditor node.
// It draws an editor directly on the node canvas and uses backend HTTP endpoints
// for schema persistence.
//
// Endpoints (already implemented in Python):
//   GET  /comfydata/schemas
//   GET  /comfydata/schema?name=...
//   POST /comfydata/schema/save   { name, doc }
//
// Notes:
// - We keep editor state in node.properties.comfydata_state
// - We keep schema_yaml widget updated with YAML-like text for debugging/output

import { app } from "../../scripts/app.js";

const EXT_NAME = "ComfyData.SchemaEditor";
const TARGET_NODE_TYPE = "ComfyDataSchemaEditor";

const PRIMITIVE_TYPES = ["uuid", "int", "str", "decimal"];
const FIELD_TYPES = ["uuid", "int", "str", "decimal", "single-select", "object"];

// Basic layout constants (tuned to feel decent; adjust anytime)
const UI = {
  pad: 8,
  rowH: 22,
  btnH: 20,
  headerH: 26,
  colNameW: 150,
  colTypeW: 110,
  colValsW: 180,
  colRemoveW: 22,
};

let LAST_MOUSE_EVENT = null;

function captureMouseEvent(evt) {
  // We need a real DOM MouseEvent with clientX/clientY
  if (evt && typeof evt.clientX === "number" && typeof evt.clientY === "number") {
    LAST_MOUSE_EVENT = evt;
  }
}

function defaultState() {
  return {
    schema_name: "",
    fields: [], // [{ name, type, values_csv? }]
  };
}

function getState(node) {
  if (!node.properties) node.properties = {};
  if (!node.properties.comfydata_state) node.properties.comfydata_state = defaultState();
  // Ensure shape
  const s = node.properties.comfydata_state;
  if (!Array.isArray(s.fields)) s.fields = [];
  if (typeof s.schema_name !== "string") s.schema_name = "";
  return s;
}

function setState(node, newState) {
  if (!node.properties) node.properties = {};
  node.properties.comfydata_state = newState;
}

function getSchemaYamlWidget(node) {
  if (!node.widgets) return null;
  // Hidden widgets still appear in node.widgets
  return node.widgets.find(w => w && w.name === "schema_yaml") || null;
}

function buildDocFromState(state) {
  const fields = {};
  for (const f of state.fields) {
    const name = (f.name || "").trim();
    if (!name) continue;

    if (PRIMITIVE_TYPES.includes(f.type)) {
      fields[name] = f.type;
    } else if (f.type === "single-select") {
      const csv = (f.values_csv || "").trim();
      const values = csv
        ? csv.split(",").map(x => x.trim()).filter(Boolean)
        : [];
      fields[name] = { type: "single-select", values };
    } else if (f.type === "object") {
      // v1: object starts empty; Phase D can add nested editing
      fields[name] = { type: "object", fields: {} };
    }
  }

  return {
    schema: {
      name: (state.schema_name || "").trim(),
      fields,
    },
  };
}

function docToState(doc) {
  const out = defaultState();
  const schema = doc?.schema;
  out.schema_name = String(schema?.name || "");

  const fields = schema?.fields || {};
  if (fields && typeof fields === "object") {
    for (const [k, v] of Object.entries(fields)) {
      if (typeof v === "string") {
        // primitive shorthand
        out.fields.push({ name: k, type: v });
      } else if (v && typeof v === "object") {
        const t = v.type;
        if (t === "single-select") {
          const values = Array.isArray(v.values) ? v.values : [];
          out.fields.push({ name: k, type: "single-select", values_csv: values.join(", ") });
        } else if (t === "object") {
          out.fields.push({ name: k, type: "object" });
        }
      }
    }
  }
  return out;
}

// Very simple YAML-ish dump (good enough for node output/debug).
// Real persistence uses the JSON doc through /schema/save.
function dumpYamlish(doc) {
  const schemaName = doc?.schema?.name ?? "";
  const fields = doc?.schema?.fields ?? {};
  const lines = [];
  lines.push("schema:");
  lines.push(`  name: ${schemaName}`);
  lines.push("  fields:");
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v === "string") {
      lines.push(`    ${k}: ${v}`);
    } else if (v && typeof v === "object") {
      lines.push(`    ${k}:`);
      lines.push(`      type: ${v.type}`);
      if (v.type === "single-select") {
        lines.push("      values:");
        const vals = Array.isArray(v.values) ? v.values : [];
        for (const item of vals) lines.push(`        - ${item}`);
      } else if (v.type === "object") {
        lines.push("      fields: {}");
      }
    }
  }
  return lines.join("\n");
}

async function apiGetJson(path) {
  const res = await fetch(path, { method: "GET" });
  const j = await res.json();
  return j;
}

async function apiPostJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  return j;
}

function ensureNodeSize(node) {
  // Make room for our custom editor UI
  const minW = 520;
  const minH = 260;
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
  const items = values.map(v => ({ content: v, value: v }));

  const anchorEvt =
    (evt && typeof evt.clientX === "number" && typeof evt.clientY === "number")
      ? evt
      : LAST_MOUSE_EVENT;

  // eslint-disable-next-line no-undef
  new LiteGraph.ContextMenu(items, {
    event: anchorEvt || null,
    callback: (item) => {
      if (!item) return;
      onPick(item.value ?? item.content);
    },
  });
}

function getCanvasElement() {
  // ComfyUI uses a single canvas element for the graph
  // app.canvas.canvas is the DOM canvas element in most builds
  return app?.canvas?.canvas || document.querySelector("canvas");
}

function toScreenRect(node, rect) {
  // Convert a node-local rect to browser screen pixels
  // We use the graphcanvas transform.
  const gc = app?.canvas;
  const canvasEl = getCanvasElement();
  if (!gc || !canvasEl) return null;

  // In LiteGraph, canvas is transformed by scale/offset
  const scale = gc.ds?.scale ?? 1;
  const offx = gc.ds?.offset?.[0] ?? 0;
  const offy = gc.ds?.offset?.[1] ?? 0;

  // Node local -> graph coords
  const gx = node.pos[0] + rect.x;
  const gy = node.pos[1] + rect.y;

  // Graph coords -> canvas coords (pixels within canvas)
  const cx = (gx + offx) * scale;
  const cy = (gy + offy) * scale;

  // Canvas coords -> screen coords
  const canvasBounds = canvasEl.getBoundingClientRect();
  return {
    left: canvasBounds.left + cx,
    top: canvasBounds.top + cy,
    width: rect.w * scale,
    height: rect.h * scale,
  };
}

function beginInlineEdit(node, rect, initialValue, onCommit) {
  // Reuse a single input element per node
  const canvasEl = getCanvasElement();
  if (!canvasEl) return;

  // Kill any existing editor first
  if (node._comfydata_inline_input) {
    try { node._comfydata_inline_input.remove(); } catch (_) {}
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
    // Remove editor
    try { input.remove(); } catch (_) {}
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

  input.focus();
  input.select();
}

app.registerExtension({
  name: EXT_NAME,

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!nodeData || nodeData.name !== TARGET_NODE_TYPE) return;

    const proto = nodeType.prototype;
    const origOnNodeCreated = proto.onNodeCreated;
    const origOnDrawForeground = proto.onDrawForeground;
    const origOnMouseDown = proto.onMouseDown;

    proto.onNodeCreated = function () {
        // Capture mouse events from the canvas so menus always anchor correctly
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

      // Initialize state if missing
      getState(this);
      // Force-hide the schema_yaml widget if ComfyUI still creates one
      const w = getSchemaYamlWidget(this);
      if (w) {
        w.hidden = true;
        w.type = "hidden";
        // Prevent it from reserving layout space
        w.computeSize = () => [0, -4];
      }

      // Prepare hit regions cache
      this._comfydata_hits = {
        buttons: {},
        rows: [],
        header: {},
      };

      return r;
    };

    proto.onDrawForeground = function (ctx) {
      const r = origOnDrawForeground?.apply(this, arguments);

      // Only draw if not collapsed
      if (this.flags?.collapsed) return r;

      ensureNodeSize(this);

      const state = getState(this);

      // Work area (inside node)
      const x0 = UI.pad;
      const y0 = UI.pad;
      const w = this.size[0] - UI.pad * 2;

      // Header
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

      // Top buttons
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
      ctx.fillText("Values (single-select)", x0 + UI.colNameW + UI.colTypeW + 20, tableY + UI.rowH / 2);
      ctx.restore();

      // Rows
      this._comfydata_hits.rows = [];
      let ry = tableY + UI.rowH + 6;

      const maxRows = Math.floor((this.size[1] - ry - 10) / (UI.rowH + 6));
      const rows = state.fields.slice(0, Math.max(maxRows, 0));

      for (let i = 0; i < rows.length; i++) {
        const f = rows[i];

        const nameRect = { x: x0, y: ry, w: UI.colNameW, h: UI.rowH };
        const typeRect = { x: x0 + UI.colNameW + 10, y: ry, w: UI.colTypeW, h: UI.rowH };
        const valsRect = { x: x0 + UI.colNameW + UI.colTypeW + 20, y: ry, w: UI.colValsW, h: UI.rowH };
        const delRect = { x: x0 + UI.colNameW + UI.colTypeW + UI.colValsW + 30, y: ry, w: UI.colRemoveW, h: UI.rowH };

        drawChip(ctx, nameRect.x, nameRect.y, nameRect.w, nameRect.h, f.name?.trim() || "(name)");
        drawChip(ctx, typeRect.x, typeRect.y, typeRect.w, typeRect.h, f.type || "(type)");

        const valuesText =
          f.type === "single-select"
            ? (f.values_csv?.trim() || "(click to set)")
            : "(n/a)";
        drawChip(ctx, valsRect.x, valsRect.y, valsRect.w, valsRect.h, valuesText);

        drawX(ctx, delRect.x, delRect.y, delRect.w, delRect.h);

        this._comfydata_hits.rows.push({
          idx: i,
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
      const r = origOnMouseDown?.apply(this, arguments);

      if (this.flags?.collapsed) return r;

      const state = getState(this);


      // In many ComfyUI/LiteGraph builds, `pos` is already node-local.
      // In others, it's graph coords. We detect which case we're in.
      let lx = pos[0];
      let ly = pos[1];

      // If the coordinates look like graph-space (far outside node bounds), convert to local.
      if (lx > this.size[0] + 40 || ly > this.size[1] + 40 || lx < -40 || ly < -40) {
        lx = pos[0] - this.pos[0];
        ly = pos[1] - this.pos[1];
      }

      const local = { x: lx, y: ly };


      const hits = this._comfydata_hits || {};

      // Header: schema name edit
      if (hits.header?.schemaName && hit(local, hits.header.schemaName)) {
          const rect = hits.header.schemaName;
          beginInlineEdit(this, rect, state.schema_name || "", (val) => {
            state.schema_name = (val || "").trim();
            setState(this, state);
          });
          return true;
        }


      // Buttons
      const btns = hits.buttons || {};

      const syncYamlWidget = () => {
        try {
          const doc = buildDocFromState(getState(this));
          const yamlish = dumpYamlish(doc);
          const w = getSchemaYamlWidget(this);
          if (w) w.value = yamlish;
        } catch (_) {
          // ignore
        }
      };

      const doNew = () => {
        setState(this, defaultState());
        syncYamlWidget();
        this.setDirtyCanvas(true, true);
      };

      const doAddField = () => {
          // Create a placeholder field and immediately edit its name inline.
          state.fields.push({ name: "", type: "str" });
          setState(this, state);
          this.setDirtyCanvas(true, true);

          // Attempt to focus the just-added row's name cell.
          // It's likely the last row; we’ll compute its expected rect.
          const idx = state.fields.length - 1;

          // If we have hit rects (drawn this frame), use them; otherwise approximate.
          const rows = this._comfydata_hits?.rows || [];
          const rowHit = rows.find(r => r.idx === idx);

          const nameRect = rowHit?.nameRect || {
            x: UI.pad,
            y: (UI.pad + UI.headerH + 4 + UI.btnH + 10 + UI.rowH + 6) + (idx * (UI.rowH + 6)),
            w: UI.colNameW,
            h: UI.rowH,
          };

          beginInlineEdit(this, nameRect, "", (val) => {
            const name = (val || "").trim();
            if (!name) {
              // If user leaves it blank, remove the placeholder field.
              state.fields.splice(idx, 1);
            } else {
              state.fields[idx].name = name;
            }
            setState(this, state);
            syncYamlWidget();
          });

          syncYamlWidget();
        };


      const doSaveAs = async () => {
        const name = prompt("Save As (filename identity):", state.schema_name || "");
        if (!name) return;
        const doc = buildDocFromState(state);
        const resp = await apiPostJson("/comfydata/schema/save", { name: name.trim(), doc });
        if (!resp?.ok) {
          alert(resp?.error || "Save failed");
          return;
        }
        // Keep schema.name aligned with user expectation
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

        // Show context menu of schema names
        makeContextMenu(schemas, async (picked) => {
          const resp = await apiGetJson(`/comfydata/schema?name=${encodeURIComponent(picked)}`);
          if (!resp?.ok) {
            alert(resp?.error || "Load failed");
            return;
          }
          const newState = docToState(resp.doc);
          setState(this, newState);
          syncYamlWidget();
          this.setDirtyCanvas(true, true);
        }, e);
      };

      if (btns.new && hit(local, btns.new)) { doNew(); return true; }
      if (btns.add && hit(local, btns.add)) { doAddField(); return true; }
      if (btns.saveas && hit(local, btns.saveas)) { void doSaveAs(); return true; }
      if (btns.save && hit(local, btns.save)) { void doSave(); return true; }
      if (btns.load && hit(local, btns.load)) { void doLoad(); return true; }

      // Row interactions
      const rows = hits.rows || [];
      for (const row of rows) {
        const f = state.fields[row.idx];

        if (hit(local, row.delRect)) {
          state.fields.splice(row.idx, 1);
          setState(this, state);
          syncYamlWidget();
          this.setDirtyCanvas(true, true);
          return true;
        }

        if (hit(local, row.nameRect)) {
          beginInlineEdit(this, row.nameRect, f.name || "", (val) => {
            f.name = (val || "").trim();
            setState(this, state);
            syncYamlWidget();
          });
          return true;
        }


        if (hit(local, row.typeRect)) {
          // Show a context menu to pick a type
          makeContextMenu(FIELD_TYPES, (picked) => {
            f.type = picked;

            // If switching away from single-select, clear values
            if (f.type !== "single-select") delete f.values_csv;

            // If switching to single-select, prompt for values
            if (f.type === "single-select") {
              const csv = prompt("single-select values (comma-separated):", f.values_csv || "");
              if (csv !== null) f.values_csv = csv;
            }

            setState(this, state);
            syncYamlWidget();
            this.setDirtyCanvas(true, true);
          }, e);
          return true;
        }

        if (hit(local, row.valsRect)) {
          if (f.type === "single-select") {
            const csv = prompt("single-select values (comma-separated):", f.values_csv || "");
            if (csv !== null) {
              f.values_csv = csv;
              setState(this, state);
              syncYamlWidget();
              this.setDirtyCanvas(true, true);
            }
          } else if (f.type === "object") {
            alert("Object field editing is Phase D (nested fields). For now this is a placeholder.");
          }
          return true;
        }
      }

      return r;
    };
  },
});

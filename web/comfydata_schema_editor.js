// ComfyData Schema Editor – Frontend Extension

import { app } from "../../scripts/app.js";

import {
  EXT_NAME,
  TARGET_NODE_TYPE,
  FIELD_TYPES,
  UI,
  ensureNodeSize,
  drawButton,
  drawChip,
  drawX,
  drawPort,
  drawBezierEdge,
  hit,
  makeContextMenu,
  installMouseCaptureHook,
  beginInlineEdit,
  beginInlineEditTextarea,
  normalizeValuesToCsv,
  showToast,
  safeGetJson,
  safePostJson,
  getState,
  defaultState,
  getSchemaYamlWidget,
  buildDocFromState,
  docToState,
  pathKey,
  flattenRows,
  getFieldByPath,
  getFieldsListAtPath,
  newPlaceholderField,
  commitState,
  commitNewState,
} from "./functions/index.js";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

async function getSchemasCached(node) {
  // Cache list on the node instance for 10s to avoid spamming the backend
  const now = Date.now();
  const cache = node._comfydata_schema_list_cache;
  if (cache && now - cache.ts < 10_000 && Array.isArray(cache.list)) return cache.list;

  const res = await safeGetJson("/comfydata/schemas");
  if (!res?.ok) throw new Error(res?.error || "Failed to fetch schemas");
  const list = Array.isArray(res.schemas) ? res.schemas : [];
  node._comfydata_schema_list_cache = { ts: now, list };
  return list;
}

async function openRefPicker({ node, event, field, rect, state, commit }) {
  let schemas = [];
  try {
    schemas = await getSchemasCached(node);
  } catch (err) {
    showToast(String(err?.message || err || "Failed to fetch schemas"), "error");
    return;
  }

  // Optional: avoid allowing self-reference to schema.name (can still be validated later)
  const selfName = String(state.schema_name || "").trim();

  const items = [];
  items.push("(clear)");
  items.push("(manual entry…)");
  // divider-ish
  items.push("────────");

  for (const s of schemas) {
    if (typeof s !== "string") continue;
    if (selfName && s === selfName) {
      // allow it if you want; otherwise skip. PR2: keep it allowed and let validation handle cycles later.
      items.push(s);
    } else {
      items.push(s);
    }
  }

  makeContextMenu(
    items,
    (picked) => {
      if (picked === "(clear)") {
        delete field.ref;
        commit();
        return;
      }
      if (picked === "(manual entry…)") {
        beginInlineEdit(node, rect, String(field.ref ?? ""), (val) => {
          field.ref = (val || "").trim();
          if (!field.ref) delete field.ref;
          commit();
        });
        return;
      }
      if (picked === "────────") return;

      field.ref = String(picked || "").trim();
      if (!field.ref) delete field.ref;
      commit();
    },
    event
  );
}

app.registerExtension({
  name: EXT_NAME,

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!nodeData || nodeData.name !== TARGET_NODE_TYPE) return;

    const proto = nodeType.prototype;
    const origOnNodeCreated = proto.onNodeCreated;
    const origOnDrawForeground = proto.onDrawForeground;
    const origOnMouseDown = proto.onMouseDown;
    const origOnMouseWheel = proto.onMouseWheel;

    proto.onNodeCreated = function () {
      installMouseCaptureHook();

      const r = origOnNodeCreated?.apply(this, arguments);

      ensureNodeSize(this, 860, 320);
      getState(this); // init + normalize

      const w = getSchemaYamlWidget(this);
      if (w) {
        w.hidden = true;
        w.type = "hidden";
        w.computeSize = () => [0, -4];
      }

      this._comfydata_hits = { buttons: {}, rows: [], header: {}, scroll: {} };
      return r;
    };

    function hasErrorForField(validation, fieldPathStr) {
      if (!validation || validation.ok) return false;
      const errs = validation.errors || [];
      // We match any error path that starts with the field's path prefix
      // Example fieldPathStr: "schema.fields.address"
      return errs.some((e) => typeof e.path === "string" && e.path.startsWith(fieldPathStr));
    }

    function buildSchemaPathFromRow(row, state) {
      // row.path = indices into nested arrays
      // We reconstruct names by walking the state lists
      let fields = state.fields;
      let parts = ["schema", "fields"];
      for (let depth = 0; depth < row.path.length; depth++) {
        const idx = row.path[depth];
        const f = fields && fields[idx] ? fields[idx] : null;
        const name = (f?.name || "").trim();
        if (!name) break;
        parts.push(name);
        if (depth < row.path.length - 1) {
          // go into object child list
          parts.push("fields");
          fields = f?.fields || [];
        }
      }
      return parts.join(".");
    }

    // PR3a: compute "owner node id" from a row path
    function buildOwnerNodeIdFromRow(row, state) {
      // owner node is the containing object (or root schema)
      // Row path is indices; we translate to names up to parent of field.
      let fields = state.fields;
      const parts = [];
      for (let depth = 0; depth < row.path.length - 1; depth++) {
        const idx = row.path[depth];
        const f = fields && fields[idx] ? fields[idx] : null;
        const name = (f?.name || "").trim();
        if (!name) break;
        parts.push(name);
        fields = f?.fields || [];
      }
      // root schema node id is constant
      if (!parts.length) return "ROOT";
      return `INLINE:${parts.join(".")}`;
    }

    function buildInlineNodeId(ownerNodeId, fieldName) {
      const n = String(fieldName || "").trim();
      if (!n) return null;

      if (ownerNodeId === "ROOT") return `INLINE:${n}`;

      // ownerNodeId is INLINE:prefix
      const prefix = ownerNodeId.startsWith("INLINE:") ? ownerNodeId.slice("INLINE:".length) : ownerNodeId;
      return `INLINE:${prefix}.${n}`;
    }

    function buildSchemaNodeId(schemaName) {
      const s = String(schemaName || "").trim();
      return s ? `SCHEMA:${s}` : null;
    }

    function deriveGraphFromState(state) {
      // nodes: root + inline objects + referenced schemas
      const nodes = new Map();

      const rootLabel = String(state.schema_name || "").trim() || "(unnamed)";
      nodes.set("ROOT", { id: "ROOT", label: rootLabel, kind: "root" });

      const edges = []; // { kind, fromPathKey, toNodeId }

      // Walk flattened rows because it already knows nesting and provides pathKey mappings
      const flat = flattenRows(state.fields, 0, []);
      for (const row of flat) {
        if (row.kind !== "field") continue;
        const f = row.field;
        const fname = (f?.name || "").trim();
        if (!fname) continue;

        // computed but not used in ref-only mode; kept for later PRs
        const ownerNodeId = buildOwnerNodeIdFromRow(row, state);
        void ownerNodeId;
        void buildInlineNodeId;

        if (f.type === "ref") {
          const toId = buildSchemaNodeId(f.ref);
          if (!toId) continue;
          if (!nodes.has(toId)) {
            nodes.set(toId, { id: toId, label: toId.slice("SCHEMA:".length), kind: "schema" });
          }
          edges.push({ kind: "ref", fromPathKey: pathKey(row.path), toNodeId: toId });
        }
      }

      return { nodes, edges };
    }

    function layoutGraphPanel({ x, y, w, rowH }, graph) {
      // PR3a (ref-only): layout only ROOT + SCHEMA:* nodes
      //
      // Returns: Map(nodeId -> { id, label, kind, rect, inPort, outPort })
      // Ports are provided for consistent drawing, even if we only use inPort today.

      const layout = new Map();

      // Build ordered list: ROOT first, then schema nodes sorted by label
      const ordered = [];

      const root = graph.nodes.get("ROOT");
      if (root) ordered.push(root);

      const schema = [];
      for (const n of graph.nodes.values()) {
        if (!n || n.id === "ROOT") continue;

        // Only keep named schemas
        if (typeof n.id === "string" && n.id.startsWith("SCHEMA:")) schema.push(n);
      }
      schema.sort((a, b) => String(a.label || "").localeCompare(String(b.label || "")));
      ordered.push(...schema);

      // Layout vertically
      let cy = y;
      for (const n of ordered) {
        const rect = { x, y: cy, w, h: rowH };

        // Define consistent in/out ports
        const inPort = { x: x + 8, y: cy + rowH / 2 };
        const outPort = { x: x + w - 8, y: cy + rowH / 2 };

        layout.set(n.id, { ...n, rect, inPort, outPort });
        cy += rowH + 6;
      }

      return layout;
    }

    proto.onDrawForeground = function (ctx) {
      const r = origOnDrawForeground?.apply(this, arguments);
      if (this.flags?.collapsed) return r;

      ensureNodeSize(this);
      const state = getState(this);

      const x0 = UI.pad;
      const y0 = UI.pad;
      const w = this.size[0] - UI.pad * 2;

      // ─────────────────────────────────────────────────────────────
      // Row 1: Buttons (small, top row)
      // ─────────────────────────────────────────────────────────────
      const btnY = y0 + 2;
      const btnW = 62; // tighter buttons
      const btnGap = 6;
      const btnH = UI.btnH; // from constants.js
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
        const rect = { x: bx, y: btnY, w: btnW, h: btnH };
        drawButton(ctx, rect.x, rect.y, rect.w, rect.h, b.label);
        this._comfydata_hits.buttons[b.key] = rect;
        bx += btnW + btnGap;
      }

      // ─────────────────────────────────────────────────────────────
      // Row 2: schema.name + validation chips (compact)
      // ─────────────────────────────────────────────────────────────
      const chipY = btnY + btnH + 6;
      const chipH = btnH; // match button height

      const schemaLabel = state.schema_name?.trim() ? state.schema_name.trim() : "(click to name schema)";

      const v = state.validation;
      const vText = !v ? "Validation: (n/a)" : v.ok ? "Validation: OK" : `Validation: ${v.errors?.length || 0} issue(s)`;

      // We want compact chips, not “eat the row” chips.
      // We’ll cap schema chip width and ensure validation is always visible.
      const vW = 150; // smaller than your 170
      const chipGap = 8;
      const schemaMinW = 220;
      const schemaMaxW = 360; // hard cap so it doesn't dominate

      const schemaW = Math.max(schemaMinW, Math.min(schemaMaxW, w - vW - chipGap));

      const schemaRect = { x: x0, y: chipY, w: schemaW, h: chipH };
      drawChip(ctx, schemaRect.x, schemaRect.y, schemaRect.w, schemaRect.h, `schema.name: ${schemaLabel}`);
      this._comfydata_hits.header.schemaName = schemaRect;

      const vX = schemaRect.x + schemaRect.w + chipGap;
      const vRect = { x: vX, y: chipY, w: Math.max(90, w - (vX - x0)), h: chipH };
      drawChip(ctx, vRect.x, vRect.y, vRect.w, vRect.h, vText);
      this._comfydata_hits.header.validation = vRect;

      // ─────────────────────────────────────────────────────────────
      // Table header (tight, based on UI constants)
      // ─────────────────────────────────────────────────────────────
      const tableY = chipY + chipH + 10;

      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "10px sans-serif"; // smaller header font
      ctx.textBaseline = "middle";
      ctx.fillText("Field", x0, tableY + UI.rowH / 2);
      ctx.fillText("Type", x0 + UI.colNameW + 10, tableY + UI.rowH / 2);
      ctx.fillText("Values / Expand", x0 + UI.colNameW + UI.colTypeW + 20, tableY + UI.rowH / 2);
      ctx.restore();

      // Rows (flattened w/ nesting)
      this._comfydata_hits.rows = [];
      let ry = tableY + UI.rowH + 6;

      // PR3a: increase node width to make room for graph panel
      // (we do it here too because users can resize)
      ensureNodeSize(this, 860, 320);

      // We build a "render plan" for rows first (layout pass).
      const flat = flattenRows(state.fields, 0, []);
      const rowStep = UI.rowH + 6;
      const viewportH = Math.max(0, this.size[1] - ry - 10);
      const maxRows = Math.floor(viewportH / rowStep);

      const totalRows = flat.length;
      const canScroll = totalRows > maxRows && maxRows > 0;
      const maxScrollRow = canScroll ? Math.max(0, totalRows - maxRows) : 0;

      const desired = clamp(state.scroll_row || 0, 0, maxScrollRow);
      if (desired !== state.scroll_row) state.scroll_row = desired;

      const start = canScroll ? state.scroll_row : 0;
      const visibleRows = flat.slice(start, start + Math.max(maxRows, 0));

      // Graph panel sizing/placement (right side)
      const tableRight = x0 + UI.colNameW + 10 + UI.colTypeW + 20 + UI.colValsW + 30 + UI.colRemoveW;

      const panelGap = 18;
      const panelW = 190;
      const panelX = Math.max(tableRight + panelGap, this.size[0] - UI.pad - panelW - 14);
      const panelY = tableY + UI.rowH + 6;

      const graph = deriveGraphFromState(state);
      const nodeLayout = layoutGraphPanel({ x: panelX, y: panelY, w: panelW, rowH: UI.rowH }, graph);

      // Build renderRows: enough info to draw rows + compute port positions
      const renderRows = [];
      for (const row of visibleRows) {
        const depth = row.depth || 0;
        const indent = depth * UI.indentW;

        if (row.kind === "add_child") {
          const delRect = {
            x: x0 + UI.colNameW + UI.colTypeW + UI.colValsW + 30,
            y: ry,
            w: UI.colRemoveW,
            h: UI.rowH,
          };
          const addRect = {
            x: x0 + indent,
            y: ry,
            w: delRect.x - 10 - (x0 + indent),
            h: UI.rowH,
          };

          renderRows.push({ kind: "add_child", row, depth, indent, addRect });
          ry += rowStep;
          continue;
        }

        const nameRect = { x: x0 + indent, y: ry, w: UI.colNameW - indent, h: UI.rowH };
        const typeRect = { x: x0 + UI.colNameW + 10, y: ry, w: UI.colTypeW, h: UI.rowH };
        const valsRect = { x: x0 + UI.colNameW + UI.colTypeW + 20, y: ry, w: UI.colValsW, h: UI.rowH };
        const delRect = {
          x: x0 + UI.colNameW + UI.colTypeW + UI.colValsW + 30,
          y: ry,
          w: UI.colRemoveW,
          h: UI.rowH,
        };

        const f = row.field;

        let valuesText = "(n/a)";
        if (f.type === "single-select") {
          valuesText = f.values_csv?.trim() || "(click to set)";
        } else if (f.type === "object") {
          const caret = f.expanded ? "▾" : "▸";
          const childCount = Array.isArray(f.fields) ? f.fields.length : 0;
          valuesText = `${caret} ${childCount} field${childCount === 1 ? "" : "s"}`;
        } else if (f.type === "ref") {
          const target = String(f.ref ?? "").trim();
          valuesText = target ? `ref: ${target}` : "(click to set)";
        }

        const fieldSchemaPath = buildSchemaPathFromRow(row, state);
        if (hasErrorForField(state.validation, fieldSchemaPath)) {
          valuesText = `⚠ ${valuesText}`;
        }

        const pk = pathKey(row.path);

        // PR3a: for object/ref draw an output port on the values chip
        let outPort = null;
        let outPortKind = null;
        if (f.type === "ref") {
          outPortKind = "ref";
          outPort = { x: valsRect.x + valsRect.w - 10, y: valsRect.y + valsRect.h / 2 };
        }

        renderRows.push({
          kind: "field",
          row,
          f,
          depth,
          indent,
          pathKey: pk,
          nameRect,
          typeRect,
          valsRect,
          delRect,
          valuesText,
          outPort,
          outPortKind,
        });

        ry += rowStep;
      }

      // Populate hit table now (needed for onMouseDown)
      for (const rr of renderRows) {
        if (rr.kind === "add_child") {
          this._comfydata_hits.rows.push({
            kind: "add_child",
            parentPath: rr.row.parentPath,
            depth: rr.depth,
            addRect: rr.addRect,
          });
        } else {
          this._comfydata_hits.rows.push({
            kind: "field",
            path: rr.row.path,
            pathKey: rr.pathKey,
            depth: rr.depth,
            nameRect: rr.nameRect,
            typeRect: rr.typeRect,
            valsRect: rr.valsRect,
            delRect: rr.delRect,
          });
        }
      }

      // --- PR3a: draw edges first (behind UI chips) ---
      for (const e of graph.edges) {
        // find row port by pathKey
        const rr = renderRows.find((r2) => r2.kind === "field" && r2.pathKey === e.fromPathKey);
        if (!rr || !rr.outPort) continue;

        const target = nodeLayout.get(e.toNodeId);
        if (!target) continue;

        drawBezierEdge(ctx, rr.outPort.x, rr.outPort.y, target.inPort.x, target.inPort.y, e.kind);
      }

      // --- Draw rows/chips/buttons (existing behavior) ---
      for (const rr of renderRows) {
        if (rr.kind === "add_child") {
          drawButton(ctx, rr.addRect.x, rr.addRect.y, rr.addRect.w, rr.addRect.h, "+ Add field");
          continue;
        }

        drawChip(ctx, rr.nameRect.x, rr.nameRect.y, rr.nameRect.w, rr.nameRect.h, rr.f.name?.trim() || "(name)");
        drawChip(ctx, rr.typeRect.x, rr.typeRect.y, rr.typeRect.w, rr.typeRect.h, rr.f.type || "(type)");
        drawChip(ctx, rr.valsRect.x, rr.valsRect.y, rr.valsRect.w, rr.valsRect.h, rr.valuesText);
        drawX(ctx, rr.delRect.x, rr.delRect.y, rr.delRect.w, rr.delRect.h);

        if (rr.outPort) {
          drawPort(ctx, rr.outPort.x, rr.outPort.y, rr.outPortKind);
        }
      }

      // --- PR3a: draw graph panel nodes + their ports ---
      // Panel label
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "10px sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText("Schema Graph", panelX, panelY - 14);
      ctx.restore();

      for (const n of nodeLayout.values()) {
        drawChip(ctx, n.rect.x, n.rect.y, n.rect.w, n.rect.h, n.label);

        // in/out ports on nodes
        drawPort(ctx, n.inPort.x, n.inPort.y, "default", 4);
        drawPort(ctx, n.outPort.x, n.outPort.y, "default", 4);
      }

      // Scrollbar (right side)
      this._comfydata_hits.scroll = {};
      if (canScroll) {
        const trackW = 8;
        const trackX = this.size[0] - UI.pad - trackW;
        const trackY = tableY + UI.rowH + 6;
        const trackH = viewportH;

        const thumbH = Math.max(18, Math.floor((maxRows / totalRows) * trackH));
        const thumbY = trackY + Math.floor((state.scroll_row / Math.max(1, maxScrollRow)) * (trackH - thumbH));

        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.roundRect(trackX, trackY, trackW, trackH, 4);
        ctx.fill();

        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.beginPath();
        ctx.roundRect(trackX + 1, thumbY, trackW - 2, thumbH, 4);
        ctx.fill();
        ctx.restore();

        this._comfydata_hits.scroll.trackRect = { x: trackX, y: trackY, w: trackW, h: trackH };
        this._comfydata_hits.scroll.thumbRect = { x: trackX + 1, y: thumbY, w: trackW - 2, h: thumbH };
        this._comfydata_hits.scroll.maxScrollRow = maxScrollRow;
      }

      return r;
    };

    proto.onMouseWheel = function (e) {
      if (this.flags?.collapsed) return origOnMouseWheel?.apply(this, arguments);

      try {
        const mouse = app?.canvas?.graph_mouse;
        if (!mouse) return origOnMouseWheel?.apply(this, arguments);

        const lx = mouse[0] - this.pos[0];
        const ly = mouse[1] - this.pos[1];

        // Only scroll when mouse is over node body
        if (lx < 0 || ly < 0 || lx > this.size[0] || ly > this.size[1]) {
          return origOnMouseWheel?.apply(this, arguments);
        }

        const state = getState(this);

        // we only scroll if scrollbar is relevant (computed last draw)
        const maxScrollRow = this._comfydata_hits?.scroll?.maxScrollRow ?? 0;
        if (maxScrollRow <= 0) return origOnMouseWheel?.apply(this, arguments);

        const dir = Math.sign(e?.deltaY || 0);
        if (dir === 0) return origOnMouseWheel?.apply(this, arguments);

        state.scroll_row = clamp((state.scroll_row || 0) + dir, 0, maxScrollRow);
        commitState(this, state);

        if (typeof e?.preventDefault === "function") e.preventDefault();
        if (typeof e?.stopPropagation === "function") e.stopPropagation();
        return true;
      } catch (_) {
        return origOnMouseWheel?.apply(this, arguments);
      }
    };

    proto.onMouseDown = function (e, pos) {
      if (this.flags?.collapsed) return origOnMouseDown?.apply(this, arguments);

      let state = getState(this);
      const hits = this._comfydata_hits || {};
      const btns = hits.buttons || {};

      // Convert to node-local coords (LiteGraph sometimes passes graph coords)
      let lx = pos[0];
      let ly = pos[1];
      if (lx > this.size[0] + 40 || ly > this.size[1] + 40 || lx < -40 || ly < -40) {
        lx = pos[0] - this.pos[0];
        ly = pos[1] - this.pos[1];
      }

      const local = { x: lx, y: ly };

      const stop = () => {
        try {
          e?.preventDefault?.();
          e?.stopPropagation?.();
        } catch (_) {}
      };

      // Header schema.name
      const schemaNameRect = hits?.header?.schemaName;
      if (schemaNameRect && hit(local, schemaNameRect)) {
        beginInlineEdit(this, schemaNameRect, state.schema_name || "", (val) => {
          state.schema_name = (val || "").trim();
          state = commitState(this, state);
        });
        stop();
        return true;
      }

      const validationRect = hits?.header?.validation;
      if (validationRect && hit(local, validationRect)) {
        const v = state.validation;
        if (!v) {
          showToast("No validation info yet. Save or Validate.", "info");
        } else if (v.ok) {
          showToast("Validation OK", "success");
        } else {
          const errs = Array.isArray(v.errors) ? v.errors : [];
          const preview = errs
            .slice(0, 4)
            .map((e2) => `• ${e2.path}: ${e2.message}`)
            .join("\n");
          showToast(preview || "Validation issues found", "warn");
        }
        stop();
        return true;
      }

      // Buttons
      for (const [k, rect] of Object.entries(btns)) {
        if (!rect) continue;
        if (!hit(local, rect)) continue;

        if (k === "new") {
          state = commitNewState(this, defaultState());
          showToast("New schema", "info");
          stop();
          return true;
        }

        if (k === "add") {
          state.fields.push(newPlaceholderField());
          state = commitState(this, state);
          stop();
          return true;
        }

        if (k === "save") {
          const doc = buildDocFromState(state);
          const name = (state.schema_name || "").trim();
          if (!name) {
            showToast("schema.name is required", "warn");
            stop();
            return true;
          }

          (async () => {
            const res = await safePostJson("/comfydata/schema/save", { name, doc });
            if (!res?.ok) {
              showToast(res?.error || "Save failed", "error");
              return;
            }
            state.validation = res?.validation ?? null;
            state = commitState(this, state);
            if (res?.validation && res.validation.ok === false) {
              showToast(`Saved with ${res.validation.errors?.length || 0} validation warning(s)`, "warn");
            } else {
              showToast("Saved", "success");
            }
          })();

          stop();
          return true;
        }

        if (k === "saveas") {
          // Save As: let user edit schema.name, then save under that name
          beginInlineEdit(this, hits?.header?.schemaName, state.schema_name || "", (val) => {
            const nextName = (val || "").trim();
            if (!nextName) {
              showToast("schema.name is required", "warn");
              return;
            }

            const doc = buildDocFromState({ ...state, schema_name: nextName });

            (async () => {
              const res = await safePostJson("/comfydata/schema/save", { name: nextName, doc });
              if (!res?.ok) {
                showToast(res?.error || "Save As failed", "error");
                return;
              }

              // Only update state after successful Save-As
              state.schema_name = nextName;
              state.validation = res?.validation ?? null;
              state = commitState(this, state);

              if (res?.validation && res.validation.ok === false) {
                showToast(`Saved with ${res.validation.errors?.length || 0} validation warning(s)`, "warn");
              } else {
                showToast("Saved As", "success");
              }
            })();
          });

          stop();
          return true;
        }

        if (k === "load") {
          (async () => {
            const list = await safeGetJson("/comfydata/schemas");
            if (!list?.ok) {
              showToast(list?.error || "Load failed", "error");
              return;
            }
            const schemas = list.schemas || [];
            if (!schemas.length) {
              showToast("No schemas found", "info");
              return;
            }

            makeContextMenu(
              schemas,
              async (picked) => {
                const loaded = await safeGetJson(`/comfydata/schema?name=${encodeURIComponent(picked)}`);
                if (!loaded?.ok) {
                  showToast(loaded?.error || "Load failed", "error");
                  return;
                }
                const next = docToState(loaded.doc);
                state = commitNewState(this, next);
                state.validation = null;
                state = commitState(this, state);
                showToast(`Loaded: ${picked}`, "success");
              },
              e
            );
          })();

          stop();
          return true;
        }
      }

      // Rows
      const rows = hits.rows || [];
      for (const row of rows) {
        if (row.kind === "add_child") {
          if (row.addRect && hit(local, row.addRect)) {
            const list = getFieldsListAtPath(state, row.parentPath);
            if (Array.isArray(list)) list.push(newPlaceholderField());
            state = commitState(this, state);
            stop();
            return true;
          }
          continue;
        }

        const f = getFieldByPath(state, row.path);
        if (!f) continue;

        if (row.delRect && hit(local, row.delRect)) {
          const parentPath = row.path.slice(0, -1);
          const idx = row.path[row.path.length - 1];
          const list = getFieldsListAtPath(state, parentPath);
          if (Array.isArray(list) && idx >= 0 && idx < list.length) list.splice(idx, 1);

          state = commitState(this, state);
          stop();
          return true;
        }

        if (row.nameRect && hit(local, row.nameRect)) {
          beginInlineEdit(this, row.nameRect, f.name || "", (val) => {
            f.name = (val || "").trim();
            state = commitState(this, state);
          });
          stop();
          return true;
        }

        if (row.typeRect && hit(local, row.typeRect)) {
          makeContextMenu(
            FIELD_TYPES,
            (picked) => {
              f.type = picked;

              if (f.type !== "single-select") delete f.values_csv;
              if (f.type !== "object") {
                delete f.fields;
                delete f.expanded;
              }
              if (f.type !== "ref") delete f.ref;

              if (f.type === "object") {
                if (!Array.isArray(f.fields)) f.fields = [];
                if (typeof f.expanded !== "boolean") f.expanded = true;
              }

              if (f.type === "single-select") {
                setTimeout(() => {
                  beginInlineEditTextarea(this, row.valsRect, f.values_csv || "", (val) => {
                    f.values_csv = normalizeValuesToCsv(val);
                    if (!f.values_csv.trim()) delete f.values_csv;
                    state = commitState(this, state);
                  });
                }, 0);
              }

              if (f.type === "ref") {
                setTimeout(() => {
                  openRefPicker({
                    node: this,
                    event: e,
                    field: f,
                    rect: row.valsRect,
                    state,
                    commit: () => {
                      state = commitState(this, state);
                    },
                  });
                }, 0);
              }

              state = commitState(this, state);
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
              state = commitState(this, state);
            });
            stop();
            return true;
          }

          if (f.type === "object") {
            f.expanded = !f.expanded;
            state = commitState(this, state);
            stop();
            return true;
          }

          if (f.type === "ref") {
            openRefPicker({
              node: this,
              event: e,
              field: f,
              rect: row.valsRect,
              state,
              commit: () => {
                state = commitState(this, state);
              },
            });
            stop();
            return true;
          }

          stop();
          return true;
        }
      }

      return origOnMouseDown?.apply(this, arguments);
    };
  },
});

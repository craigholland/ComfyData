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

      ensureNodeSize(this);
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

      const chipWidth = Math.max(0, (w - 180) * 0.65);
      const chipRect = { x: x0 + 180, y: y0 + 3, w: chipWidth, h: UI.btnH };
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

      // Rows (flattened w/ nesting)
      this._comfydata_hits.rows = [];
      let ry = tableY + UI.rowH + 6;

      const flat = flattenRows(state.fields, 0, []);

      const rowStep = UI.rowH + 6;
      const viewportH = Math.max(0, this.size[1] - ry - 10);
      const maxRows = Math.floor(viewportH / rowStep);

      const totalRows = flat.length;
      const canScroll = totalRows > maxRows && maxRows > 0;

      const maxScrollRow = canScroll ? Math.max(0, totalRows - maxRows) : 0;

      // Clamp state.scroll_row
      const desired = clamp(state.scroll_row || 0, 0, maxScrollRow);
      if (desired !== state.scroll_row) {
        state.scroll_row = desired;
      }

      const start = canScroll ? state.scroll_row : 0;
      const rows = flat.slice(start, start + Math.max(maxRows, 0));

      // Draw rows
      for (const row of rows) {
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
          const addRect = {
            x: x0 + indent,
            y: ry,
            w: delRect.x - 10 - (x0 + indent),
            h: UI.rowH,
          };
          drawButton(ctx, addRect.x, addRect.y, addRect.w, addRect.h, "+ Add field");
          this._comfydata_hits.rows.push({ kind: "add_child", parentPath: row.parentPath, depth, addRect });

          ry += rowStep;
          continue;
        }

        const f = row.field;
        drawChip(ctx, nameRect.x, nameRect.y, nameRect.w, nameRect.h, f.name?.trim() || "(name)");
        drawChip(ctx, typeRect.x, typeRect.y, typeRect.w, typeRect.h, f.type || "(type)");

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

        drawChip(ctx, valsRect.x, valsRect.y, valsRect.w, valsRect.h, valuesText);
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

        ry += rowStep;
      }

      // Scrollbar (right side)
      this._comfydata_hits.scroll = {};
      if (canScroll) {
        const trackW = 8;
        const trackX = this.size[0] - UI.pad - trackW;
        const trackY = tableY + UI.rowH + 6;
        const trackH = viewportH;

        // thumb size proportional to visible content
        const thumbH = Math.max(18, Math.floor((maxRows / totalRows) * trackH));
        const thumbY =
          trackY + Math.floor((state.scroll_row / Math.max(1, maxScrollRow)) * (trackH - thumbH));

        // draw track
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.beginPath();
        ctx.roundRect(trackX, trackY, trackW, trackH, 4);
        ctx.fill();

        // draw thumb
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
                // PR1 minimal UI: manual entry of target schema name.
                setTimeout(() => {
                  beginInlineEdit(this, row.valsRect, String(f.ref ?? ""), (val) => {
                    f.ref = (val || "").trim();
                    if (!f.ref) delete f.ref; // keep state clean
                    state = commitState(this, state);
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
            beginInlineEdit(this, row.valsRect, String(f.ref ?? ""), (val) => {
              f.ref = (val || "").trim();
              if (!f.ref) delete f.ref;
              state = commitState(this, state);
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

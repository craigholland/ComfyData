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

import {
  apiGetJson,
  apiPostJson,
  getState,
  setState,
  dumpYamlish,
  drawButton,
  drawChip,
  drawX,
  hit,
  makeContextMenu,
  beginInlineEdit,
  beginInlineEditTextarea,
  flattenRows,
  showToast,
} from "./functions/index.js";

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
            w: delRect.x - 10 - (x0 + indent),
            h: UI.rowH,
          };
          drawButton(ctx, addRect.x, addRect.y, addRect.w, addRect.h, "+ Add field");
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

    proto.onMouseDown = function (e, pos) {
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

      const doSaveAs = () => {
        // Inline editor anchored to schema chip (preferred)
        const anchorRect =
          hits?.header?.schemaName || {
            x: UI.pad + 180,
            y: UI.pad + 3,
            w: this.size[0] - UI.pad * 2 - 180,
            h: UI.btnH,
          };

        beginInlineEdit(this, anchorRect, state.schema_name || "", (val) => {
          const name = (val || "").trim();
          if (!name) return;

          void (async () => {
            const doc = buildDocFromState(state);
            const resp = await apiPostJson("/comfydata/schema/save", { name, doc });

            if (!resp?.ok) {
              showToast(this, resp?.error || "Save failed", "error", hits?.header?.schemaName);
              return;
            }

            // Keep schema_name aligned with what you saved as
            state.schema_name = name;
            setState(this, state);
            syncYamlWidget();
            this.setDirtyCanvas(true, true);

            showToast(this, "Saved", "success", hits?.header?.schemaName, 1400);
          })();
        });
      };

      const doSave = async () => {
        const filename = (state.schema_name || "").trim();
        if (!filename) {
          doSaveAs();
          return;
        }

        const doc = buildDocFromState(state);
        const resp = await apiPostJson("/comfydata/schema/save", { name: filename, doc });

        if (!resp?.ok) {
          showToast(this, resp?.error || "Save failed", "error", hits?.header?.schemaName);
          return;
        }

        syncYamlWidget();
        this.setDirtyCanvas(true, true);
        showToast(this, "Saved", "success", hits?.header?.schemaName, 1400);
      };

      const doLoad = async () => {
        const list = await apiGetJson("/comfydata/schemas");
        if (!list?.ok) {
          showToast(this, list?.error || "Failed to list schemas", "error", hits?.header?.schemaName);
          return;
        }

        const schemas = list.schemas || [];
        if (!schemas.length) {
          showToast(this, "No schemas found.", "info", hits?.header?.schemaName);
          return;
        }

        makeContextMenu(
          schemas,
          async (picked) => {
            const resp = await apiGetJson(`/comfydata/schema?name=${encodeURIComponent(picked)}`);
            if (!resp?.ok) {
              showToast(this, resp?.error || "Schema load failed", "error", hits?.header?.schemaName);
              return;
            }

            const newState = docToState(resp.doc);
            setState(this, newState);
            syncYamlWidget();
            this.setDirtyCanvas(true, true);

            showToast(this, "Loaded", "success", hits?.header?.schemaName, 1200);
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
        doSaveAs();
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

            const fallbackRect = {
              x: row.addRect.x,
              y: row.addRect.y,
              w: Math.max(40, UI.colNameW - row.depth * UI.indentW),
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

              // If switching to object, init children + expand (nice UX)
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

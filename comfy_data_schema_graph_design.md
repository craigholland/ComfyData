# ComfyData – Schema Graph Design Document

## 1. Purpose

This document describes the **design, concepts, and constraints** for the ComfyData schema system and its representation as a **graph of ComfyUI nodes**.

It is intended to:

- Serve as a reference while implementing the first functional version
- Capture agreed-upon conventions and assumptions
- Prevent architectural drift once coding begins

This document intentionally prioritizes **clarity and correctness over edge-case completeness**.

---

## 2. Core Concept

A **schema** describes the structure of a data object (e.g. `Person`, `PersonPhysical`, `Hair`).

Schemas are rendered in ComfyUI as **nodes**, and relationships between schemas are rendered as **edges**.

The resulting UI is a **schema graph**, not a nested form.

---

## 3. Schema File Format

Every schema is stored as a YAML file with the following top-level structure:

```yaml
schema:
  name: <SchemaName>
  fields:
    <field_name>: <field_definition>
```

### 3.1 Schema Name

- `schema.name` is a **type identifier**
- Must be globally unique
- Typically PascalCase (e.g. `Person`, `PersonPhysical`)

The schema name identifies **what** the object is, not **where** it appears in the graph.

---

## 4. Field Types (v1)

Each field definition resolves to exactly one **field type**.

### 4.1 Primitive Types

Primitive types represent atomic values:

- `uuid`
- `int`
- `str`
- `decimal`

Example:

```yaml
age_years: int
```

---

### 4.2 Selection Types

#### 4.2.1 single-select

Represents a single choice from a predefined list of values.

```yaml
eye_color:
  type: single-select
  values:
    - blue
    - green
    - brown
```

Rules:

- All `single-select` fields implicitly allow the value `null`
- `null` does not need to be explicitly listed

#### 4.2.2 multi-select (future)

Planned extension of `single-select` allowing multiple simultaneous values.

---

### 4.3 Object Type

An `object` field defines a nested schema **inline**.

```yaml
hair:
  type: object
  fields:
    color:
      type: single-select
      values: [...]
```

Properties:

- Inline objects are anonymous schema types
- They still become **independent nodes** in the graph
- Identity is derived from their **path**, not a schema name

---

### 4.4 Reference Type (future)

A `ref` field points to another schema file by name.

```yaml
physical:
  type: ref
  ref: PersonPhysical
```

References may be overridden by the user at graph-edit time (with validation).

---

## 5. Graph Node Identity

Each schema instance in the graph has a **canonical node ID** derived from its position.

### 5.1 Canonical Node ID

- Dot-separated path from the root schema

Examples:

- `person`
- `person.physical`
- `person.physical.hair`

This ID is:

- Stable
- Unique
- Used internally for graph edges, caching, and persistence

---

### 5.2 Display Name

- Derived from the final path segment
- Title-cased

Examples:

- `person.physical.hair` → **Hair**

---

## 6. Node Rendering Rules

### 6.1 Node Creation

- Every schema (root, referenced, or inline object) is rendered as a **node**
- Nodes are **collapsed by default**

### 6.2 Ports and Edges

- Primitive and select fields render as **value controls** on the node
- Object or reference fields render as **ports** that connect to another node

### 6.3 Custom UI Rendering Layer

Due to limitations of default ComfyUI widgets, ComfyData nodes use a **custom UI rendering layer** implemented via a ComfyUI frontend extension.

Key concepts:

- Node visuals are drawn manually using canvas APIs
- Interactive elements (add/remove field, dropdowns, buttons) are implemented via hit-testing and mouse handlers
- Default widgets may be hidden or replaced

The custom UI layer is responsible for **schema editing ergonomics**, while Python nodes remain focused on data and execution.

---

## 7. User Overrides

Users may override schema references at graph-edit time.

Example:

- `person.physical` originally references `PersonPhysical`
- User swaps it to `ActorPhysical`

Overrides are subject to validation.

---

## 8. Cycle Prevention (Phase 1)

To prevent infinite expansion:

- Schema reference graphs **must be acyclic**
- Any override that introduces a cycle is rejected

Example invalid cycle:

```
Person → Pet → Owner → Person
```

Cycle detection is performed using standard graph traversal (DFS).

---

## 9. Future Phases (Out of Scope for v1)

### Phase 2

- Introduce `link` fields for safe back-references
- Add `multi-select` type

### Phase 3

- Allow cycles with explicit cycle-boundary rendering
- Custom ComfyUI frontend extensions for automatic graph generation

---

## 10. Non-Goals (v1)

- Automatic graph layout
- Infinite recursion handling
- Full validation enforcement
- UI theming or advanced controls

The goal of v1 is **basic functional correctness**, not completeness.

---

## 11. Implementation Plan

This section outlines a **clean-slate v1 implementation plan** for ComfyData, derived directly from the design principles above. The goal is to reach a *basically functional* plugin with clear responsibilities and minimal scope creep.

### 11.1 v1 Scope Definition

**v1 goals:**

- Load and save schema YAML files (`schema: { name, fields }`)
- Provide a single **Schema Editor** node
- Support field creation, deletion, and type selection
- Support primitive types: `uuid`, `int`, `str`, `decimal`
- Support `single-select` fields with editable values
- Support inline `object` fields (collapsed by default)
- Persist schemas to disk via backend API endpoints
- Use a custom frontend UI layer for schema editing

Out of scope for v1:

- Automatic graph generation
- Reference (`ref`) overrides
- Cycle detection
- Instances / data entry nodes
- UI polish and theming

---

### 11.2 Repository Layout (Clean Slate)

```
ComfyData/
  __init__.py
  py/
    __init__.py
    constants.py
    paths.py
    schema_types.py
    schema_io.py
    schema_normalize.py
    schema_validate.py
    api.py
    nodes/
      __init__.py
      schema_editor.py
  web/
    comfydata_schema_editor.js
    comfydata_styles.css
```

---

### 11.3 Module Responsibilities

\`\`

- Register node mappings
- Declare `WEB_DIRECTORY = "./web"`
- Import API module so routes register on startup

\`\`

- Resolve ComfyUI base directory
- Define storage locations:
  - `ComfyUI/user/default/comfy_data/schemas/`
  - `ComfyUI/user/default/comfy_data/instances/`
- Ensure directories exist
- Sanitize schema names for filenames

\`\`

- Read/write schema YAML files
- Enforce top-level `schema: { name, fields }` structure

\`\`

- Normalize shorthand field definitions
- Canonicalize field structures
- Ensure object fields have `fields: {}`

\`\`

- Perform minimal v1 validation
- Return structured error lists for UI consumption

\`\`

- Register backend HTTP endpoints:
  - list schemas
  - load schema
  - save / save-as schema
  - delete schema
  - check schema existence
- Constrain filesystem access to user directories

\`\`

- Define the Schema Editor node
- Hold hidden editor state (JSON or YAML)
- Output current schema representation

\`\`

- Implement custom canvas-based UI
- Render field rows and controls
- Handle add/remove/type-selection logic
- Call backend API for persistence

---

### 11.4 Internal Editor State Model

The frontend editor maintains its own structured state:

```json
{
  "schema_name": "PersonPhysical",
  "fields": [
    {"name": "height_in", "type": "single-select", "values_csv": "48-49,50-51"},
    {"name": "hair", "type": "object"}
  ]
}
```

This state is stored in a hidden node widget or property and is the **single source of truth** for the editor UI.

---

### 11.5 Order of Work

**Phase A – Backend Foundation**

1. Create plugin skeleton and entrypoint
2. Implement path resolution and storage helpers
3. Implement schema I/O, normalization, and validation
4. Implement backend persistence API

**Phase B – Minimal Node** 5. Implement Schema Editor node 6. Register node mappings

**Phase C – Frontend Editor v1** 7. Implement JS extension 8. Render editable schema UI 9. Wire save/load/new actions

**Phase D – Object Fields** 10. Support inline object fields (collapsed) 11. Ensure round-trip persistence

---

This implementation plan is intentionally conservative. It prioritizes correctness, clarity, and extensibility over feature breadth and UI polish.

---

## 12. Dev Evolutions

### 12.1 Current State & Near-Term Objectives

This section captures **development milestones achieved so far** and documents the **immediate next steps** as ComfyData evolves from a functional prototype into a more polished and extensible system.

#### Achievements to Date

The following capabilities have been successfully implemented and validated:

- A fully functional **Schema Editor node** rendered in ComfyUI
- A custom **canvas-based frontend UI layer** (no reliance on default widgets)
- Inline, in-node editing for:
  - `schema.name`
  - field names
- Reliable mouse event handling with proper propagation control
- Context-menu–based type selection
- Backend persistence via HTTP API:
  - Save / Save As
  - Load existing schemas
  - Schema listing
- Schema round-tripping verified on disk (`schema: { name, fields }`)
- Internal editor state established as the **single source of truth**

Collectively, these confirm that the architectural approach (custom frontend + thin Python backend) is sound.

---

#### Immediate Objectives (Next Evolution)

The next incremental improvements focus on **UX refinement and capability expansion**, without altering core architecture:

**Phase C.5 – Inline ****\`\`**** Value Editing**

- Replace remaining `prompt()` dialogs with inline textarea overlays
- Allow editing of `single-select` values directly within the node
- Normalize entered values (trim, deduplicate, implicit `null` support)
- Maintain full backward compatibility with existing schemas

---

#### Planned Follow-On Evolutions (When Ready)

These are intentionally deferred until the editor experience is fully solid:

- Inline editing UI for `object` fields (nested schemas)
- Visual expansion/collapse of object sub-nodes
- Schema reference (`ref`) fields and override mechanics
- Cycle detection and prevention logic
- Instance/data entry nodes that consume schemas
- Read-only schema graph visualization

Each of these builds directly on the foundation already in place, without requiring architectural rewrites.


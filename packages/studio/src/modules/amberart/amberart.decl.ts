/**
 * @file AmberArt's DECLARATION — data only, importable by plain Node.
 *
 * The closure resolver imports this under native type stripping, no JSX, to
 * learn the module's id, route, declared areas and **points**. So the one hard
 * rule: nothing but `import type`.
 *
 * Imported from GizmoX 2026-08-12. Two things changed shape on the way, and
 * both are the AmberX contract rather than taste:
 *
 *   1. **The extension point is declared here, as data.** GizmoX's
 *      `amberart.tool` was a hand-rolled map inside the module; core's
 *      `points.ts` names that exact case as the thing that "cannot be peeled,
 *      because nothing in the system can answer what are this module's
 *      plugins". Declared, it is answerable — and `requires` turns a malformed
 *      contribution into a refusal by name instead of a blank panel.
 *   2. **Menus are data.** GizmoX's screen hand-wrote `useCtx` menus; here the
 *      screen only marks `data-axf-area` and `amberart.commands.ts` is the
 *      acting half.
 */
import type { ModuleDecl } from "@axf/core";

export const AMBERART_DECL: ModuleDecl = {
  id: "amberart",
  title: "AmberArt",
  summary:
    "The framework's paint and art program: a layered raster canvas with brush, eraser, line, " +
    "rect, ellipse, flood fill and eyedropper, undo/redo history and PNG export — and a real " +
    "extension point, so generative tools arrive as plugins rather than as imports.",
  route: "/amberart",
  glyph: "icon-brush",
  /** Settings as decl data (core 0.0.20) — two rows, moved verbatim from
   *  `settings.ts`, whose docblock keeps the considered-and-refused list.
   *  The undo bounds ride the row: a depth of 400 is an out-of-memory tab. */
  settings: {
    ns: "amberart-settings",
    rows: [
      {
        key: "undoDepth",
        label: "Undo history depth",
        hint: "How many undo snapshots to hold. Each is ~6.4 MB of pixels held live.",
        kind: "number",
        defaultValue: 30,
        min: 5,
        max: 80,
        step: 5
      },
      {
        key: "checkerboard",
        label: "Checkerboard transparency",
        hint: "Draw transparency as a checkerboard, so erased and background-painted regions differ.",
        kind: "switch",
        defaultValue: true
      }
    ]
  },
  points: [
    {
      id: "amberart.tool",
      title: "AmberArt tool",
      description:
        "A tool in AmberArt's rail. The contribution supplies an id, a title, a pack glyph and a " +
        "`load` thunk that imports the panel; the panel is handed a ToolHost that can read the " +
        "canvas size, place an SVG onto the active layer (undoably) and raise a message — and " +
        "nothing else. A thunk rather than the component itself so the entry stays importable " +
        "by plain Node, which the closure resolver requires.",
      kind: "ui-surface",
      cardinality: "many",
      ordering: "priority",
      // Named fields, not a schema, exactly as the point contract intends: a
      // contribution missing one of these is refused at registration with the
      // field in the message, rather than mounting as an empty column.
      requires: ["id", "title", "glyph", "load"]
    }
  ],
  menus: {
    areas: [
      {
        id: "amberart.canvas",
        title: "AmberArt canvas",
        description: "The painting surface itself."
      },
      {
        id: "amberart.layer",
        title: "AmberArt layer",
        description: "One row in the layer stack."
      },
      {
        id: "amberart.surface",
        title: "AmberArt surface",
        description: "Anywhere on the screen, including the rail and the panel column."
      }
    ],
    items: {
      "amberart.canvas": [
        { id: "undo", label: "Undo", command: "amberart.undo", order: 10 },
        { id: "redo", label: "Redo", command: "amberart.redo", order: 20 },
        { id: "sep-0", label: "", role: "separator", order: 22 },
        { id: "select-all", label: "Select all", command: "amberart.select.all", order: 24 },
        {
          id: "select-none",
          label: "Deselect",
          command: "amberart.select.none",
          enabledWhen: "amberart.has-selection",
          order: 26
        },
        {
          id: "select-invert",
          label: "Invert selection",
          command: "amberart.select.invert",
          enabledWhen: "amberart.has-selection",
          order: 28
        },
        { id: "sep-1", label: "", role: "separator", order: 30 },
        /* No `enabledWhen`: the row only UNFOLDS the panel, which is always a
           sensible thing to ask for — and the panel is where "no active layer"
           and "that layer is hidden" get answered, in the store's own words,
           at the moment Apply is pressed. A greyed row here would have to
           guess that sentence a step early. */
        { id: "filters", label: "Adjustments…", command: "amberart.filters.open", order: 32 },
        { id: "export", label: "Export as PNG", command: "amberart.export", order: 40 },
        {
          id: "clear",
          label: "Clear the active layer",
          command: "amberart.layer.clear",
          role: "danger",
          order: 50
        }
      ],
      "amberart.layer": [
        { id: "add", label: "Add a layer", command: "amberart.layer.add", order: 10 },
        { id: "duplicate", label: "Duplicate this layer", command: "amberart.layer.duplicate", order: 20 },
        { id: "hide", label: "Show / hide this layer", command: "amberart.layer.toggle", order: 30 },
        { id: "sep-1", label: "", role: "separator", order: 40 },
        { id: "raise", label: "Bring forward", command: "amberart.layer.raise", order: 50 },
        { id: "lower", label: "Send back", command: "amberart.layer.lower", order: 60 },
        {
          id: "merge",
          label: "Merge down",
          command: "amberart.layer.merge",
          enabledWhen: "amberart.mergeable-layer",
          order: 70
        },
        /* No `enabledWhen`: flatten is always offered, as in Photoshop, and a
           single-layer document is answered by the store's own message —
           `removable-layer`'s reason ("a document must keep at least one
           layer") would be the wrong sentence on this row. */
        { id: "flatten", label: "Flatten the image", command: "amberart.layer.flatten", order: 80 },
        { id: "sep-2", label: "", role: "separator", order: 90 },
        /* Not `enabledWhen` a texture is chosen: one always is, because the
           rail's picker is exclusive and the store ships with a default. The
           row's own message answers the two ways it can decline (no layer, a
           hidden one), which is a sentence rather than a greyed row with no
           reason on it. */
        {
          id: "texturize",
          label: "Texturize layer",
          command: "amberart.layer.texturize",
          order: 95
        },
        {
          id: "clear",
          label: "Clear this layer",
          command: "amberart.layer.clear",
          role: "danger",
          order: 100
        },
        {
          id: "remove",
          label: "Delete this layer",
          command: "amberart.layer.remove",
          role: "danger",
          enabledWhen: "amberart.removable-layer",
          order: 110
        }
      ],
      "amberart.surface": [
        { id: "add-layer", label: "Add a layer", command: "amberart.layer.add", order: 10 },
        { id: "export", label: "Export as PNG", command: "amberart.export", order: 20 }
      ]
    }
  }
};

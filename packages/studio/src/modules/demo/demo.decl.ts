/**
 * @file The demo module's DECLARATION — data only, importable by plain Node.
 *
 * This file is the peel's input: `scripts/peel.mjs` imports it under Node's
 * native type stripping (no JSX transform, no React) to learn the module's id,
 * route and declared extension points, and computes the closure from those.
 * So the one hard rule here: **nothing but `import type`**. A runtime import —
 * of React, of a component, of the core barrel — breaks the peel for every
 * module at once, because the barrel drags `.tsx` files Node cannot parse.
 *
 * `demo.module.ts` composes this back into a real `Module` by adding the
 * component; the registry and the screen see no difference.
 */
import type { ModuleDecl } from "@axf/core";

export const DEMO_DECL: ModuleDecl = {
  id: "demo",
  title: "Core Inspector",
  summary:
    "Shows what the core actually knows about itself: booted subsystems, registered modules, " +
    "declared extension points, live contributions, theme tokens and the peel closure.",
  route: "/demo",
  glyph: "icon-eye",
  // The declared nav rides the decl so the peel can carry it: the peeled
  // app's generated boot registers it on `app.nav` and NavShell mounts it.
  // Nothing in the dev tree registers it — Studio keeps its own nav — and the
  // peel test asserts it renders in the peeled app (`data-axf-nav="demo-nav"`).
  nav: {
    id: "demo-nav",
    title: "Core Inspector navigation",
    surface: "app.nav",
    description:
      "Declared by the demo module's decl; carried by the peel closure and registered by the " +
      "peeled app's boot — the reference proof that a module ships with its own navigation.",
    items: [
      { kind: "section", id: "inspector", label: "Inspector" },
      { kind: "link", id: "demo", label: "Core Inspector", glyph: "icon-eye", route: "/demo" }
    ]
  },
  // The declared context menus ride the decl the same way `nav` does: the
  // screen marks `data-axf-area="demo.inspector"` on its root, hosts register
  // the rows through `registerModuleMenus` (Studio's subsystem and the peeled
  // app's generated boot), and the map's gate checks the command names at
  // registration. The peel test asserts the area reaches the peeled app.
  menus: {
    areas: [
      {
        id: "demo.inspector",
        title: "Core Inspector",
        description: "Anywhere on the inspector screen — the module's own right-click surface."
      }
    ],
    items: {
      "demo.inspector": [
        {
          id: "copy-selection",
          label: "Copy from inspector",
          command: "ctx.copy",
          order: 10
        }
      ]
    }
  },
  /**
   * Settings as decl data (core 0.0.20). One row, and it passes the ceiling's
   * test: the capabilities card is the longest thing on the screen (20+
   * entries, each a paragraph), and whether the inspector is a quick registry
   * glance or the full self-description is a real difference in what the
   * surface is FOR. It is also the reference decl: the peel carries settings
   * the way it carries `nav` and `menus`, and this is the module it proves
   * that on.
   */
  settings: {
    ns: "demo-settings",
    rows: [
      {
        key: "showCapabilities",
        label: "Show the capabilities card",
        hint: "The core's full self-description — 20+ entries. Off keeps the inspector to the live registries.",
        kind: "switch",
        defaultValue: true
      }
    ]
  },
  points: [
    {
      id: "demo.badge",
      title: "Header badge",
      description:
        "A small badge rendered in the inspector header. Proves a ui-surface contribution " +
        "reaches the screen through the host's slot rather than through a direct import.",
      kind: "ui-surface",
      cardinality: "many",
      requires: ["label", "tone"],
      ordering: "priority"
    },
    {
      id: "demo.note",
      title: "Inspector note",
      description:
        "A line of text contributed into the inspector body. Exists so a second point with " +
        "different cardinality and payload is exercised, not just one.",
      kind: "value",
      cardinality: "many",
      requires: ["text"],
      ordering: "priority"
    }
  ]
};

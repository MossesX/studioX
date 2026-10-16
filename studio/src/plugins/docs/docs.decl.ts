/**
 * @file The documentation surface's context menus — DATA, like every other
 * surface's.
 *
 * A `*.decl.ts` even though this is a PLUGIN rather than a module, and the
 * reason is the gate rather than tidiness: `test/ctx-conformance.test.ts`
 * discovers the map by importing every `*.decl.ts` under `src/`, and discovers
 * the DOM half by scanning every `.tsx` for `data-axf-area`. It fails in both
 * directions — a marker nobody declared is an invisible menu, an area nobody
 * marks is a menu nobody can open — so a surface that marks areas must declare
 * them HERE, in the shape the scanner reads, whatever kind of surface it is.
 *
 * Consequently the same hard rule applies: **nothing but `import type`**. The
 * resolver reads this file under Node's native type stripping.
 *
 * The rows are deliberately navigational rather than clever. This page's whole
 * job is to send a reader at the surface being described, and a right-click
 * that offers exactly that is the shortest path there.
 */
import type { ModuleMenusDecl } from "@axf/core";

/**
 * Shaped `{ id, route, menus }` — the same three fields the conformance
 * scanner reads off a module decl — because that scanner is what registers
 * this file's areas when it boots its own map. It is NOT a `ModuleDecl`: there
 * is no component, no points, and nothing here joins the suite manifest or
 * spends one of its twelve slots.
 */
export const DOCS_DECL: {
  readonly id: string;
  readonly route: string;
  readonly menus: ModuleMenusDecl;
} = {
  id: "docs",
  route: "/docs",
  menus: {
    areas: [
      {
        id: "docs.surface",
        title: "Documentation",
        description: "Anywhere on the documentation page, including empty space."
      },
      {
        id: "docs.entry",
        title: "Documentation entry",
        description:
          "One feature, chain step or tutorial row. Carries the entry's id and its route, so the " +
          "menu can offer to open the surface the entry describes."
      }
    ],
    items: {
      "docs.surface": [
        { id: "goto-designer", label: "Open the Theme Designer", command: "docs.goto.theme-designer", order: 10 },
        { id: "goto-brand", label: "Open the Brand gallery", command: "docs.goto.brand", order: 20 },
        { id: "goto-settings", label: "Open Settings", command: "docs.goto.settings", order: 30 },
        { id: "goto-demo", label: "Open the Core Inspector", command: "docs.goto.demo", order: 40 },
        { id: "goto-buildmgr", label: "Open the Build Manager", command: "docs.goto.buildmgr", order: 50 },
        { id: "sep-1", label: "", role: "separator", order: 60 },
        { id: "copy-state", label: "Copy the project state summary", command: "docs.copy.state", order: 70 }
      ],
      "docs.entry": [
        {
          id: "open-entry",
          label: "Open the surface this describes",
          command: "docs.entry.open",
          enabledWhen: "docs.entry.hasRoute",
          order: 10
        },
        { id: "copy-entry", label: "Copy this entry", command: "docs.entry.copy", order: 20 },
        { id: "copy-paths", label: "Copy the file paths", command: "docs.entry.copyPaths", order: 30 }
      ]
    }
  }
};

/**
 * @file The Forge module's DECLARATION — data only, importable by plain Node.
 *
 * Same hard rule as every other decl: **nothing but `import type`**.
 * `scripts/peel.mjs` imports this under Node's native type stripping, and one
 * runtime import — React, a component, the core barrel — breaks the peel for
 * every module at once.
 *
 * ── MERGED, 2026-08-13, two concurrent sessions ──────────────────────────────
 *
 * Two sessions built a `forge` module in the same hour. One built the ROSTER
 * half: personas and skills across three scopes — the house set the studio
 * ships (`packages/studio/forge/`, the `studio` scope in
 * `agent-forge/forge.ts`), the repo's `.claude/`, and `~/.claude` — with
 * shadowing made visible. The other built the DESIGNER half: assistant-agent
 * CRUD, Claude agent/skill writers (the `.md.disabled` rename as the off
 * switch), tool definitions as data, and `.mcp.json` with launch / stop /
 * handshake-test. They are one module: the roster is what you read, the
 * designer is how you change it. This decl carries the union, and this note
 * exists so neither session re-derives the other's half as a mistake.
 *
 * ## Why a MODULE and not a route (§4.6)
 *
 * `/docs`, `/brand` and `/settings` are routes because each reads THIS install
 * and owns no workflow. The Forge owns one nothing else owns: authoring the
 * agent, skill, tool and MCP configuration the assistant, the CLI and the
 * studio itself consume — and since 2026-08-13 the personas it shows SHIP with
 * the studio, so a peeled app that carried the roster with no way to look at
 * it would be a peel with a hole in it.
 */
import type { ModuleDecl } from "@axf/core";

export const FORGE_DECL: ModuleDecl = {
  id: "forge",
  title: "Forge",
  summary:
    "The agent, skill, tool and MCP designer over the full roster: the house set the studio " +
    "ships, the repo's own .claude/, and your home directory's — created, edited, enabled, " +
    "disabled and (for MCP servers) launched and handshake-tested from one screen.",
  route: "/forge",
  glyph: "icon-bolt",
  menus: {
    areas: [
      {
        id: "forge.surface",
        title: "Forge",
        description: "Anywhere on the Forge screen — the module's own right-click surface."
      }
    ],
    items: {
      "forge.surface": [
        {
          id: "copy-selection",
          label: "Copy from the Forge",
          command: "ctx.copy",
          order: 10
        }
      ]
    }
  },
  /**
   * Settings as decl data (core 0.0.20). One row, and it passes the ceiling's
   * test: everything the designer half deletes — an agent file, a skill
   * directory, an MCP server entry — has no undo, and whether a designer
   * confirms destructive acts is a real difference in how it is safe to use.
   */
  settings: {
    ns: "forge-settings",
    rows: [
      {
        key: "confirmDelete",
        label: "Confirm deletes",
        hint: "Ask before deleting an agent, skill, tool or MCP server entry. Nothing here has an undo.",
        kind: "switch",
        defaultValue: true
      }
    ]
  },
  points: []
};

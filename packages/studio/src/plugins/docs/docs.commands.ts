/**
 * @file The behaviour behind the documentation page's context-menu rows.
 *
 * The menu is DATA on `docs.decl.ts`; the two meet only through a command
 * NAME. The engine parks the resolved click in `activeContext()`, and
 * `MenuContext.data` carries every `data-axf-*` attribute harvested up the
 * area chain — so the rows mark `data-axf-entry` / `data-axf-route` and these
 * handlers read `ctx.data.entry` and `ctx.data.route`.
 *
 * Registration is idempotent and must run BEFORE `registerModuleMenus` for
 * this decl: the map's gate refuses an item naming an unregistered command,
 * which is what makes a typo a loud boot failure rather than a dead row. Each
 * command is an inline `commands.register({ id: "…" })` literal, which is also
 * the shape `test/ctx-conformance.test.ts` scans for.
 *
 * Navigation is `window.location.assign`, matching the nav menu. It is a full
 * document load, which is deliberate here and everywhere else in this shell:
 * the pre-paint boot script and the server-rendered theme block only run on a
 * document load, so a full navigation is the path that has actually been
 * proven flash-free.
 */
import { activeContext, commands, predicates } from "@axf/core";

import { FEATURES } from "./docs.data";

/** The click's harvested data — `{}` when a command is fired from a palette. */
function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

function go(route: string): void {
  if (typeof window !== "undefined") window.location.assign(route);
}

/** Best-effort. A clipboard write can be refused and that is not an error worth
 *  throwing over a documentation page. */
function copy(text: string): void {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    /* refused — nothing to do, and nothing worth breaking the menu for */
  }
}

let registered = false;

export function registerDocsCommands(): void {
  if (registered) return;
  registered = true;

  /* ------------------------------------------------------ surface rows --- */

  // Written out one by one rather than looped over a table, which would be
  // shorter and would break a real gate: `test/ctx-conformance.test.ts` reads
  // every `*.commands.ts` for the literal `commands.register({ id: "…" })`
  // shape to learn which names a menu row may legally reference, and it cannot
  // evaluate a loop. A row naming a command the scanner cannot see is refused
  // at map registration — loudly, which is the design, but for a reason that
  // would be a puzzle rather than a message.

  if (!commands.has("docs.goto.theme-designer")) {
    commands.register({
      id: "docs.goto.theme-designer",
      title: "Open the Theme Designer",
      run: () => go("/theme-designer")
    });
  }

  if (!commands.has("docs.goto.brand")) {
    commands.register({
      id: "docs.goto.brand",
      title: "Open the Brand gallery",
      run: () => go("/brand")
    });
  }

  if (!commands.has("docs.goto.settings")) {
    commands.register({
      id: "docs.goto.settings",
      title: "Open Settings",
      run: () => go("/settings")
    });
  }

  if (!commands.has("docs.goto.demo")) {
    commands.register({
      id: "docs.goto.demo",
      title: "Open the Core Inspector",
      run: () => go("/demo")
    });
  }

  if (!commands.has("docs.goto.buildmgr")) {
    commands.register({
      id: "docs.goto.buildmgr",
      title: "Open the Build Manager",
      run: () => go("/buildmgr")
    });
  }

  if (!commands.has("docs.copy.state")) {
    commands.register({
      id: "docs.copy.state",
      title: "Copy the project state summary",
      run: () => {
        const by = (s: string) => FEATURES.filter((f) => f.status === s).length;
        copy(
          [
            "AmberX AI Studio — state as documented 2026-08-12",
            `built ${by("built")} · pending ${by("pending")} · cancelled ${by("cancelled")} · ` +
              `removed ${by("removed")} · superseded ${by("superseded")}`,
            "",
            ...FEATURES.filter((f) => f.status === "pending").map((f) => `PENDING  ${f.title}`)
          ].join("\n")
        );
      }
    });
  }

  /* -------------------------------------------------------- entry rows --- */

  if (!commands.has("docs.entry.open")) {
    commands.register({
      id: "docs.entry.open",
      title: "Open the surface this describes",
      run: () => {
        const route = ctxData().route;
        if (route) go(route);
      }
    });
  }

  if (!commands.has("docs.entry.copy")) {
    commands.register({
      id: "docs.entry.copy",
      title: "Copy this entry",
      run: () => {
        const entry = FEATURES.find((f) => f.id === ctxData().entry);
        if (!entry) return;
        copy(
          [
            `${entry.title}  [${entry.status}, ${entry.on}]`,
            "",
            entry.what,
            entry.why ? `\nWHY: ${entry.why}` : "",
            entry.where.length ? `\n${entry.where.join("\n")}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        );
      }
    });
  }

  if (!commands.has("docs.entry.copyPaths")) {
    commands.register({
      id: "docs.entry.copyPaths",
      title: "Copy the file paths",
      run: () => {
        const entry = FEATURES.find((f) => f.id === ctxData().entry);
        if (entry) copy(entry.where.join("\n"));
      }
    });
  }

  /* -------------------------------------------------------- predicates --- */

  // Availability, not presence: a feature with no route still SHOWS the row,
  // greyed, carrying the reason. A row that vanishes for half the list teaches
  // the reader the menu is inconsistent; a row that says why teaches them the
  // entry has no screen.
  if (!predicates.has("docs.entry.hasRoute")) {
    predicates.register({
      id: "docs.entry.hasRoute",
      title: "The entry names a route in this app",
      test: (ctx) =>
        ctx.data.route ? true : "this entry has no screen — it is engine internals, or it was removed"
    });
  }
}

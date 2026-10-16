"use client";

/**
 * @file The behaviour behind the Asset Browser's context-menu rows.
 *
 * The menu itself is DATA on `asset-browser.decl.ts`; the two meet only through
 * a command NAME (the taskman pattern, whose docblock carries the full
 * account). The engine parks the resolved click in `activeContext()`, and
 * `MenuContext.data` carries every `data-axf-*` attribute harvested up the area
 * chain — so the screens mark `data-axf-asset="<kind>:<id>"` and
 * `data-axf-kind="<kind>"` on their rows and these handlers read
 * `ctx.data.asset` / `ctx.data.kind`.
 *
 * Plain functions over the `assetBrowserView` singleton: a command mutating it
 * lands on every mounted surface at once, with nothing wired through props.
 *
 * Registration is idempotent and must run BEFORE
 * `registerModuleMenus(ASSET_BROWSER_DECL)` — the map's gate refuses an item
 * naming an unregistered command or predicate, which is what makes a typo in
 * the decl a loud boot failure rather than a dead row. Each command is an
 * inline `commands.register({ id: "…" })` literal, which is also the shape
 * `test/ctx-conformance.test.ts` scans for.
 */

import { activeContext, commands, predicates } from "@axf/core";

import { KIND_BY_ID } from "../../asset-browser/kinds";
import { assetBrowserSettings } from "./settings";
import { assetBrowserView } from "./view";

/** The click's harvested data — `{}` when a command is fired from a palette. */
function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

/** The right-clicked card's `<kind>:<id>` key, or null. */
function targetAsset(): string | null {
  return ctxData().asset ?? assetBrowserView.getState().selected;
}

/**
 * The kind in play: the right-clicked rail row, or the right-clicked card's
 * kind, or the kind already filtered to.
 *
 * Three fallbacks so the same command works from the rail, from a card and
 * from a command palette. A command that only works from one surface is a
 * command most of the app cannot use.
 */
function targetKind(): string | null {
  const data = ctxData();
  if (data.kind) return data.kind;
  const asset = data.asset ?? assetBrowserView.getState().selected;
  if (asset) return asset.slice(0, asset.indexOf(":"));
  return assetBrowserView.getState().kind;
}

/**
 * Copy, and say so.
 *
 * `navigator.clipboard` is unavailable over plain HTTP on a non-localhost
 * origin and rejects on a page without focus, so the failure is REPORTED
 * rather than swallowed — a copy row that silently does nothing is the
 * dead-button case the module contract forbids.
 */
function copy(text: string, what: string): void {
  navigator.clipboard
    .writeText(text)
    .then(() => assetBrowserView.say(`Copied ${what}`))
    .catch(() => assetBrowserView.say(`Could not reach the clipboard — ${what} is: ${text}`));
}

let registered = false;

/** Idempotent, HMR-tolerant — the taskman precedent. */
export function registerAssetBrowserCommands(): void {
  if (registered) return;
  registered = true;

  /* ------------------------------- predicates ------------------------------ */

  // Registered here, with the commands, because the map's gate refuses an item
  // naming an unregistered PREDICATE exactly as it refuses an unregistered
  // command — and both gates run in `registerModuleMenus`, which the subsystem
  // calls after this function.
  if (!predicates.has("asset-browser.mixed-view")) {
    predicates.register({
      id: "asset-browser.mixed-view",
      title: "The grid is showing more than one kind",
      test: () =>
        assetBrowserView.getState().kind === null
          ? true
          : "the grid is already filtered to one kind"
    });
  }

  /* --------------------------------- cards --------------------------------- */

  if (!commands.has("asset-browser.asset.select")) {
    commands.register({
      id: "asset-browser.asset.select",
      title: "Show this asset in the detail pane",
      run: () => {
        const key = targetAsset();
        if (key) assetBrowserView.select(key);
      }
    });
  }

  if (!commands.has("asset-browser.asset.copy-id")) {
    commands.register({
      id: "asset-browser.asset.copy-id",
      title: "Copy the asset id",
      run: () => {
        const key = targetAsset();
        if (!key) return;
        // The card key is `<kind>:<id>`; the ID is what resolves an asset
        // anywhere else, so that is what goes on the clipboard.
        copy(key.slice(key.indexOf(":") + 1), "the asset id");
      }
    });
  }

  if (!commands.has("asset-browser.asset.copy-source")) {
    commands.register({
      id: "asset-browser.asset.copy-source",
      title: "Copy the path of the source this asset is authored from",
      run: () => {
        const kind = targetKind();
        const entry = kind ? KIND_BY_ID[kind] : undefined;
        if (!entry) return;
        copy(entry.source, `the ${entry.display.toLowerCase()} source path`);
      }
    });
  }

  if (!commands.has("asset-browser.asset.copy-engine")) {
    commands.register({
      id: "asset-browser.asset.copy-engine",
      title: "Copy the generator command for this asset's kind",
      run: () => {
        const kind = targetKind();
        const entry = kind ? KIND_BY_ID[kind] : undefined;
        if (!entry) return;
        // A kind with no generator is a real state — packs and chrome assets
        // are authored in code or in a kv document. Saying so beats copying an
        // empty string that reads as a command somebody could run.
        if (!entry.generator) {
          assetBrowserView.say(`${entry.display} has no generator — it is authored in ${entry.source}`);
          return;
        }
        copy(entry.generator, `the ${entry.display.toLowerCase()} generator`);
      }
    });
  }

  if (!commands.has("asset-browser.asset.filter-to-kind")) {
    commands.register({
      id: "asset-browser.asset.filter-to-kind",
      title: "Show only this asset's kind",
      run: () => {
        const kind = targetKind();
        if (kind) assetBrowserView.focus(kind);
      }
    });
  }

  /* ---------------------------------- rail --------------------------------- */

  if (!commands.has("asset-browser.kind.focus")) {
    commands.register({
      id: "asset-browser.kind.focus",
      title: "Show only this kind",
      run: () => {
        const kind = targetKind();
        if (kind) assetBrowserView.focus(kind);
      }
    });
  }

  if (!commands.has("asset-browser.kind.all")) {
    commands.register({
      id: "asset-browser.kind.all",
      title: "Show every kind",
      run: () => {
        assetBrowserView.focus(null);
      }
    });
  }

  if (!commands.has("asset-browser.kind.copy-source")) {
    commands.register({
      id: "asset-browser.kind.copy-source",
      title: "Copy this kind's source path",
      run: () => {
        const kind = targetKind();
        const entry = kind ? KIND_BY_ID[kind] : undefined;
        if (entry) copy(entry.source, `the ${entry.display.toLowerCase()} source path`);
      }
    });
  }

  /* -------------------------------- surface -------------------------------- */

  if (!commands.has("asset-browser.reload")) {
    commands.register({
      id: "asset-browser.reload",
      title: "Re-read the asset catalog from disk",
      run: () => {
        assetBrowserView.reload();
        assetBrowserView.say("Re-reading the catalog…");
      }
    });
  }

  if (!commands.has("asset-browser.toggle-empty")) {
    commands.register({
      id: "asset-browser.toggle-empty",
      title: "Show or hide kinds with no instances",
      run: () => {
        // The SETTING is the state — one value, one place. A second flag on
        // the view store would drift from the sui the moment either was set
        // alone, and this row and that switch have to agree.
        const on = assetBrowserSettings.toggle("showEmptyKinds");
        assetBrowserView.say(on ? "Showing kinds with no instances" : "Hiding kinds with no instances");
      }
    });
  }
}

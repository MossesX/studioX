"use client";

/**
 * @file The behaviour behind the tab bar's menu rows, registered by NAME.
 *
 * The decl (`tab-bar.decl.ts`) holds the rows; this holds what they do, and the
 * two only ever meet through the command registry. That indirection is the
 * engine's rule rather than a preference here — a menu with closures in it can
 * only be edited by editing the file it lives in, and the overlay, the manager
 * and the packaging step all need it to be data.
 *
 * ── how a row knows WHICH tab it was opened on ────────────────────────────────
 *
 * It does not get handed one. Each tab marks itself `data-axf-tab="<id>"`, the
 * area walk harvests every `data-axf-*` it passes on the way up, and a command
 * reads `activeContext()?.data.tab` at the moment it runs. That is the same
 * mechanism core's own `toolbar.settings.open` uses for `data-axf-toolbar`, and
 * it is why commands can keep taking no arguments: a hotkey, a palette entry and
 * a menu row all fire the identical function.
 *
 * A row whose tab has vanished between the right-click and the click resolves to
 * nothing and returns. That is a real race (a cross-tab `storage` event can empty
 * the list while a menu is open) and the honest response is to do nothing rather
 * than to act on a stale id.
 */

import { activeContext, commands, getModuleSettings, predicates, settingsUi } from "@axf/core";

import { TAB_BAR_ID } from "./tab-bar.decl";
import {
  closeAllTabs,
  closeOtherTabs,
  closeTab,
  loadPinned,
  loadTabs,
  moveTab,
  successorTab,
  tabById,
  togglePinned
} from "./tabs";
import type { ModuleTab } from "./tabs";

/** Where the tab's id shows up in a resolved context: `data-axf-tab` arrives as
 *  `data.tab` (the walk drops the `axf` prefix and lowercases what follows).
 *  Spelled once, because the commands and the predicates must agree about it. */
const TAB_DATA_KEY = "tab";

/** The tab the menu was opened on, or null. */
function subject(): ModuleTab | null {
  const id = activeContext()?.data[TAB_DATA_KEY];
  return id ? tabById(id) : null;
}

/** The DISPLAYED order — what "left" and "right" mean to the reader. */
function displayOrder(): ModuleTab[] {
  const stored = loadTabs();
  return getModuleSettings(TAB_BAR_ID).newestFirst ? [...stored].reverse() : stored;
}

/** Displayed index of a tab, or -1. */
function displayIndex(id: string): number {
  return displayOrder().findIndex((t) => t.id === id);
}

/**
 * One step toward the left of the BAR, expressed in stored positions. Under
 * `newestFirst` the bar is drawn reversed, so "left" is +1 in storage — without
 * this the two rows would move tabs the opposite way for half the users.
 */
function leftward(): number {
  return getModuleSettings(TAB_BAR_ID).newestFirst ? 1 : -1;
}

function go(route: string): void {
  if (typeof window !== "undefined") window.location.assign(route);
}

/**
 * Close a tab and, when it is the one on screen, move off it — closing the
 * surface you are looking at has to leave you somewhere, exactly like an editor.
 * The tab to its right takes over, else the one to its left; with nothing left
 * the view stays put, and the surface simply has no tab until the next arrival.
 */
function dismiss(tab: ModuleTab): void {
  const order = displayOrder();
  const next = successorTab(order, tab.id);
  const onScreen =
    typeof window !== "undefined" &&
    (window.location.pathname === tab.route ||
      window.location.pathname.startsWith(`${tab.route}/`));
  closeTab(tab.id);
  if (onScreen && next) go(next.route);
}

let registered = false;

/** Take the tab bar's command and predicate names. Safe to call more than once —
 *  `CommandRegistry.register` throws on a duplicate, which is right for a real
 *  conflict and fatal under a dev-server re-evaluation. */
export function registerTabBarCommands(): void {
  if (registered) return;
  registered = true;

  commands.register({
    id: "tab-bar.settings.open",
    title: "Tab bar settings",
    icon: "icon-gear",
    // The shell's ONE settings dialog, opened on this plugin's own owner id.
    // `settings/store.ts` states that a plugin with settings registers them
    // under its plugin id exactly so this works — there is no second dialog,
    // and the rows come from the decl.
    run: () => settingsUi.open(TAB_BAR_ID)
  });

  commands.register({
    id: "tab-bar.pin.toggle",
    title: "Keep the tab bar open",
    run: () => {
      togglePinned();
    }
  });

  commands.register({
    id: "tab-bar.closeAll",
    title: "Close all tabs",
    run: () => {
      closeAllTabs();
    }
  });

  commands.register({
    id: "tab-bar.tab.go",
    title: "Go to this surface",
    run: () => {
      const tab = subject();
      if (tab) go(tab.route);
    }
  });

  commands.register({
    id: "tab-bar.tab.openWindow",
    title: "Open in a new browser tab",
    run: () => {
      const tab = subject();
      if (tab && typeof window !== "undefined") window.open(tab.route, "_blank", "noopener");
    }
  });

  commands.register({
    id: "tab-bar.tab.moveLeft",
    title: "Move tab left",
    run: () => {
      const tab = subject();
      if (tab) moveTab(tab.id, leftward());
    }
  });

  commands.register({
    id: "tab-bar.tab.moveRight",
    title: "Move tab right",
    run: () => {
      const tab = subject();
      if (tab) moveTab(tab.id, -leftward());
    }
  });

  commands.register({
    id: "tab-bar.tab.copyRoute",
    title: "Copy route",
    run: () => {
      const tab = subject();
      if (!tab || typeof navigator === "undefined") return;
      void navigator.clipboard?.writeText(tab.route).catch(() => {
        // Clipboard refused (no permission, unfocused document). Nothing to
        // undo; the row simply did not take, the same posture core's own copy
        // rows have.
      });
    }
  });

  commands.register({
    id: "tab-bar.tab.close",
    title: "Close tab",
    run: () => {
      const tab = subject();
      if (tab) dismiss(tab);
    }
  });

  commands.register({
    id: "tab-bar.tab.closeOthers",
    title: "Close other tabs",
    run: () => {
      const tab = subject();
      if (!tab) return;
      closeOtherTabs(tab.id);
      go(tab.route);
    }
  });

  /* ── predicates: presence, availability and the pin's checked state ─────── */

  predicates.register({
    id: "tab-bar.pinned",
    title: "The tab bar is pinned open",
    // A verdict is `true | string`, never `false` — the string is the reason a
    // row is greyed. On a `checkedWhen` the reason is never drawn (only `true`
    // means ticked), so it reads oddly here; the alternative is a second
    // predicate type for toggles, which is a worse trade than one unused
    // sentence.
    test: () => (loadPinned() ? true : "the bar is not pinned")
  });

  predicates.register({
    id: "tab-bar.hasTabs",
    title: "At least one tab is open",
    test: () => (loadTabs().length > 0 ? true : "no tabs are open")
  });

  predicates.register({
    id: "tab-bar.manyTabs",
    title: "More than one tab is open",
    test: () => (loadTabs().length > 1 ? true : "this is the only open tab")
  });

  predicates.register({
    id: "tab-bar.canMoveLeft",
    title: "The tab has a neighbour to its left",
    test: (ctx) => {
      const id = ctx.data[TAB_DATA_KEY];
      if (!id) return "the pointer is not over a tab";
      return displayIndex(id) > 0 ? true : "it is already first";
    }
  });

  predicates.register({
    id: "tab-bar.canMoveRight",
    title: "The tab has a neighbour to its right",
    test: (ctx) => {
      const id = ctx.data[TAB_DATA_KEY];
      if (!id) return "the pointer is not over a tab";
      const order = displayOrder();
      const at = order.findIndex((t) => t.id === id);
      return at >= 0 && at < order.length - 1 ? true : "it is already last";
    }
  });
}

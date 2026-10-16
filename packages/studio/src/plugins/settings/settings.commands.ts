/**
 * @file The behaviour behind `/settings`' context-menu rows.
 *
 * The menu is DATA on `settings.decl.ts`; the two meet only through a command
 * NAME. The engine parks the resolved click in `activeContext()`, and
 * `MenuContext.data` carries every `data-axf-*` attribute harvested up the
 * chain — so the cards mark `data-axf-pack` / `data-axf-pack-kind` /
 * `data-axf-banner` and these handlers read `ctx.data.pack`, `ctx.data.packKind`
 * and `ctx.data.banner`.
 *
 * Registration is idempotent and must run BEFORE `registerModuleMenus` for this
 * decl: the map's gate refuses an item naming an unregistered command or
 * predicate, which is what makes a typo a loud boot failure rather than a dead
 * row. Each one is an inline `commands.register({ id: "…" })` literal, which is
 * also the shape `test/ctx-conformance.test.ts` scans for — a loop over a table
 * would be shorter and would blind that scanner.
 *
 * ## Why applying here needs no Apply button
 *
 * A banner is the theme's `bannerBar` dial, and the theme store's rules are
 * "hot render, save instantly, no confirm step" everywhere EXCEPT inside the
 * designer, which puts the store in preview first. `/settings` never previews,
 * so `theme.setValue` here paints and persists in the same call — the same
 * bargain the pack picker on this page has always made, applied to the bar.
 *
 * A pack goes through `packs.activate()` (the user tier: outranks the app's
 * default and is saved immediately) and `packs.clearChoice()` is the way back
 * to whatever the app itself says its identity is.
 */
import { activeContext, commands, packs, predicates, theme } from "@axf/core";
import type { AnyPackage } from "@axf/core";

/** The click's harvested data — `{}` when a command is fired from a palette. */
function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

/**
 * Navigation is `window.location.assign`, matching the nav menu and the docs
 * page: the pre-paint boot script and the server-rendered theme block only run
 * on a document load, so a full navigation is the path proven flash-free.
 */
function go(route: string): void {
  if (typeof window !== "undefined") window.location.assign(route);
}

/** The banner id the theme names right now, `""` for "the app's default". */
function dialledBanner(): string {
  return String(theme.state().values.bannerBar ?? "").trim();
}

/** Whether `id` is the pack in force for its own slot. */
function packInForce(id: string): boolean {
  const style = packs.resolved();
  return style.brandingId === id || style.logoId === id;
}

let registered = false;

export function registerSettingsCommands(): void {
  if (registered) return;
  registered = true;

  /* ----------------------------------------------------------- pack rows --- */

  if (!commands.has("settings.pack.apply")) {
    commands.register({
      id: "settings.pack.apply",
      title: "Apply this pack to the app",
      run: () => {
        const id = ctxData().pack;
        if (id) packs.activate(id);
      }
    });
  }

  if (!commands.has("settings.pack.clear")) {
    commands.register({
      id: "settings.pack.clear",
      title: "Follow the app default for this slot",
      // The kind comes off the card rather than being inferred from the id: a
      // slot can be cleared while the pack that was in it is being looked at,
      // and `clearChoice` needs the SLOT, not the pack.
      run: () => {
        const kind = ctxData().packKind as AnyPackage["type"] | undefined;
        if (kind === "branding-package" || kind === "logo-package") packs.clearChoice(kind);
      }
    });
  }

  /* --------------------------------------------------------- banner rows --- */

  if (!commands.has("settings.banner.apply")) {
    commands.register({
      id: "settings.banner.apply",
      title: "Apply this banner to the app",
      run: () => {
        const id = ctxData().banner;
        if (id) theme.setValue("bannerBar", id);
      }
    });
  }

  if (!commands.has("settings.banner.clear")) {
    commands.register({
      id: "settings.banner.clear",
      title: "Use the app default banner",
      run: () => theme.setValue("bannerBar", "")
    });
  }

  /* ------------------------------------------------------ navigation rows --- */

  if (!commands.has("settings.goto.brand")) {
    commands.register({
      id: "settings.goto.brand",
      title: "Open the Brand gallery",
      run: () => go("/brand")
    });
  }

  if (!commands.has("settings.goto.designer")) {
    commands.register({
      id: "settings.goto.designer",
      title: "Open the Theme Designer",
      run: () => go("/theme-designer")
    });
  }

  /* -------------------------------------------------------- predicates --- */

  // Availability, not presence. A pack already in force still SHOWS its Apply
  // row, greyed, carrying the reason — which is also the clearest statement the
  // menu can make about which identity is running.
  if (!predicates.has("settings.pack.notInForce")) {
    predicates.register({
      id: "settings.pack.notInForce",
      title: "This pack is not the one in force",
      test: (ctx) => {
        const id = ctx.data.pack;
        if (!id) return "this card names no pack";
        return packInForce(id) ? "this pack is already in force" : true;
      }
    });
  }

  if (!predicates.has("settings.pack.chosen")) {
    predicates.register({
      id: "settings.pack.chosen",
      title: "This slot holds a saved selection rather than the app default",
      test: (ctx) => {
        const kind = ctx.data.packKind;
        if (!kind) return "this card names no slot";
        return packs.resolved().chosen.includes(kind as AnyPackage["type"])
          ? true
          : "this slot already follows the app default";
      }
    });
  }

  if (!predicates.has("settings.banner.notInForce")) {
    predicates.register({
      id: "settings.banner.notInForce",
      title: "This banner is not the one the theme names",
      test: (ctx) => {
        const id = ctx.data.banner;
        if (!id) return "this card names no banner";
        return dialledBanner() === id ? "this banner is already in force" : true;
      }
    });
  }

  if (!predicates.has("settings.banner.dialled")) {
    predicates.register({
      id: "settings.banner.dialled",
      title: "The theme names a banner of its own",
      test: () =>
        dialledBanner() ? true : "the app default banner is already in force"
    });
  }
}

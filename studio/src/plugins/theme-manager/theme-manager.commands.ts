/**
 * @file The behaviour behind the theme section's `accounts.token-row` menu.
 *
 * ## Why the AREA is declared by accounts and the COMMANDS live here
 *
 * The area is `accounts.token-row`, declared on `accounts.decl.ts` with the rest
 * of P10's map — the Theme Manager is one of the three cross-cutting
 * capabilities the admin suite justified, and its rows belong to that map. The
 * BEHAVIOUR belongs beside the machinery, which is here: `locate.ts` holds the
 * reverse token index, `ThemeManagerSection.tsx` draws the rows, and a command
 * that had to reach both from `src/modules/accounts/` would either duplicate the
 * index or import a plugin from a module.
 *
 * The engine does not mind. An area is an area, a command is a name, and the map
 * pairs them at registration — `test/ctx-conformance.test.ts` discovers every
 * `*.commands.ts` on disk and asserts the host calls each registrar BEFORE the
 * menus loop, so this file joins that gate by being written, with no edit there.
 *
 * ## Locate on page is the INVERSE of the section's own click-to-locate
 *
 * The section answers "which token paints this element". This answers "which
 * elements does this token paint", using the same index and the same
 * `matchTokens` comparison so the two directions can never disagree about what
 * counts as a match. Everything it does is an outline for a beat — it reads the
 * document and paints nothing durable, which is what keeps it inside P10's
 * doctrine that a map row locates rather than changes.
 *
 * ## Revert this token really removes the override
 *
 * `ThemeStore` has `setValue` and `clearOverrides` and nothing between them, so
 * "put this one dial back" is done by clearing and re-applying the others. That
 * is a real removal rather than a write of the base value over itself: an
 * override pinned to the value it was following would stop tracking a re-roll,
 * which is precisely the difference the Policies tab spends a whole sentence on.
 */
"use client";

import { DIALS_BY_ID, activeContext, commands, predicates, theme as themeStore } from "@axf/core";

import { buildTokenIndex, matchTokens, pageRgb } from "./locate";

/** How long a located element stays outlined — the section's own flash beat. */
const FLASH_MS = 1600;

/**
 * The most elements one *Locate on page* will outline.
 *
 * A bound rather than a scroll: `--axf-ink` paints most of the text on the
 * screen, and outlining nine hundred nodes is a flash of noise rather than an
 * answer. The status line says how many were found, so a capped run reports the
 * truth about what it did not draw — a silent truncation reads as "that is all
 * of them".
 */
const MAX_OUTLINED = 60;

/** The click's harvested data — `{}` when a command is fired from a palette. */
function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

/** The dial the right-clicked row edits. */
function targetDial(): string | null {
  const id = ctxData().token ?? null;
  return id && DIALS_BY_ID.has(id) ? id : null;
}

/** The value a dial holds in the theme in force. */
function valueOf(dialId: string): string {
  const values = themeStore.state().values;
  return String(values[dialId] ?? DIALS_BY_ID.get(dialId)?.default ?? "");
}

function copy(text: string): void {
  if (!text) return;
  void navigator.clipboard?.writeText(text).catch(() => {
    /* permission refused between opening the menu and clicking */
  });
}

/**
 * Outline every element this dial paints, for one beat.
 *
 * The scan is `document.body.querySelectorAll("*")` and one `getComputedStyle`
 * each, which is the only way to ask: a rendered element knows its VALUE, never
 * the custom property it came from, and that asymmetry is the whole reason
 * `locate.ts` exists. Elements inside the theme section itself are skipped —
 * every swatch in the list is painted with a token, so including them would make
 * the answer "the row you just right-clicked", every time.
 */
function locateOnPage(dialId: string): number {
  if (typeof document === "undefined" || typeof window === "undefined") return 0;
  const index = buildTokenIndex(themeStore.state().values);
  const background = pageRgb(index);
  const section = document.querySelector("[data-axf-theme-section]");

  let outlined = 0;
  let found = 0;
  for (const element of Array.from(document.body.querySelectorAll("*"))) {
    if (!(element instanceof HTMLElement)) continue;
    if (section?.contains(element)) continue;
    const computed = window.getComputedStyle(element);
    const matches = matchTokens(
      {
        color: computed.color,
        backgroundColor: computed.backgroundColor,
        borderColor: computed.borderTopColor,
        fontFamily: computed.fontFamily,
        borderRadius: computed.borderTopLeftRadius
      },
      index,
      background
    );
    if (!matches.some((m) => m.dialId === dialId)) continue;
    found += 1;
    if (outlined >= MAX_OUTLINED) continue;
    outlined += 1;
    // Restored to whatever it had, never to the empty string — an element with
    // its own inline outline would lose it. Same rule as the section's own.
    const previous = element.style.outline;
    element.style.outline = "2px dashed var(--axf-accent)";
    window.setTimeout(() => {
      element.style.outline = previous;
    }, FLASH_MS);
  }
  return found;
}

let registered = false;

/**
 * Register the token-row commands. Idempotent, for the reason every registrar in
 * this package is: `CommandRegistry.register` throws on a duplicate name, which
 * is right for a real conflict and fatal under a dev-server remount.
 */
export function registerThemeManagerCommands(): void {
  if (registered) return;
  registered = true;

  commands.register({
    id: "theme-manager.token.locate",
    title: "Locate a token on the page",
    run: () => {
      const dial = targetDial();
      if (!dial) return;
      const found = locateOnPage(dial);
      // The count is the answer when nothing is outlined, and the honest report
      // of a capped run when a lot is. `console.info` rather than a toast: this
      // section has no toast host, and its own status line belongs to the
      // component's state, which a command cannot reach.
      if (typeof console !== "undefined") {
        console.info(
          found === 0
            ? `[axs] ${DIALS_BY_ID.get(dial)?.cssVar ?? dial} paints nothing on this page right now`
            : found > MAX_OUTLINED
              ? `[axs] ${found} elements use ${DIALS_BY_ID.get(dial)?.cssVar ?? dial} — the first ${MAX_OUTLINED} are outlined`
              : `[axs] ${found} element(s) use ${DIALS_BY_ID.get(dial)?.cssVar ?? dial}`
        );
      }
    }
  });

  commands.register({
    id: "theme-manager.token.copy-value",
    title: "Copy a token's value",
    run: () => {
      const dial = targetDial();
      if (dial) copy(valueOf(dial));
    }
  });

  /**
   * Revert one dial to what the theme would give it — the roll's value under a
   * seed, the shipped default without one. See the file header for why this
   * clears and re-applies rather than writing the base value back.
   */
  commands.register({
    id: "theme-manager.token.revert",
    title: "Revert one token to the theme's own value",
    run: () => {
      const dial = targetDial();
      if (!dial) return;
      const { overrides } = themeStore.state();
      if (!Object.prototype.hasOwnProperty.call(overrides, dial)) return;
      const keep = Object.entries(overrides).filter(([id]) => id !== dial);
      themeStore.clearOverrides();
      for (const [id, value] of keep) themeStore.setValue(id, value);
    }
  });

  /* ------------------------------- predicates ------------------------------ */

  /** Greyed with a reason rather than hidden: "this token is not hand-edited" is
   *  a fact about the row worth reading, and it is exactly what tells somebody
   *  the colour they are looking at came from the roll rather than from them. */
  if (!predicates.has("theme-manager.token.edited")) {
    predicates.register({
      id: "theme-manager.token.edited",
      title: "This token carries a hand edit over the theme",
      test: (ctx) => {
        const dial = ctx.data.token;
        if (!dial) return "no token row was clicked";
        return Object.prototype.hasOwnProperty.call(themeStore.state().overrides, dial)
          ? true
          : "this token is not hand-edited — it is what the theme rolled";
      }
    });
  }
}

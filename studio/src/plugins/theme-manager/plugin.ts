/**
 * @file The Theme Manager's contributions — data only, Node-importable.
 *
 * Same hard rules as `tab-bar/plugin.ts`, and for the same reason: the closure
 * resolver (`scripts/lib/closure.mjs`) imports this file under plain Node with
 * native type stripping, and a plugin whose entry cannot run there is recorded
 * as UNSCANNED rather than skipped. So static imports are PACKAGES (`react`)
 * and `import type` only, the `.tsx` goes through `React.lazy`, and the id is a
 * literal rather than an import from a sibling — an extensionless relative
 * runtime import does not resolve under type stripping.
 *
 * ── ONE contribution, on purpose ──────────────────────────────────────────────
 *
 * `studio.settings-section`, and nothing else. The tab bar contributes three
 * because it has three audiences (a band on screen, a roster row, a settings
 * section); this plugin has exactly one surface and it is the section. In
 * particular there is no `studio.plugin` roster row: that payload's whole job is
 * to tell a plugin manager which settings row means "off", and a theme editor
 * has no off — turning it off would leave the settings page unable to reach the
 * app's own colours, which is not a state anybody wants to be able to reach by
 * accident.
 *
 * The section is the RENDERING kind (`studio.points.ts` documents the one
 * exception): its controls are a token editor over the dial spec, four gauges
 * over a seeded roll, and a click-interception mode. None of that is expressible
 * as `SettingRow`s, so it draws itself rather than naming a settings owner.
 */
import * as React from "react";

import type { Contribution } from "@axf/core";

import type { StudioSettingsSectionPayload } from "../../studio.points";

/** The asset id — a literal, per the docblock. */
const ID = "theme-manager";

const Section = React.lazy(() => import("./ThemeManagerSection"));

export const THEME_MANAGER_SETTINGS_SECTION: Contribution<StudioSettingsSectionPayload> = {
  from: ID,
  point: "studio.settings-section",
  // Above the tab bar's 10: the theme is what the rest of the page is about
  // (packs, banner), and a person on /settings looking for "the colours" should
  // not have to scroll past a plugin roster to find them.
  priority: 50,
  payload: {
    id: ID,
    title: "Theme",
    summary:
      "Roll a palette, turn any token by hand, and click anything on the page to find the token " +
      "that styles it. Saves named themes to your account.",
    render: () => React.createElement(Section)
  }
};

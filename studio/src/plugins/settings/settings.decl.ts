/**
 * @file `/settings`' context menus — DATA, like every other surface's.
 *
 * A `*.decl.ts` even though this is a PLUGIN rather than a module, for the
 * reason `docs.decl.ts` states about itself: `test/ctx-conformance.test.ts`
 * discovers the map by importing every `*.decl.ts` under `src/` and discovers
 * the DOM half by scanning every `.tsx` for `data-axf-area`. It fails in both
 * directions, so a surface that marks areas declares them HERE whatever kind of
 * surface it is. Same hard rule as every other decl: **nothing but
 * `import type`** — the resolver reads this file under Node's type stripping.
 *
 * ## Why the applying rows live in a MENU
 *
 * Owner, 2026-08-13: *"settings let me view logo and branding packs and apply
 * banner by right clicking and selecting apply to app"*. So the page's cards
 * are for LOOKING at an identity — a pack expands to its whole drawing sheet, a
 * banner to the items it draws — and the act of putting one in force is a
 * right-click away, in the one menu vocabulary the whole app already uses.
 *
 * Applying is still a left-click on the card as well, which is not a
 * contradiction: `/settings` inherited that from the pack picker it grew out of
 * ("hot render, save instantly, no confirm step"), and a menu row is an
 * addition to a surface, never the excuse to take an existing control away.
 *
 * The rows that cannot apply say why rather than vanishing — `enabledWhen`
 * predicates in `settings.commands.ts`, which is this engine's whole posture on
 * availability: a greyed row carrying a reason teaches the reader something, a
 * row that disappears for half the list teaches them the menu is unreliable.
 *
 * ## Why the card areas carry NO navigation rows
 *
 * A card is nested inside `settings.surface`, so a right-click on one composes
 * both areas. The two navigation rows therefore only have to be declared once,
 * on the surface, and they reach every card for free. Repeating them on the
 * card is not "belt and braces" — it draws the same label twice in one menu,
 * which is what the first cut of this decl did and what the composed menu
 * showed immediately.
 */
import type { ModuleMenusDecl } from "@axf/core";

/**
 * Shaped `{ id, route, menus }` — the three fields the conformance scanner
 * reads off a module decl. It is NOT a `ModuleDecl`: no component, no points,
 * and it spends none of the suite's twelve slots.
 */
export const SETTINGS_DECL: {
  readonly id: string;
  readonly route: string;
  readonly menus: ModuleMenusDecl;
} = {
  id: "settings",
  route: "/settings",
  menus: {
    areas: [
      {
        id: "settings.surface",
        title: "Settings",
        description: "Anywhere on the settings page, including empty space."
      },
      {
        id: "settings.pack",
        title: "Branding or logo pack",
        description:
          "One pack card. Carries the pack's id and its kind, so the menu can put it in force " +
          "or hand the slot back to the app's default."
      },
      {
        id: "settings.banner",
        title: "Banner toolbar",
        description:
          "One banner candidate. Carries the toolbar asset's id, so the menu can make it the " +
          "bar that draws the app banner."
      }
    ],
    items: {
      "settings.surface": [
        { id: "goto-brand", label: "Open the Brand gallery", command: "settings.goto.brand", order: 10 },
        { id: "goto-designer", label: "Open the Theme Designer", command: "settings.goto.designer", order: 20 }
      ],
      "settings.pack": [
        {
          id: "apply",
          label: "Apply to app",
          command: "settings.pack.apply",
          enabledWhen: "settings.pack.notInForce",
          order: 10
        },
        {
          id: "use-default",
          label: "Follow the app default",
          command: "settings.pack.clear",
          enabledWhen: "settings.pack.chosen",
          order: 20
        }
      ],
      "settings.banner": [
        {
          id: "apply",
          label: "Apply to app",
          command: "settings.banner.apply",
          enabledWhen: "settings.banner.notInForce",
          order: 10
        },
        {
          id: "use-default",
          label: "Use the app default banner",
          command: "settings.banner.clear",
          enabledWhen: "settings.banner.dialled",
          order: 20
        }
      ]
    }
  }
};

/**
 * @file The moderation wing, as a CONTRIBUTION to `accounts.admin-tab` (P17).
 *
 * Data only — a payload and a `load` thunk. That is what keeps this file
 * importable by plain Node (the closure resolver's rule, learned the hard way
 * by the plugin points: a field holding a component drags a `.tsx` into a data
 * import and the entry becomes unresolvable), and it is also what makes the
 * relationship one-directional: the accounts module never names AmberX Vid, the
 * registry does.
 *
 * MODULE-to-module rather than plugin-to-module, and that is deliberate rather
 * than a shortcut. The wing is not a separable asset: it acts on this module's
 * stores through this module's own verbs, and shipping it as a plugin would
 * imply a peel could leave it behind and still have a moderatable product.
 *
 * Registered in `src/studio.subsystem.ts`'s one contributions loop, alongside
 * every other contribution in the app.
 *
 * Named `adminTab.ts` after the POINT rather than `adminWing.ts` after the
 * pane, because Windows is case-insensitive and `adminWing.ts` beside
 * `AdminWing.tsx` is a TS1149 the compiler refuses — the same collision
 * `markdown.ts`/`Markdown.tsx` produced in the Claude workspace.
 */
import type { Contribution } from "@axf/core";

import type { AdminTabPayload } from "../accounts/adminTabs";

export const AMBERXVID_ADMIN_WING: Contribution<AdminTabPayload> = {
  from: "amberxvid",
  point: "accounts.admin-tab",
  priority: 20,
  payload: {
    id: "amberxvid-moderation",
    title: "AmberX Vid",
    glyph: "icon-play",
    summary:
      "The reports queue, live streams, the recording library, wall content and DB maintenance — " +
      "members, roles and storage stay the suite's own",
    load: () => import("./AdminWing")
  }
};

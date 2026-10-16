/**
 * @file `<PacksSeed>` — hands the request's pack selection to the registry that
 * actually renders.
 *
 * ## Why a component, and not a call in the server layout
 *
 * The obvious version — `packs.applyServerSelection(cookie)` at the top of
 * `app/layout.tsx` — looks right and does nothing. `layout.tsx` is a SERVER
 * component and `Glyph` is a CLIENT component, and Next compiles those into two
 * separate module graphs. The `packs` singleton the layout imports is therefore
 * NOT the singleton `Glyph` reads, even while both are executing on the server
 * during SSR. The seed landed on an instance nobody was rendering from, and the
 * server kept emitting the default identity.
 *
 * This is the same shape as the finding already recorded in PLANNING-STATE —
 * "`boot()` on the server populates the SERVER's registry; the browser bundle
 * evaluates `@axf/core` separately and gets its own" — and the note there is
 * worth repeating: **this will recur for every registry the framework grows.**
 * A module singleton is not a channel between the two graphs. A prop is.
 *
 * So the selection is read from the cookie by the server layout, passed down as
 * an ordinary serialisable prop, and applied here — inside the client graph,
 * where `Glyph` will look for it.
 *
 * ## Why it is applied during render rather than in an effect
 *
 * An effect runs after the tree has rendered, which is exactly too late: the
 * glyphs have already chosen their drawings by then, and correcting afterwards
 * is the swap this exists to remove. The call is idempotent and touches only a
 * memo, so doing it in the render phase is safe — and it must be, because there
 * is no earlier moment inside the client graph.
 *
 * Rendered as the FIRST child of the shell so it runs before anything resolves
 * a pack. React renders siblings in order, on both runtimes, so "before" means
 * the same thing during SSR and during hydration — which is what keeps the two
 * renders identical.
 */
"use client";

import type { ReactNode } from "react";
import { packs } from "@axf/core";

import { seedDefaultIdentity } from "./packs/default-identity";
import { seedBuiltinChrome } from "./chrome/builtins";
import { seedChromeAssets } from "./chrome/seed";
import type { ChromeAssetsDoc } from "./chrome/assets";

export default function PacksSeed({
  selection,
  chromeAssets,
  children
}: {
  selection: unknown;
  /** User-authored toolbar / nav-menu assets, read from disk by the server
   *  layout — registered here for the same two-graphs reason the pack
   *  selection is handed down as a prop. */
  chromeAssets?: ChromeAssetsDoc | null;
  children: ReactNode;
}) {
  // Render-phase, deliberately — see the docblock. Cheap and idempotent: it
  // stores a parsed record and drops one memoised snapshot.
  //
  // Identity BEFORE selection: `applyServerSelection` drops the memoised server
  // snapshot, so seeding after it would leave the snapshot holding the identity
  // that was in force before the packs existed.
  seedDefaultIdentity();
  packs.applyServerSelection(selection);
  // The BUILT-IN bars, menus and wrapper, for the identical reason the identity
  // is seeded here: they used to be registered only in `studio.subsystem.ts`'s
  // `start()`, which is reached through the async `boot()` and so runs in the
  // browser alone. The synchronous server render therefore found empty
  // registries — it emitted the red "no toolbar registered" card for
  // `app.banner` and `designer.tabs`, and no `<nav>` at all — and then failed
  // hydration when the browser drew the real chrome over it. Before the authored
  // assets, so a user bar can only ever be an addition to a complete set rather
  // than the only thing on a surface. See `chrome/builtins.ts`.
  seedBuiltinChrome();
  // Chrome assets after the identity: a custom bar's brand item resolves its
  // glyph against whatever identity is in force, and both are render-phase
  // idempotent seeds.
  seedChromeAssets(chromeAssets ?? null);
  return <>{children}</>;
}

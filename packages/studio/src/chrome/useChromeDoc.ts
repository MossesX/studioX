/**
 * @file `useChromeDoc` — read and write the user-authored chrome document.
 *
 * Lifted out of the theme designer's `chrome-bits.tsx` on 2026-08-13, when the
 * branding page's drag-and-drop editor became a SECOND writer of the same
 * document. The hook is not designer machinery — it is the document's client
 * API, and leaving it inside a plugin would have made another plugin import
 * that plugin's internals to save an asset. It lives with `assets.ts` and
 * `seed.ts` now; `chrome-bits.tsx` re-exports it, so the designer's tabs did
 * not move.
 *
 * Deliberately NOT `"use client"`-free like `assets.ts`: that module is parsed
 * by both graphs because the server layout reads the document from disk. This
 * one is hooks, so it is client-only by construction.
 */
"use client";

import * as React from "react";

import { EMPTY_CHROME, loadChromeAssets, saveChromeAssets } from "./assets";
import type { ChromeAssetsDoc } from "./assets";
import { seedChromeAssets } from "./seed";

/**
 * The user-authored chrome document, loaded once and written whole.
 *
 * Saving does three things in order: registry (so the running app hot-swaps
 * immediately), server (so it survives the browser), state (so the caller shows
 * what it did). The registry step goes through the same `seedChromeAssets` the
 * boot path uses — one writer, not a designer-private one.
 */
export function useChromeDoc() {
  const [doc, setDoc] = React.useState<ChromeAssetsDoc>(EMPTY_CHROME);
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void loadChromeAssets().then((remote) => {
      if (!alive) return;
      setDoc(remote);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = React.useCallback(async (next: ChromeAssetsDoc): Promise<boolean> => {
    setDoc(next);
    seedChromeAssets(next);
    return saveChromeAssets(next);
  }, []);

  return { doc, save, loaded };
}

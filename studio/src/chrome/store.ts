/**
 * @file Server-side read of the chrome-assets document — for `app/layout.tsx`.
 *
 * The layout cannot `fetch` its own API route during render, and does not need
 * to: the kv singleton is right there. **Node-only** (it pulls in `axfKv`,
 * which is `node:fs`); never import from a client component — the client gets
 * the document as a PROP through `<PacksSeed>`, which is the whole two-graphs
 * arrangement.
 */
import { axfKv } from "../server/axfKv";

import { CHROME_NS, parseChromeAssetsDoc } from "./assets";
import type { ChromeAssetsDoc } from "./assets";

export async function readChromeAssets(): Promise<ChromeAssetsDoc | null> {
  try {
    const doc = await axfKv.read("local", CHROME_NS);
    if (doc === null) return null;
    return parseChromeAssetsDoc(doc);
  } catch {
    // An unreadable document costs the custom chrome for this render, never
    // the page. The built-ins are registered by boot code either way.
    return null;
  }
}

/**
 * @file `/asset-browser` — the Graphical Asset Browser route.
 *
 * The route does NOT boot and does NOT import the screen: `BootedHost` boots
 * the client graph and resolves the module from the registry by id, which is
 * what proves the registry is doing real work rather than decorating a direct
 * import (same contract as `/`, `/demo`, `/taskman` and `/expenses`).
 *
 * Behind the session gate like every other module route — it is not in
 * `publicPaths.ts` and must not be. An unidentified visitor has no business
 * with a list of the studio's assets, and the gate exists to stop exactly that.
 */
import BootedHost from "../../src/BootedHost";

export default function AssetBrowserPage() {
  return <BootedHost moduleId="asset-browser" />;
}

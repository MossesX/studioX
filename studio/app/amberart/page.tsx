/**
 * @file `/amberart` — the AmberArt route.
 *
 * The route does NOT boot and does NOT import the screen: `BootedHost` boots
 * the client graph and resolves the module from the registry by id, which is
 * what proves the registry is doing real work rather than decorating a direct
 * import (same contract as `/`, `/demo`, `/taskman` and `/expenses`).
 *
 * It matters more here than anywhere else: AmberArt's tools arrive through the
 * `amberart.tool` point, and the boot is where those contributions register. A
 * route that imported the screen directly would render a rail with no plugins
 * and no explanation.
 */
import BootedHost from "../../src/BootedHost";

export default function AmberArtPage() {
  return <BootedHost moduleId="amberart" />;
}

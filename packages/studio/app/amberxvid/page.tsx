/**
 * @file `/amberxvid` — the AmberX Vid route.
 *
 * The route does NOT boot and does NOT import the screen: `BootedHost` boots
 * the client graph and resolves the module from the registry by id (same
 * contract as `/taskman`, `/` and `/demo`).
 */
import BootedHost from "../../src/BootedHost";

export default function AmberXVidPage() {
  return <BootedHost moduleId="amberxvid" />;
}

/**
 * @file `/accounts` — the Accounts route.
 *
 * The route does NOT boot and does NOT import the screen: `BootedHost` boots
 * the client graph and resolves the module from the registry by id, which is
 * what proves the registry is doing real work rather than decorating a direct
 * import (same contract as `/` and `/taskman`).
 *
 * `BootedHost` is also where the permission gate lives, so this route gets it
 * for free — as does every other module route, which is the reason the gate
 * went there rather than here.
 */
import BootedHost from "../../src/BootedHost";

export default function AccountsPage() {
  return <BootedHost moduleId="accounts" />;
}

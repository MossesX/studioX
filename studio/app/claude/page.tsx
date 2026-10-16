/**
 * @file `/claude` — the Claude workspace route.
 *
 * The route does NOT boot and does NOT import the screen: `BootedHost` boots
 * the client graph and resolves the module from the registry by id, which is
 * what proves the registry is doing real work rather than decorating a direct
 * import (the same contract as `/`, `/demo`, `/taskman` and `/expenses`).
 */
import BootedHost from "../../src/BootedHost";

export default function ClaudePage() {
  return <BootedHost moduleId="claude-workspace" />;
}

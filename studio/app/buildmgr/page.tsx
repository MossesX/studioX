/**
 * @file `/buildmgr` — the Build Manager route.
 *
 * The route does NOT boot and does NOT import the screen: `BootedHost` boots
 * the client graph and resolves the module from the registry by id, which is
 * what proves the registry is doing real work rather than decorating a direct
 * import (same contract as `/`, `/demo` and `/taskman`).
 *
 * It used to be the exception — a direct
 * `import BuildManagerPreview from "../../src/plugins/build-manager/…"` — which
 * is why the framework's own registries could not see the app's most
 * consequential surface. See `src/modules/buildmgr/buildmgr.decl.ts`.
 */
import BootedHost from "../../src/BootedHost";

export default function BuildManagerPage() {
  return <BootedHost moduleId="buildmgr" />;
}

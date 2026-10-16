/**
 * @file `/` — the landing: the dashboard module.
 *
 * Until v0.3.0 this was `<BootedHost moduleId="dashboard" />`; the "strip to
 * the frame" run deleted that module and this route spent the interregnum as a
 * plain MUI status page stating the stripped state of the tree. The dashboard
 * module is back as of 2026-08-11 — rebuilt on MUI over live sources — so the
 * route hands to the host again.
 *
 * The route does NOT boot and does NOT import the screen: `BootedHost` boots
 * the client graph and resolves the module from the registry by id, which is
 * what proves the registry is doing real work rather than decorating a direct
 * import (same contract as `/demo`).
 */
import BootedHost from "../src/BootedHost";

export default function HomePage() {
  return <BootedHost moduleId="dashboard" />;
}

/**
 * @file /demo — the Core Inspector route.
 *
 * The route does NOT boot. It hands straight to `BootedHost`, which boots the
 * client graph and resolves the module from the registry by id — the route
 * never imports the screen, which is what proves the registry is doing real
 * work rather than decorating a direct import.
 *
 * It used to `await boot()` here as well, and that was the bug behind
 * "No module registered with id \"demo\". Registered: (none)" — see
 * `src/BootedHost.tsx` for why a server component cannot boot this subsystem.
 */
import BootedHost from "../../src/BootedHost";

export default function DemoPage() {
  return <BootedHost moduleId="demo" />;
}

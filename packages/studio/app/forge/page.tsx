/**
 * @file `/forge` — a thin route. The module comes from the registry through
 * `BootedHost`; the route neither boots nor imports the screen, per the
 * standing pattern every module route follows.
 */
import BootedHost from "../../src/BootedHost";

export default function ForgePage() {
  return <BootedHost moduleId="forge" />;
}

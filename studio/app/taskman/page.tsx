/**
 * @file `/taskman` — the Task Manager route.
 *
 * The route does NOT boot and does NOT import the screen: `BootedHost` boots
 * the client graph and resolves the module from the registry by id, which is
 * what proves the registry is doing real work rather than decorating a direct
 * import (same contract as `/` and `/demo`).
 */
import BootedHost from "../../src/BootedHost";

export default function TaskmanPage() {
  return <BootedHost moduleId="taskman" />;
}

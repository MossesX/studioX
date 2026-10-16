/**
 * @file Boot — register every subsystem, then start the kernel.
 *
 * One `await` at the app's root, and it is idempotent, because Next re-executes
 * modules on refresh and a second boot would double-register everything.
 *
 * Registration order here is irrelevant: the kernel topologically sorts by
 * `requires`. That is deliberate — an ordering that depends on the order of
 * lines in this file is an ordering nobody can reason about once there are ten
 * subsystems.
 */
import { kernel } from "@axf/core";
import type { SubsystemStatus } from "@axf/core";

import { CLAUDE } from "./claude/claude.subsystem";
import { STUDIO } from "./studio.subsystem";

let started: Promise<SubsystemStatus[]> | null = null;

export function boot(): Promise<SubsystemStatus[]> {
  if (!started) {
    // Two subsystems. `claude` is back as of 2026-08-13 (`axf-claude` P1) —
    // it had been archived and deleted with its workspace module by the v0.3.0
    // P0 strip. Its `start()` only declares its three consumer points; the
    // service is server-only and is not reachable from this file, which runs
    // on both runtimes.
    //
    // The loop is still a loop rather than two calls: the kernel's topological
    // sort is what makes registration order irrelevant, and collapsing it is
    // how a package quietly grows an order-dependent boot again.
    if (!kernel.booted) {
      for (const subsystem of [STUDIO, CLAUDE]) kernel.register(subsystem);
    }
    started = kernel.boot();
  }
  return started;
}

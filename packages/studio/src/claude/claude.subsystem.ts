/**
 * @file Claude, declared as a SUBSYSTEM — `axf-claude` P1.
 *
 * Claude is framework-level infrastructure: transport to the local `claude`
 * CLI (the owner's subscription — no API key anywhere in this path),
 * conversation persistence, session resume, and a service API other assets
 * call. The workspace SCREEN is a separate asset — module `claude-workspace`,
 * P3 — and it consumes this subsystem through the same public API any plugin
 * would. One transport, one session store, many consumers: the assets being
 * absorbed (Agent Forge, the Build Manager plugin, the diff browser) must not
 * each carry their own Claude connection.
 *
 * `layer: "sdk"`: authoring infrastructure, never part of a peel closure. A
 * peeled app that needs a model gets it from the core AI broker — a separate,
 * later, core-layer subsystem. Session management is authoring, and authoring
 * is SDK; do not let the two merge.
 *
 * The kernel supervises this like everything else: `start()` runs once per
 * runtime, and it runs on BOTH runtimes — the server and the browser bundle
 * each evaluate `@axf/core` and get their own kernel and registry, the
 * per-runtime trap this codebase has already paid for once. All `start()` does
 * is declare the consumer points; the service itself is server-only
 * (`./service`) and is deliberately NOT imported here, because this file must
 * stay loadable in a client bundle.
 */
import { defineSubsystem, registry } from "@axf/core";

import { CLAUDE_POINTS, declareClaudePoints } from "./points";

export const CLAUDE = defineSubsystem({
  id: "claude",
  title: "Claude",
  summary:
    "Transport to the local claude CLI (subscription auth), conversation persistence, session " +
    "resume, and the service API other assets call.",
  layer: "sdk",
  points: CLAUDE_POINTS,
  start() {
    // Idempotent by construction: the server service's constructor declares
    // the same points, for routes that run before (or without) a kernel boot.
    declareClaudePoints(registry);
  }
});

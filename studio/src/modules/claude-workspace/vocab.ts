/**
 * @file The effort and permission vocabularies, for the surfaces that offer
 * them — the start dialog and the project editor.
 *
 * ── why these are RESTATED and not imported ──────────────────────────────────
 *
 * The literals live in `src/server/claudeBroker.ts`, which pulls in
 * `node:child_process` and must never reach a client bundle. A plain array copy
 * would drift silently, so each is a `Record<Union, string>` — adding a level to
 * the broker's union breaks this file at compile time, and removing one breaks
 * it too. That is the pin, and it is the same technique `MUI_DIAL_MAP` uses to
 * keep a dial from being silently dropped.
 *
 * ── why they are in their OWN file ───────────────────────────────────────────
 *
 * They started in `ClaudeWorkspaceModule.tsx`, which was right while the start
 * dialog was the only surface offering them. P4's project editor offers exactly
 * the same three choices — a project's default model, effort and permission
 * mode — and importing them from the module component would have been a cycle
 * (the module mounts the editor). The alternative was a second copy, which is
 * the one thing the `Record<Union, …>` pin above exists to prevent, one level
 * up: two pinned copies are two files that both compile and disagree.
 */

export type EffortValue = "low" | "medium" | "high" | "xhigh" | "max" | null;

export const EFFORT_LABELS: Record<NonNullable<EffortValue>, string> = {
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max"
};

export const EFFORT_LEVELS = Object.keys(EFFORT_LABELS) as NonNullable<EffortValue>[];

export type PermissionValue = "default" | "acceptEdits" | "plan" | "bypassPermissions";

export const PERMISSION_LABELS: Record<PermissionValue, string> = {
  default: "default — ask as configured",
  acceptEdits: "acceptEdits — file edits go through",
  plan: "plan — read only, no writes",
  bypassPermissions: "bypassPermissions — everything allowed"
};

export const PERMISSION_MODES = Object.keys(PERMISSION_LABELS) as PermissionValue[];

"use client";

/**
 * @file The workspace's two extension points, from the consuming side.
 *
 * The points themselves are DATA on `claude-workspace.decl.ts` — they have to
 * be, so the closure resolver can read them under plain Node. This file is the
 * runtime half: the payload types, and the two readers the screens use to draw
 * whatever has been contributed.
 *
 * Split for the reason every `<id>.decl.ts` in this tree is split: a decl that
 * imported `@axf/core`'s registry would stop being importable as data, and the
 * peel, the suite gate and `test/ctx-conformance.test.ts` all depend on it
 * being importable as data.
 *
 * ── the shape of a contribution, and the one decision in it ──────────────────
 *
 * A panel supplies `render()`, NOT a component and not props. It is called with
 * nothing and reads the open conversation from `session.ts` — the module's own
 * store, which is exported and stable. That is deliberate: passing the record
 * in as a prop would make the panel's signature part of the contract, so
 * widening it later (a project, in P4) would break every contribution. A store
 * a panel reads is a seam that widens without a version bump.
 *
 * A composer action's `run()` RETURNS TEXT rather than writing into the
 * composer, for the same class of reason: a contribution that could write into
 * the editor would need a handle on it, and a handle is a lifetime it does not
 * own. Returning a string (or nothing) keeps the caller in charge of the caret.
 */
import * as React from "react";

import { registry } from "@axf/core";
import type { Contribution } from "@axf/core";

import { CLAUDE_COMPOSER_ACTION_POINT, CLAUDE_PANEL_POINT } from "./claude-workspace.decl";

export { CLAUDE_COMPOSER_ACTION_POINT, CLAUDE_PANEL_POINT };

/** What a `claude-workspace.panel` contribution provides. */
export interface WorkspacePanelPayload {
  readonly title: string;
  /** Contract glyph id (`icon-*`). Optional — a panel with none gets no icon,
   *  never a broken one. */
  readonly glyph?: string;
  /** The pane's content. Called on every render of the side column. */
  readonly render: () => React.ReactNode;
}

/** What a `claude-workspace.composer-action` contribution provides. */
export interface ComposerActionPayload {
  readonly id: string;
  readonly label: string;
  readonly glyph?: string;
  /**
   * Run the action. A returned string is inserted at the composer's caret; a
   * returned `undefined` means the action did its work elsewhere (opened a
   * dialog, started a build) and the draft is untouched.
   */
  readonly run: () => string | undefined | Promise<string | undefined>;
}

/**
 * Contributions to a point, ordered as the point declares.
 *
 * `registry.contributionsTo` is the ONE reader — the screens do not keep their
 * own list, so a plugin registered after the first paint appears on the next
 * render rather than after a reload. It answers an empty array for a point
 * nobody has contributed to, which is why neither surface below needs a
 * "plugins not loaded yet" state.
 */
export function panelContributions(): readonly Contribution<WorkspacePanelPayload>[] {
  return registry.contributionsTo<WorkspacePanelPayload>(CLAUDE_PANEL_POINT);
}

export function composerActionContributions(): readonly Contribution<ComposerActionPayload>[] {
  return registry.contributionsTo<ComposerActionPayload>(CLAUDE_COMPOSER_ACTION_POINT);
}

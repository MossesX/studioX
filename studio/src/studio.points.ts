/**
 * @file The Studio subsystem's extension points — data only, importable by
 * plain Node.
 *
 * Split out of `studio.subsystem.ts` (2026-08-13) for the same reason every
 * module keeps its points on a `.decl.ts`: the subsystem file composes React
 * screens and cannot be imported under native type stripping, so a point
 * declared inline there is invisible to Node-side tooling. The first casualty
 * was `test/registry-scoping.test.ts` — its discovering scan replays every
 * declared point plus every plugin contribution into a fresh registry, and
 * `module-assistant → studio.assistant` read as a violation because the point
 * lived somewhere the scan could not reach.
 */
import type { ReactNode } from "react";

import type { ExtensionPoint } from "@axf/core";

/**
 * What a `studio.plugin` contribution provides — the roster row a future plugin
 * manager lists.
 *
 * Declared before the manager exists, deliberately, and for the reason
 * `claude/points.ts` states about `claude.tool`: *retrofitting a consumer API
 * after the first consumer arrives is how it ends up shaped for one caller.*
 * What a manager needs is what is here and nothing more — an identity, a
 * sentence, and the two ADDRESSES it needs to act rather than merely describe:
 * where the plugin's settings live, and which of its rows means "on".
 *
 * There is deliberately no `enabled` boolean and no `disable()` function on this
 * payload. A boolean would be a snapshot the manager could not write to, and a
 * function would put behaviour in a contribution that is otherwise pure data
 * (the rule the whole context-menu engine runs on). Naming the settings owner
 * and the key instead means the manager flips a plugin the same way the plugin's
 * own dialog does — one store, one value, no second switch that can disagree
 * with the first.
 */
export interface StudioPluginPayload {
  /** The plugin's asset id — matches its directory and its manifest. */
  readonly id: string;
  readonly title: string;
  /** One line: what it adds to the app. */
  readonly summary: string;
  /**
   * What it extends, so a manager can group by it rather than by guessing from
   * the id: `core` = the framework itself (a shell strip, a universal menu row),
   * `module` = a named module's points, `subsystem` = a service's points.
   */
  readonly target: "core" | "module" | "subsystem";
  /** Point ids this plugin contributes to — what it would stop doing if off. */
  readonly contributes: readonly string[];
  /** Settings owner id (`settings.get(...)`), when it declares settings. */
  readonly settingsOwner?: string;
  /** The row inside those settings that means "this plugin is on". */
  readonly enabledKey?: string;
}

/**
 * What a `studio.settings-section` contribution provides — one section in the
 * SDK's settings interface.
 *
 * The interface itself is `/settings` today (branding packs, the banner, reset
 * appearance) and will be more than that later; either way a plugin must not
 * have to edit that page to be configurable from it. So a section is a
 * contribution: id, title, a sentence, and the settings OWNER whose declared
 * rows the shell's one `SettingsDialog` already knows how to draw.
 *
 * For a section made of ROWS there is no `render` field, and that is the point
 * of the shape. A section that drew its own switches would be a second settings
 * UI with its own idea of what a switch looks like, which is exactly what
 * `settings/decl.ts` replaced four times over. A section names an owner; the
 * rows come from that owner's decl.
 *
 * ## The one exception, added 2026-08-15 with the Theme Manager
 *
 * `render` exists for a section that is **not rows at all** — a surface whose
 * controls have no counterpart in `SettingKind` and never will. The Theme
 * Manager is the case that forced it: a token editor over the whole dial spec,
 * four gauges that constrain a seeded roll, and a click-to-locate mode that
 * intercepts clicks on the rest of the page. None of that is a switch, a number
 * or a select, so declaring it as rows would not have produced a worse version
 * of the surface — it would have produced no surface.
 *
 * The rule the original shape protects is therefore kept as a rule rather than
 * as an absence: **a section whose settings ARE rows must name an `ownerId` and
 * must not supply a `render`.** One of the two is required, which is why
 * `ownerId` moved out of the point's `requires` — a field-presence check cannot
 * express "one of these", and `requires` listing a field half the contributions
 * legitimately omit is a gate that has to be ignored to be used.
 *
 * `SettingsPage`'s `SdkSettingsSections` is the consumer that enforces it: a
 * rendering section is drawn as its own card, a rows section gets a button that
 * opens the one shell-owned dialog, and a section that supplies NEITHER says so
 * on screen instead of rendering as an empty row.
 */
export interface StudioSettingsSectionPayload {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** Whose declared settings rows this section opens. Required unless `render`. */
  readonly ownerId?: string;
  /**
   * Draw the section itself. Only for a surface that is not rows — see above.
   * A thunk rather than an element, like every other UI point's payload, so a
   * contribution stays inert data until something decides to mount it.
   */
  readonly render?: () => ReactNode;
}

export const STUDIO_POINTS: readonly ExtensionPoint[] = [
  {
    id: "studio.inspector-pane",
    title: "Inspector pane",
    description:
      "A pane in Studio's inspector. Contributions supply a title and a component; Studio " +
      "decides where they sit.",
    kind: "ui-surface",
    cardinality: "many",
    requires: ["title", "render"],
    ordering: "priority"
  },
  {
    id: "studio.assistant",
    title: "Module assistant",
    description:
      "The one floating assistant surface the shell mounts on every route. Contributions " +
      "supply a title and a render; `AssistantHost` renders the first registered. Declared " +
      "as a point rather than an import so the assistant is swappable and crash-isolated " +
      "like every other contribution.",
    kind: "ui-surface",
    cardinality: "one",
    requires: ["title", "render"]
  },
  {
    id: "studio.plugin",
    title: "Plugin roster entry",
    description:
      "A plugin announcing itself to the plugin manager: id, title, summary, what it targets, " +
      "the points it contributes to, and — when it has settings — the settings owner and the row " +
      "that means 'on', so a manager can enable and disable it through the plugin's own store " +
      "rather than through a second switch. Declared before the manager exists, deliberately.",
    kind: "value",
    cardinality: "many",
    requires: ["id", "title", "summary", "target", "contributes"],
    ordering: "priority"
  },
  {
    id: "studio.settings-section",
    title: "SDK settings section",
    description:
      "A section in the SDK's settings interface. Names a settings OWNER rather than rendering " +
      "controls: the rows come from that owner's declared settings and are drawn by the one " +
      "shell-owned SettingsDialog, so a plugin is configurable from /settings without editing it. " +
      "A section whose controls are not rows at all (the Theme Manager's token editor) supplies a " +
      "`render` instead — which is why `ownerId` is not listed here: the contract is one of the " +
      "two, and `requires` is a field-presence check that cannot say so.",
    kind: "value",
    cardinality: "many",
    requires: ["id", "title", "summary"],
    ordering: "priority"
  }
];

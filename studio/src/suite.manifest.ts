/**
 * @file The SUITE manifest — what constitutes Studio, as DATA (INITIATION §4.4).
 *
 * "No new module type is needed — modules stay modules. What is missing is a
 * statement of *which* assets constitute Studio at a given version." This file
 * is that statement. Adding a module to Studio is a line in `modules` below
 * (plus its composition in studio.subsystem.ts) — never a new mechanism.
 *
 * DATA-ONLY, like every `<id>.decl.ts`: `scripts/suite.mjs` and the suite gate
 * (test/suite.test.ts) import this file under plain Node, so nothing but
 * `import type` may appear here. The closure is not written here — it is
 * RESOLVED from this list by the same resolver the peel uses
 * (scripts/lib/closure.mjs), pointed inward, and committed as
 * `suite.resolved.generated.json`, whose `--check` mode fails when stale.
 *
 * Versions are pinned collectively, not per entry: assets do not version
 * independently of the tree yet, so the resolved artifact pins @axf/core (the
 * framework) and @axs/studio (the tree). Per-entry pins arrive with packaging
 * (F3), which is what first gives an asset a version of its own.
 */

/**
 * INITIATION §4.6: "The suite caps at 12 module-kind assets. The thirteenth
 * replaces one; it does not join it." Raising this is a deliberate one-line
 * edit with an author on it — that is the point. The cap binds the manifest
 * below (enforced by test/suite.test.ts and `npm run suite`), NEVER what the
 * SDK builds: an SDK user's modules are not Studio's scope problem.
 */
export const SUITE_MODULE_CAP = 12;

export interface SuiteManifest {
  /** Authored-manifest format tag — bumped only on a shape change. */
  readonly format: "axs-suite-manifest/1";
  /** The distribution's asset id. */
  readonly id: string;
  readonly title: string;
  /**
   * The module-kind members: ids of `src/modules/<id>/`, each with a data-only
   * `<id>.decl.ts` the resolver can read. Capped at SUITE_MODULE_CAP; the
   * resolver fails the suite on any drift against the directories on disk.
   */
  readonly modules: readonly string[];
}

export const SUITE: SuiteManifest = {
  format: "axs-suite-manifest/1",
  id: "axs-studio",
  title: "AmberX AI Studio",
  // 12 of 12 slots used — FULL as of 2026-08-16, when `asset-browser` took the
  // last one (its case is written out beside its entry below).
  //
  // `buildmgr` took slot 4 on 2026-08-11 by PROMOTION, not
  // construction: the screen already existed, already ran real builds through
  // `bmpx_builder.py`, and had already been rebuilt on MUI — but
  // `app/buildmgr/page.tsx` imported the component directly, so it belonged to
  // no registry at all. It is the only member that arrived by being registered
  // rather than by being written, and the "should this be a module?" test below
  // is what it was measured against: it owns a workflow nothing else owns.
  //
  // `taskman` returned 2026-08-11 on the owner's
  // instruction to import GizmoX's taskflow with its context menus — restored
  // from the pre-strip archive with the pure layer (types, ops, store, seed,
  // decl, commands) verbatim and every screen rebuilt on MUI. Its Grid view is
  // the one archived surface not yet rebuilt; TaskmanModule's docblock says so
  // and names the zip it is preserved in.
  //
  // The v0.3.0 P0 "strip to the frame" run took all four
  // members (claude-workspace, dashboard, demo, taskman) down to zero so the
  // MUI rebuild starts from the frame; P2 restored `demo` on MUI, and
  // `dashboard` returned 2026-08-11 rebuilt on MUI over live sources (owner
  // approval: "build the dashboard first"). The other two stay archived.
  //
  // The default answer to "should this be a module?" is still NO (§4.6): it
  // must own state or a workflow nothing else owns, cohere as a peeled
  // standalone app, and be impossible as a plugin or extension on an existing
  // module's declared points. Failing the third is the common case, and the
  // correct outcome is a plugin.
  //
  // (P5's line here used to read "P5 rebuilds the Build Manager as the first
  // MUI module; it takes slot 2." P5 rebuilt it on MUI but never registered it,
  // which is exactly how a working screen ends up invisible to the framework —
  // the note said "module" and the outcome was a direct import.)
  //
  // `demo` (the Core Inspector) is back as of P2, 2026-08-10, on the owner's
  // standing instruction to restore it as MUI — and because three of P2's own
  // gates need a registered module to exist at all: `npm run peel` takes a
  // module id and reads `src/modules/<id>/`, `ModuleHost`/`Slot` have no
  // subject without one, and the crash-isolation mutation needs a module screen
  // and a plugin contribution to tell "module failed" from "plugin failed".
  // The resolver reads `src/modules/*` off disk and fails on drift in either
  // direction, so this line and that directory cannot disagree.
  //
  // `expenses` took slot 5 on 2026-08-12 — GizmoX's Expense Tracker, imported
  // on the owner's "import expenses module from gizmox". The pure cents-math
  // engine (types/math) came verbatim; Grid/Tree/Statements were rebuilt on
  // MUI; menus are decl data; the sui is one switch; the ledger persists
  // through the kv store. It passes §4.6 on the first clause: it owns state
  // nothing else owns (the expense ledger and its statement math).
  //
  // `claude-workspace` took slot 7 on 2026-08-13 (`axf-claude` P3). It is the
  // one member that was on the v0.3.0 P0 strip list and came BACK: the strip
  // took it with the subsystem it consumed, and P1 rebuilt that subsystem as a
  // service API rather than a private back door — so the screen returned as a
  // consumer of `/api/claude/*` that imports nothing of `src/claude/` but its
  // isomorphic vocabulary. It passes §4.6 on all three clauses, which is rare:
  // it owns a workflow nothing else owns (conversations), it coheres as a
  // peeled app, and it cannot be a plugin because it publishes the points other
  // assets plug INTO.
  modules: [
    // `asset-browser` joined 2026-08-16 (slot 12 of 12 — THE LAST ONE). One
    // screen over every UI-related graphical asset: logo kits and landings out
    // of the asset registry, branding and logo packs out of core's PackRegistry,
    // and the toolbars, nav menus and dashboard wrappers held in the one
    // chrome-assets document.
    //
    // Taking the last slot is a decision and not an accident, so the §4.6 case
    // is written out rather than assumed:
    //
    //   · **Owns a workflow nothing else owns.** Authoring a graphical asset is
    //     currently split across four surfaces that each see a slice — the
    //     theme designer builds bars and menus, /settings picks a pack, the
    //     login-landing gallery previews logo kits, and the generators run on
    //     the command line. Nothing anywhere answers "what graphical assets
    //     exist, how is each one authored, and what points at what". The
    //     reference graph is the sharpest form of that: a rename that has to
    //     cascade cannot be performed by a surface that can only see one kind.
    //   · **Coheres peeled.** An asset manager over a registry, a pack roster
    //     and a chrome document is a product in its own right.
    //   · **Cannot be a plugin.** It would have to plug into an existing
    //     module's declared point, and no module owns "every graphical asset" —
    //     the theme designer is a plugin over the THEME, and hanging a
    //     cross-kind manager off it would make the browser a subordinate of one
    //     of the seven things it manages.
    //
    // The thirteenth REPLACES one; it does not join it. Whoever is holding that
    // decision should read this list first — `demo` (the Core Inspector) is the
    // member most nearly a diagnostic rather than a product.
    "asset-browser",
    // `accounts` joined 2026-08-13 (slot 11 of 12): the user-account engine —
    // account CRUD with roles, the profile engine (avatar, bio, custom fields,
    // presence), internal messaging, and the administrator-controlled
    // permission matrix. It passes §4.6's first clause outright: it owns
    // identity, permissions and messaging, and nothing else in the suite owns
    // any of the three — every other member consumes the verdict rather than
    // producing it, which is exactly what `BootedHost`'s gate reading
    // `usePermission` makes literal. It fails the plugin test on the same
    // fact: no existing module declares a point that could host the thing
    // deciding which modules may be opened.
    "accounts",
    "amberart",
    // `amberxvid` joined 2026-08-13 (slot 9 of 12): GizmoX's video suite,
    // imported whole. It passes §4.6's first clause outright — it owns a
    // workflow nothing else in the suite owns: capture (screen/camera
    // recording, including the hand-off to the Windows tray service), a media
    // library over what that capture produces, and real-time comms (messenger,
    // P2P video chat, streams). It fails the plugin test for the same reason
    // `forge` does: none of those three is an existing module's declared point,
    // and it carries its own login, profiles and admin surface besides.
    "amberxvid",
    "buildmgr",
    "claude-workspace",
    "dashboard",
    "demo",
    "expenses",
    // `firecrawl` joined 2026-08-13 (slot 10 of 12): the web-data workbench —
    // multi-step Firecrawl pipelines (search / scrape / map), Fireball
    // Freddy's plain-english AI analysis between steps, loops over the links
    // he picks, and the datasets runs produce. It passes §4.6's first clause
    // (it owns a workflow nothing else owns: authoring and running web-data
    // pipelines, and the dataset store they fill) and the third (no existing
    // module declares a point that could host a pipeline builder, a run
    // engine and a dataset manager; the assistant's chat window is a chat,
    // not an engine). It coheres peeled: a Firecrawl client is a product in
    // its own right.
    "firecrawl",
    // `forge` joined 2026-08-13 (slot 8 of 12): the agent/skill/tool/MCP
    // designer. It passes §4.6's first clause (it owns the authoring workflow
    // nothing else owns — the assistant's roster, the CLI's on-disk agents
    // and skills, tool definitions, `.mcp.json` and its processes) and the
    // third (it cannot be a plugin: it spans four backends none of which is
    // an existing module's point).
    "forge",
    "taskman"
  ]
};

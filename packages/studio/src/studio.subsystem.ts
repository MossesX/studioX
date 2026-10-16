/**
 * @file Studio, declared as a SUBSYSTEM.
 *
 * Studio is framework-level infrastructure that extends the core: an
 * always-available service providing the capability to author, inspect and
 * build assets. It is not an application sitting on the framework, and the
 * distinction has teeth — a module is peelable, and "peel the workshop into a
 * standalone app" is a category error. `layer: "sdk"` is what keeps it out of
 * every peel closure.
 *
 * Its `start()` is where it registers what it provides. WHAT Studio consists
 * of is stated as data in `src/suite.manifest.ts` (the suite manifest,
 * INITIATION §4.4); this file is the composition point where those members
 * meet their components and registrations. The suite gate (test/suite.test.ts)
 * holds the two together — a manifest member this file never composes fails it.
 */
import {
  declareCtxItemPoint,
  declareShellStripPoint,
  declareUniversalArea,
  defineSubsystem,
  installCtxContributions,
  packs,
  registerCtxCommands,
  registerModuleMenus,
  registerModuleSettings,
  registry
} from "@axf/core";

import { ACCOUNTS_DECL } from "./modules/accounts/accounts.decl";
import { ACCOUNTS_MODULE } from "./modules/accounts/accounts.module";
import { ASSET_BROWSER_DECL } from "./modules/asset-browser/asset-browser.decl";
import { ASSET_BROWSER_MODULE } from "./modules/asset-browser/asset-browser.module";
import { registerAssetBrowserCommands } from "./modules/asset-browser/asset-browser.commands";
import { BUILDMGR_DECL } from "./modules/buildmgr/buildmgr.decl";
import { BUILDMGR_MODULE } from "./modules/buildmgr/buildmgr.module";
import { CLAUDE_WORKSPACE_DECL } from "./modules/claude-workspace/claude-workspace.decl";
import { CLAUDE_WORKSPACE_MODULE } from "./modules/claude-workspace/claude-workspace.module";
import { registerClaudeWorkspaceCommands } from "./modules/claude-workspace/claude-workspace.commands";
import { DASHBOARD_DECL } from "./modules/dashboard/dashboard.decl";
import { DASHBOARD_MODULE } from "./modules/dashboard/dashboard.module";
import { DEMO_DECL } from "./modules/demo/demo.decl";
import { DEMO_MODULE } from "./modules/demo/demo.module";
import { AMBERART_DECL } from "./modules/amberart/amberart.decl";
import { AMBERART_MODULE } from "./modules/amberart/amberart.module";
import { registerAmberArtCommands } from "./modules/amberart/amberart.commands";
import { registerAmberXVidCommands } from "./modules/amberxvid/amberxvid.commands";
import { AMBERXVID_DECL } from "./modules/amberxvid/amberxvid.decl";
import { AMBERXVID_MODULE } from "./modules/amberxvid/amberxvid.module";
import { ARTGEN_CONTRIBUTION } from "./plugins/amberart-artgen/plugin";
import { DRAWING_LAB_CONTRIBUTION } from "./plugins/amberart-drawing-lab/plugin";
import { STICKERS_CONTRIBUTION } from "./plugins/amberart-stickers/plugin";
import { TESSELLATE_CONTRIBUTION } from "./plugins/amberart-tessellate/plugin";
import { EXPENSES_DECL } from "./modules/expenses/expenses.decl";
import { EXPENSES_MODULE } from "./modules/expenses/expenses.module";
import { registerBuildmgrCommands } from "./modules/buildmgr/buildmgr.commands";
import { registerExpensesCommands } from "./modules/expenses/expenses.commands";
import { FIRECRAWL_DECL } from "./modules/firecrawl/firecrawl.decl";
import { FIRECRAWL_MODULE } from "./modules/firecrawl/firecrawl.module";
import { registerFirecrawlCommands } from "./modules/firecrawl/firecrawl.commands";
import { FORGE_DECL } from "./modules/forge/forge.decl";
import { FORGE_MODULE } from "./modules/forge/forge.module";
import { TASKMAN_DECL } from "./modules/taskman/taskman.decl";
import { TASKMAN_MODULE } from "./modules/taskman/taskman.module";
import { registerAccountsCommands } from "./modules/accounts/accounts.commands";
import { registerTaskmanCommands } from "./modules/taskman/taskman.commands";
import { DEMO_BADGE_CONTRIBUTION, DEMO_NOTE_CONTRIBUTION } from "./plugins/demo-badge/plugin";
import { ASSISTANT_CTX_ITEM, ASSISTANT_WINDOW } from "./plugins/module-assistant/plugin";
import { registerAssistantCommands } from "./plugins/module-assistant/assistant.commands";
import { AGENT_FORGE_BRIEF_ACTION, AGENT_FORGE_PANEL } from "./plugins/agent-forge/plugin";
import { DIFF_BROWSER_PANEL, DIFF_BROWSER_QUOTE_ACTION } from "./plugins/diff-browser/plugin";
import { AMBERXVID_ADMIN_WING } from "./modules/amberxvid/adminTab";
import { AMBERXVID_ASSISTANT_TURN_METER } from "./modules/amberxvid/creditsMeterContributions";
import { AMBERXVID_POINT_CONTRIBUTIONS } from "./modules/amberxvid/pointContributions";
import { PROJECT_STATE_PLUGIN } from "./plugins/project-state/plugin";
import { registerProjectStateCommands } from "./plugins/project-state/project-state.commands";
import { DOCS_DECL } from "./plugins/docs/docs.decl";
import { registerDocsCommands } from "./plugins/docs/docs.commands";
import { BRAND_GALLERY_DECL } from "./plugins/brand-gallery/brand-gallery.decl";
import { SETTINGS_DECL } from "./plugins/settings/settings.decl";
import { registerSettingsCommands } from "./plugins/settings/settings.commands";
import { TAB_BAR_DECL } from "./plugins/tab-bar/tab-bar.decl";
import { registerTabBarCommands } from "./plugins/tab-bar/tab-bar.commands";
import { PLUGIN_MANAGER_DECL } from "./plugins/plugin-manager/plugin-manager.decl";
import { registerPluginManagerCommands } from "./plugins/plugin-manager/plugin-manager.commands";
import {
  PLUGIN_MANAGER_PLUGIN,
  PLUGIN_MANAGER_SETTINGS_SECTION
} from "./plugins/plugin-manager/plugin";
import { installPluginModules } from "./plugins/plugin-manager/install";
import { INSTALLED_PLUGINS } from "./plugins/installed.generated";
import {
  TAB_BAR_PLUGIN,
  TAB_BAR_SETTINGS_SECTION,
  TAB_BAR_STRIP
} from "./plugins/tab-bar/plugin";
import { THEME_MANAGER_SETTINGS_SECTION } from "./plugins/theme-manager/plugin";
import { registerThemeManagerCommands } from "./plugins/theme-manager/theme-manager.commands";
import { STUDIO_POINTS } from "./studio.points";
import { AMBER_BRANDING, AMBER_LOGOS } from "./packs/amber";
import { SIGNAL_BRANDING, SIGNAL_LOGOS } from "./packs/signal";
import { seedDefaultIdentity } from "./packs/default-identity";
import { seedBuiltinChrome } from "./chrome/builtins";
import { registerShellCommands } from "./toolbars/shell-commands";

export const STUDIO = defineSubsystem({
  id: "studio",
  title: "AmberX AI Studio",
  summary:
    "Authoring infrastructure: registers the assets that make up Studio and provides the surfaces " +
    "for inspecting and building them.",
  layer: "sdk",
  // The points live in `studio.points.ts` — a Node-importable leaf, so the
  // discovering tests and any future tooling can read them without loading
  // this file's React graph.
  points: STUDIO_POINTS,
  start() {
    // ── TWO MODULES (2026-08-11) ──
    //
    // The v0.3.0 P0 "strip to the frame" run archived and deleted all four
    // (demo, taskman, dashboard, claude-workspace) so the MUI rebuild starts
    // from the frame rather than from four screens written against the token()
    // era. P2 restored `demo` — the Core Inspector — rebuilt on MUI, per the
    // owner's standing instruction and because P2's own gates need a
    // registered module: `npm run peel` reads `src/modules/<id>/`,
    // `ModuleHost`/`Slot` have no subject without one, and the crash-isolation
    // mutation needs both a module screen and a plugin contribution to prove
    // "module failed" and "plugin failed" are told apart.
    //
    // `dashboard` is back as of 2026-08-11 (owner approval: "build the
    // dashboard first") — the card screen rebuilt on MUI over LIVE sources,
    // with the grid engine and its test restored verbatim from the pre-strip
    // archive. `/` mounts it through BootedHost again. `taskman` and
    // `claude-workspace` stay archived; P5 rebuilds the Build Manager as the
    // next module and registers here too.
    // `buildmgr` joined 2026-08-11 — PROMOTED, not built. It had been a real,
    // MUI-rebuilt screen driving real runs for weeks; what it had never been is
    // a registered one, because `app/buildmgr/page.tsx` imported the component
    // directly. So the framework's own registries could not see the surface
    // that runs the builds: no peel closure, no inspector count, nothing for
    // `ModuleDecl.menus` to attach to.
    for (const mod of [
      DASHBOARD_MODULE,
      DEMO_MODULE,
      TASKMAN_MODULE,
      BUILDMGR_MODULE,
      EXPENSES_MODULE,
      AMBERART_MODULE,
      // `forge` (2026-08-13, slot 8/12): the agent/skill/tool/MCP designer —
      // see the suite manifest's note for the §4.6 case.
      FORGE_MODULE,
      // `amberxvid` (2026-08-13, slot 9/12): GizmoX's video suite imported
      // whole — splash, module login, recorder, library, messenger, P2P video
      // chat, streams, profiles, admin window and the Windows tray hand-off.
      // See the suite manifest's note for the §4.6 case.
      AMBERXVID_MODULE,
      // `firecrawl` (2026-08-13, slot 10/12): the web-data workbench — multi-
      // step Firecrawl pipelines with Fireball Freddy's AI analysis between
      // steps. See the suite manifest's note for the §4.6 case.
      FIRECRAWL_MODULE,
      // `accounts` (2026-08-13, slot 11/12): the user-account engine — account
      // CRUD with roles, the profile engine, internal messaging, and the
      // permission matrix whose verdict `BootedHost` enforces for every module
      // route. See the suite manifest's note for the §4.6 case.
      ACCOUNTS_MODULE,
      // `claude-workspace` returned 2026-08-13 (`axf-claude` P3). It was on the
      // v0.3.0 P0 strip list with the other three; unlike them it came back
      // built against a subsystem that had ALSO been rebuilt in the meantime,
      // so the screen consumes P1's service API over HTTP and imports nothing
      // from `src/claude/` but its isomorphic vocabulary. It publishes the two
      // UI points (`claude-workspace.panel`, `.composer-action`) that P5
      // absorbs Agent Forge, the diff browser and the Build Manager plugin
      // through — declared before a consumer exists, deliberately.
      CLAUDE_WORKSPACE_MODULE,
      // `asset-browser` (2026-08-16, slot 12/12 — THE LAST ONE): one screen
      // over every UI-related graphical asset, across all three of the
      // lifecycles `src/asset-browser/kinds.ts` recorded. The suite manifest
      // carries the §4.6 case and the note about what a thirteenth would have
      // to replace.
      ASSET_BROWSER_MODULE
    ]) {
      registry.registerModule(mod);
    }
    // AmberArt's four tool plugins contribute to `amberart.tool` — the first
    // point in AmberX a user can actually feel. The module does not import
    // them; this loop is the only link, which is what makes the closure
    // computable (core `points.ts`).
    //
    // Agent Forge and the difference browser joined 2026-08-13 (`axf-claude`
    // P5): the two assets the owner asked to have absorbed INTO Claude, each
    // arriving through the workspace's two declared UI points rather than by
    // being imported into its screen. Both were deleted by the v0.3.0 P0 strip
    // and restored from its archive — the diff engine and Agent Forge's scan
    // core verbatim, every `.tsx` rebuilt on MUI.
    //
    // ONE list, deliberately mixed: this loop is also the scoping proof. Five
    // different points are contributed to here in no particular order, and the
    // registry files each contribution under the point it NAMES — so the
    // workspace's panel column shows two panels and not five, and AmberArt's
    // tool rail shows three tools and not five. `test/registry-scoping.test.ts`
    // asserts exactly that against the real contributions.
    //
    // Agent Forge's THIRD contribution is not here. `claude.context-provider`
    // runs server-side and reads the filesystem; it is registered by
    // `src/server/plugins.ts` from the route that starts a turn, because this
    // file is evaluated in the browser bundle.
    // The subsystem's OWN points, declared to the registry the way the claude
    // subsystem declares its three (`declareClaudePoints`): a `points:` field
    // on the spec is documentation until something puts it in the registry,
    // and a contribution to an undeclared point is refused — which is how the
    // assistant window silently failed to mount the first time (found live:
    // the registry recorded the violation and `AssistantHost` read an empty
    // list). Existence-checked so a re-evaluation is a no-op.
    for (const point of STUDIO_POINTS) {
      if (!registry.points().some((p) => p.id === point.id)) {
        registry.declarePoint(point);
      }
    }
    // `ctx.item` belongs to no module — declared straight onto the registry
    // before the loop below contributes to it (the registry refuses an
    // undeclared point, which is the property being relied on, not fought).
    declareCtxItemPoint(registry);
    // `shell.strip` (core 0.0.22) belongs to no module either — it is the
    // SHELL's, and the tab bar below contributes to it. Declared here for the
    // same reason and in the same breath: core owns the point, a host puts it
    // in the registry, and a contribution to an undeclared point is refused
    // rather than dropped.
    declareShellStripPoint(registry);

    for (const contribution of [
      DEMO_BADGE_CONTRIBUTION,
      DEMO_NOTE_CONTRIBUTION,
      TESSELLATE_CONTRIBUTION,
      DRAWING_LAB_CONTRIBUTION,
      ARTGEN_CONTRIBUTION,
      STICKERS_CONTRIBUTION,
      AGENT_FORGE_PANEL,
      AGENT_FORGE_BRIEF_ACTION,
      DIFF_BROWSER_PANEL,
      DIFF_BROWSER_QUOTE_ACTION,
      // The Module Assistant (2026-08-13): the floating chat window on
      // `studio.assistant`, and its "Ask the assistant" row on the universal
      // context-menu band via `ctx.item`.
      ASSISTANT_WINDOW,
      ASSISTANT_CTX_ITEM,
      // The tab bar (2026-08-13), imported from GizmoX's top-strip. THREE
      // contributions from one plugin, to three points with three different
      // audiences: the band itself on the shell's `shell.strip`, a roster row
      // on `studio.plugin` for the plugin manager, and a section on
      // `studio.settings-section` for the SDK's settings interface. It is the
      // first plugin here that targets the CORE rather than a module — nothing
      // about it is hosted by a screen.
      TAB_BAR_STRIP,
      TAB_BAR_PLUGIN,
      TAB_BAR_SETTINGS_SECTION,
      // The Plugin Manager (2026-08-13) — the consumer `studio.plugin` and
      // `studio.settings-section` were declared FOR, finally arrived. It
      // announces itself on both, so it appears in its own roster: a manager
      // that could not manage itself would be exempt from its own contract.
      PLUGIN_MANAGER_PLUGIN,
      PLUGIN_MANAGER_SETTINGS_SECTION,
      // The Theme Manager (2026-08-15) — the first RENDERING settings section,
      // and the reason `studio.settings-section` grew an optional `render`. One
      // contribution and no roster row on purpose: a theme editor has no "off"
      // row for a plugin manager to flip, and turning it off would leave
      // /settings unable to reach the app's own colours.
      THEME_MANAGER_SETTINGS_SECTION,
      // Project State (2026-08-14): the session-reading generator behind
      // /project-state. Its roster row is its ONLY point contribution — the
      // bar and the command register through their own registries below.
      PROJECT_STATE_PLUGIN,
      // AmberX Vid's moderation wing (2026-08-15) — the first contribution to
      // `accounts.admin-tab`, and the first MODULE-to-module one in the app.
      // It is what keeps the suite the one place administration happens: the
      // wing renders as a tab inside it rather than as a second console, and
      // every act it fires writes the accounts audit log, which the suite
      // already shows.
      AMBERXVID_ADMIN_WING,
      // AmberX Vid's built-in credit meter (P18, 2026-08-15) — the assistant
      // turn, contributed to the module's OWN `amberxvid.credits-meter` point.
      // A built-in could have been chargeable from the server table alone; it
      // goes through the registry so that "what costs credits here" is a
      // question the system can answer, which is what the peel and the meter
      // list both need. See `creditsMeterContributions.ts`.
      AMBERXVID_ASSISTANT_TURN_METER,
      // AmberX Vid's own four contributions to its own points (P19,
      // 2026-08-15) — the follow control, the room-tile host badge, the AI
      // credits card and the message copy action. Every one of them MOVED off
      // an inline call site in a screen: the owner's model is that one default
      // ships and the rest install as plugins, so the built-in goes through the
      // same door a plugin's would rather than being wired in behind it. That
      // is also what proves the points render — a point nobody has rendered
      // through is a guess about a shape. See `pointContributions.ts`.
      ...AMBERXVID_POINT_CONTRIBUTIONS
    ]) {
      registry.contribute(contribution);
    }

    // A LOOP over a list, not one call — and it stays a loop at one member on
    // purpose. `test/ctx-conformance.test.ts` reads this exact shape to learn
    // which decls the host registers, so that a module declaring context-menu
    // areas the host never registers is a failing gate rather than a screen
    // whose right-click quietly does less. Collapsing it to a bare call breaks
    // that scanner, which refuses to answer rather than answering emptily —
    // which is what it did when this was first written as a single call.
    // Taskman's own commands must be registered BEFORE the menus loop below:
    // the map's gate refuses an item naming an unregistered command, which is
    // what makes a typo in the decl a loud boot failure rather than a dead row.
    // `test/ctx-conformance.test.ts` asserts this ORDERING by source index, not
    // merely that the call exists.
    // Accounts' twenty commands. MISSING until 2026-08-15, and it was not a
    // dead row — it was the whole app: `accounts.decl.ts` declares menus naming
    // these, `registerModuleMenus` refuses an item naming an unregistered
    // command, and that refusal threw out of `start()` BEFORE the chrome seed
    // below. Every bar in the studio went with it, so the visible symptom was
    // "no toolbar registered for surface app.banner" on every screen — a boot
    // abort wearing a rendering bug's clothes.
    // `test/ctx-conformance.test.ts` names this exact omission.
    //
    // That symptom can no longer reach the screen the same way: `<PacksSeed>`
    // registers the built-in chrome in the render phase, before `start()` has
    // run at all, so a boot abort now costs the app its BEHAVIOUR and not its
    // bars. Which makes this ordering rule quieter, not less real — the gate
    // above is still what catches it.
    registerAccountsCommands();
    registerTaskmanCommands();
    registerExpensesCommands();
    registerBuildmgrCommands();
    registerAmberArtCommands();
    // AmberX Vid's, same ordering rule and by far the largest set: nine areas
    // carrying thirty-eight rows that name thirty-four commands and eighteen
    // predicates. The map's gate refuses an item naming an unregistered one, so
    // this call is what makes a typo in the decl a loud boot failure.
    registerAmberXVidCommands();
    registerClaudeWorkspaceCommands();
    // Firecrawl's, same ordering rule: its four areas name seventeen commands
    // and the map's gate refuses an item naming an unregistered one.
    registerFirecrawlCommands();
    // `/docs` is a PLUGIN, not a module — it spends no suite slot. Its menus go
    // through the same seam anyway, because there is only one: the map does not
    // care what kind of surface declared an area, and a second registration path
    // for plugin menus would be the parallel mechanism `ModuleDecl.menus` was
    // built to avoid.
    registerDocsCommands();
    // `/settings` is a plugin too, and its menu is the one the owner asked for
    // by name (2026-08-13): right-click a pack or a banner card, *Apply to
    // app*. Same seam, same ordering rule — the rows name these commands and
    // these predicates, so they must exist before the loop below reads them.
    registerSettingsCommands();
    // The Theme Manager's three, same seam and same ordering rule. Added
    // 2026-08-15 alongside the accounts omission above: its settings section
    // shipped and its commands did not, so its rows named commands that did not
    // exist and the map's gate refused them at boot.
    registerThemeManagerCommands();
    // The assistant's commands, before anything (the universal ctx row, the
    // command bar) resolves them by name.
    registerAssistantCommands();
    // The tab bar's, on the same ordering rule: its two areas carry nine rows
    // naming nine commands and five predicates, and the map's gate refuses an
    // item naming an unregistered one — so a typo here is a loud boot failure
    // rather than a dead row.
    registerTabBarCommands();
    // The Plugin Manager's, same rule: its two areas name seven commands and
    // two predicates before the menus loop reads its decl.
    registerPluginManagerCommands();
    // Project State's one command, before anything (its own bar) resolves it
    // by name. It declares no menus, so no decl joins the loops below.
    registerProjectStateCommands();
    // The Asset Browser's nine commands and one predicate, same ordering rule:
    // its three areas name them and the map's gate refuses an item naming an
    // unregistered one, so this call is what makes a typo in the decl a loud
    // boot failure rather than a dead row.
    registerAssetBrowserCommands();

    // BUILDMGR_DECL joined 2026-08-13 with its first declared area — the
    // Assign-model row on `buildmgr.step`. No comments INSIDE the array:
    // test/ctx-conformance.test.ts parses this exact literal by source text.
    for (const mod of [
      ACCOUNTS_DECL,
      ASSET_BROWSER_DECL,
      DASHBOARD_DECL,
      DEMO_DECL,
      TASKMAN_DECL,
      BUILDMGR_DECL,
      EXPENSES_DECL,
      AMBERART_DECL,
      AMBERXVID_DECL,
      CLAUDE_WORKSPACE_DECL,
      FIRECRAWL_DECL,
      FORGE_DECL,
      DOCS_DECL,
      SETTINGS_DECL,
      BRAND_GALLERY_DECL,
      TAB_BAR_DECL,
      PLUGIN_MANAGER_DECL
    ]) {
      registerModuleMenus({ id: mod.id, menus: mod.menus });
    }

    // Module settings (core 0.0.20) — the same seam shape as the menus loop
    // above: decls carry the rows, this host registers them, and a decl with
    // no `settings` field is a no-op.
    for (const mod of [
      ACCOUNTS_DECL,
      ASSET_BROWSER_DECL,
      DASHBOARD_DECL,
      DEMO_DECL,
      TASKMAN_DECL,
      BUILDMGR_DECL,
      EXPENSES_DECL,
      AMBERART_DECL,
      AMBERXVID_DECL,
      CLAUDE_WORKSPACE_DECL,
      FIRECRAWL_DECL,
      FORGE_DECL,
      // A PLUGIN in a list of module decls, and the seam takes it unchanged:
      // `registerModuleSettings` wants an `{ id, settings }`, and its own
      // docblock says plugins with settings of their own register under their
      // plugin id. That is what makes the shell's one dialog open on the tab
      // bar's rows without a second dialog existing anywhere.
      TAB_BAR_DECL,
      // The Plugin Manager's one switch, through the same seam.
      PLUGIN_MANAGER_DECL
    ]) {
      registerModuleSettings(mod);
    }

    // ── ctx.item contributions land in the menu map (2026-08-13) ──
    //
    // `declareCtxItemPoint` + `installCtxContributions` were built and tested
    // in core (P3) but never called from Studio's boot — the assistant's
    // universal row is the first real consumer, so this is where the wiring
    // arrives. Order is load-bearing: the map's gate refuses an item naming
    // an unregistered command, and a contribution to an undeclared area, so
    // the ctx commands and the universal AREA must exist first.
    // `ContextMenuRoot` calls `declareUniversalArea` again on mount; both
    // are idempotent by design.
    registerCtxCommands();
    declareUniversalArea();
    installCtxContributions();

    // ── imported plugins land (2026-08-13) ──
    //
    // The generated loader (`plugins/installed.generated.ts`, rewritten by the
    // plugin engine on import/uninstall/flip) hands over one entry-module
    // namespace per ENABLED imported plugin, and `installPluginModules` does
    // with each export what this file does with the built-ins above: commands
    // first, contributions to the registry, decl menus and settings through
    // the same seams. AFTER the ctx wiring on purpose — an imported plugin's
    // rows may target the universal area, which must exist first. Per-plugin
    // failures are caught and reported, never allowed to take the boot down:
    // that is the crash-isolation posture at registration time.
    installPluginModules(INSTALLED_PLUGINS);

    // The pack roster: every branding/logo pack the settings page can offer.
    // Style packages are GONE (2026-08-12) — a pack is drawings, and colours
    // belong to the theme's dials. Signal and Amber register as candidates;
    // the merged studio pack and the AmberX-mark logo pack register (and the
    // app default is stated) in `seedDefaultIdentity`, which BOTH module
    // graphs call — it runs here too, so a bare kernel boot (tests, a peeled
    // host) still gets the house identity without the Next layout involved.
    packs.register(SIGNAL_BRANDING);
    packs.register(SIGNAL_LOGOS);
    packs.register(AMBER_BRANDING);
    packs.register(AMBER_LOGOS);
    seedDefaultIdentity();

    // Every built-in chrome asset: the three `banner-*` candidates, the command
    // bar that is the app.banner default, the console's two bars, the Task
    // Manager rail, the designer's tab strip, the /project-state bar, the two
    // navigation menus and the console wrapper. The roster and the reason each
    // one is on it live in `chrome/builtins.ts`.
    //
    // It is NOT a `toolbars.register(...)` run here any more, and that is the
    // whole point: `start()` is reached through the async `boot()`, so it runs
    // in the browser only, and a synchronous server render in the other module
    // graph used to finish against an empty registry — server-rendering the
    // red "no toolbar registered" card for every surface and then failing
    // hydration when the browser drew a real bar in its place. Measured on
    // 2026-08-15; `chrome/builtins.ts` carries the full account. The seed is
    // idempotent, so whichever of this and `<PacksSeed>` runs first wins and
    // the other is a no-op — which is also why `register()`'s
    // throw-on-duplicate no longer takes the boot down when both run.
    seedBuiltinChrome();

    // The command bar's handlers register by name with the core command
    // registry — the bar itself stays data, which is what lets the seed above
    // run in a render phase that has no business installing behaviour.
    registerShellCommands();
  }
});

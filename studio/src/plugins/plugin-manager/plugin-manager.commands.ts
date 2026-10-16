/**
 * @file The behaviour behind the Plugin Manager's context-menu rows.
 *
 * The menu is DATA on `plugin-manager.decl.ts`; the two meet only through a
 * command NAME. Rows mark `data-axf-plugin` / `data-axf-settings-owner` /
 * `data-axf-enabled-key`, the area walk harvests them with the `axf` prefix
 * dropped, and these handlers read `ctx.data.plugin`, `.settingsOwner` and
 * `.enabledKey`.
 *
 * Registration is idempotent and must run BEFORE `registerModuleMenus` for
 * this decl: the map's gate refuses an item naming an unregistered command.
 * Each command is an inline `commands.register({ id: "…" })` literal — the
 * shape `test/ctx-conformance.test.ts` scans for; a loop would be shorter and
 * would blind the scanner.
 *
 * The page-shaped verbs (refresh, import) reach the page through a window
 * event rather than a shared store: the commands must be registrable before
 * the page exists (a palette can fire them from any route), and an event to a
 * page that is not there is honestly nothing, where a store the page forgot to
 * read would be a silent switch. The event name is exported and the page
 * subscribes to exactly it.
 */
import { activeContext, commands, predicates, settings, settingsUi } from "@axf/core";

/** Fired at `window` by the refresh/import commands; the page listens. */
export const PLUGIN_MANAGER_EVENT = "axs:plugin-manager";

export type PluginManagerVerb = "refresh" | "import";

function say(verb: PluginManagerVerb): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PLUGIN_MANAGER_EVENT, { detail: { verb } }));
  }
}

/** The click's harvested data — `{}` when fired from a palette. */
function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

function go(route: string): void {
  if (typeof window !== "undefined") window.location.assign(route);
}

function copy(text: string): void {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    /* refused — nothing worth breaking the menu for */
  }
}

let registered = false;

export function registerPluginManagerCommands(): void {
  if (registered) return;
  registered = true;

  /* ------------------------------------------------------ surface rows --- */

  if (!commands.has("plugin-manager.refresh")) {
    commands.register({
      id: "plugin-manager.refresh",
      title: "Refresh the plugin roster",
      run: () => {
        // Off the page this is a navigation; on it, the page hears the event
        // and re-fetches without a document load.
        if (window.location.pathname === "/plugins") say("refresh");
        else go("/plugins");
      }
    });
  }

  if (!commands.has("plugin-manager.import")) {
    commands.register({
      id: "plugin-manager.import",
      title: "Import a plugin package",
      run: () => {
        if (window.location.pathname === "/plugins") say("import");
        else go("/plugins?import=1");
      }
    });
  }

  if (!commands.has("plugin-manager.goto.settings")) {
    commands.register({
      id: "plugin-manager.goto.settings",
      title: "Open Settings",
      run: () => go("/settings")
    });
  }

  if (!commands.has("plugin-manager.goto.docs")) {
    commands.register({
      id: "plugin-manager.goto.docs",
      title: "Open Documentation",
      run: () => go("/docs")
    });
  }

  /* -------------------------------------------------------- entry rows --- */

  if (!commands.has("plugin-manager.entry.settings")) {
    commands.register({
      id: "plugin-manager.entry.settings",
      title: "Open this plugin's settings",
      run: () => {
        const owner = ctxData().settingsOwner;
        if (owner && settings.has(owner)) settingsUi.open(owner);
      }
    });
  }

  if (!commands.has("plugin-manager.entry.toggle")) {
    commands.register({
      id: "plugin-manager.entry.toggle",
      title: "Enable or disable this plugin",
      run: () => {
        const data = ctxData();
        const owner = data.settingsOwner;
        const key = data.enabledKey;
        if (!owner || !key) return;
        const store = settings.get(owner);
        if (!store) return;
        // The flip goes through the plugin's OWN store — the same write its
        // own dialog makes, so there is no second switch to disagree with.
        store.set(key, !Boolean(store.getState()[key] ?? true));
      }
    });
  }

  if (!commands.has("plugin-manager.entry.export")) {
    commands.register({
      id: "plugin-manager.entry.export",
      title: "Export this plugin as a package",
      run: () => {
        const id = ctxData().plugin;
        // A navigation, not a fetch: the route answers with
        // `content-disposition: attachment`, so the document stays put and the
        // browser takes the download.
        if (id) go(`/api/plugins/${encodeURIComponent(id)}/export`);
      }
    });
  }

  if (!commands.has("plugin-manager.entry.copy")) {
    commands.register({
      id: "plugin-manager.entry.copy",
      title: "Copy the plugin id",
      run: () => {
        const id = ctxData().plugin;
        if (id) copy(id);
      }
    });
  }

  /* -------------------------------------------------------- predicates --- */

  // Availability with a reason, not absence: a plugin with no settings still
  // shows the row, greyed, saying why — the menu stays consistent across the
  // roster and teaches what each plugin declares.
  if (!predicates.has("plugin-manager.entry.hasSettings")) {
    predicates.register({
      id: "plugin-manager.entry.hasSettings",
      title: "The plugin declares settings",
      test: (ctx) =>
        ctx.data.settingsOwner && settings.has(ctx.data.settingsOwner)
          ? true
          : "this plugin declares no settings"
    });
  }

  if (!predicates.has("plugin-manager.entry.hasEnableSwitch")) {
    predicates.register({
      id: "plugin-manager.entry.hasEnableSwitch",
      title: "The plugin declares an enable switch",
      test: (ctx) =>
        ctx.data.enabledKey
          ? true
          : "this plugin declares no enable switch — it is always on while registered"
    });
  }
}

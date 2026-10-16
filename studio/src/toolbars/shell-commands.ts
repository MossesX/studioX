/**
 * @file The command bar's handlers — registered by NAME at subsystem start.
 *
 * The pattern (proven in the first P4 run and recorded in PLANNING-STATE):
 * handlers register with the core command registry under their names, and any
 * handler whose behaviour is SHELL STATE — open the menu, open the palette,
 * show a toast — dispatches ONE CustomEvent that the mounted `ShellOverlays`
 * component listens for. That keeps the handlers registrable at start (before
 * any React tree exists, on either runtime) while the state lives where state
 * belongs, in the component that renders it.
 *
 * `nav.home` needs no overlay: it navigates, the same way `NavMenu` does.
 * Window access happens at CALL time only, so registering on the server
 * runtime is harmless — nothing invokes a command there.
 *
 * `dashboard.swap` (P8) cycles the dashboard-wrapper registry — the P8 gate is
 * the swap OBSERVED live around the card screen, and the sandbox's picker
 * cannot be clicked while `/` is on screen (the registry is per-tab, and a
 * hard navigation remounts everything, which is exactly what the gate
 * forbids). A named command reachable everywhere (⌃⇧D in `ShellOverlays`,
 * beside ⌃⇧G) is the minimal affordance that makes "swappable, no code
 * change, no remount" a demonstrable fact on any route. It toasts the wrapper
 * it landed on, so the swap is visible even mid-cycle through look-alikes.
 */
import { commands, dashboards } from "@axf/core";
import type { Command } from "@axf/core";

/** The one event name the shell overlays listen on. */
export const SHELL_EVENT = "axs:shell";

export type ShellSignal =
  | { kind: "menu" }
  | { kind: "palette" }
  | { kind: "toast"; message: string };

function dispatchShell(signal: ShellSignal): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ShellSignal>(SHELL_EVENT, { detail: signal }));
}

function goHome(): void {
  window.location.assign("/");
}
function openModulesMenu(): void {
  dispatchShell({ kind: "menu" });
}
function openPalette(): void {
  dispatchShell({ kind: "palette" });
}
function openSettings(): void {
  // A real page as of 2026-08-12 — the branding-pack picker lives there.
  window.location.assign("/settings");
}
function swapDashboard(): void {
  const snapshot = dashboards.snapshot();
  const all = snapshot.all;
  // One wrapper is the v0.3.0 P0 state — the sandbox pair and the GizmoX
  // replica went with the strip. This used to `return` silently, which was
  // fine when a second wrapper was guaranteed and is a DEAD COMMAND now: ⌃⇧D
  // and the bar's swap row would both do nothing, indistinguishably from being
  // broken. Say so instead; every callback ends in visible behaviour.
  if (all.length < 2) {
    dispatchShell({
      kind: "toast",
      message:
        all.length === 1
          ? `Dashboard wrapper — only "${all[0].title}" is registered, nothing to swap to`
          : "Dashboard wrapper — none registered"
    });
    return;
  }
  const activeId = snapshot.resolution.dashboard?.id ?? null;
  const at = all.findIndex((d) => d.id === activeId);
  const next = all[(at + 1) % all.length];
  dashboards.activate(next.id);
  dispatchShell({ kind: "toast", message: `Dashboard wrapper — ${next.title} (${next.id})` });
}

/**
 * The commands as RECORDS, widened 2026-08-09 when `axf-context-menus` P0
 * extended the core registry from name → handler to id / title / run / icon /
 * hotkey.
 *
 * `title` and `icon` are what the palette and the context-menu map read; the
 * icons deliberately repeat the glyph the command bar already draws for the
 * same command (`command-bar.ts`), so one action does not acquire two faces
 * depending on where it is invoked from.
 *
 * `hotkey` is a DEFAULT, not the live binding. ⌃⇧G and ⌃⇧D are bound today by
 * the keydown listener in `CommandBarChrome`, and these two lines say the same
 * thing in the place the hotkey system will eventually read. They are recorded
 * here rather than moved here because moving the binding is the hotkey
 * system's job, and a half-move would leave two listeners racing for one chord.
 * Kept honest by construction: the registry refuses two commands claiming the
 * same chord, so the day the binding does move, a disagreement is an error
 * rather than a mystery.
 */
const HANDLERS: readonly Command[] = [
  { id: "nav.home", title: "Go to the console", run: goHome },
  { id: "modules.open", title: "Modules", icon: "icon-grid", run: openModulesMenu },
  {
    id: "search.open",
    title: "Search everything",
    icon: "icon-search",
    hotkey: "Ctrl+Shift+G",
    run: openPalette
  },
  // `account.open` was here, toasting "reserved position, not wired yet". P10
  // (2026-08-15) gave the bar's item 10 a real session chip, so the command had
  // no caller left — and a registered command nothing fires is a name the
  // palette offers for a button that no longer exists. The three acts the chip
  // performs are `accounts.session.signIn` / `.signOut` / `.settings`, which
  // belong to the module that owns a session, not to the shell.
  { id: "settings.open", title: "Settings", icon: "icon-gear", run: openSettings },
  {
    id: "dashboard.swap",
    title: "Swap the dashboard wrapper",
    icon: "icon-layers",
    hotkey: "Ctrl+Shift+D",
    run: swapDashboard
  }
];

/**
 * Idempotent, and tolerant of a partial HMR re-evaluation: `has()` is checked
 * per id because in dev this module can re-evaluate against a registry that
 * kept its handlers — re-registering would (rightly) throw the duplicate error
 * at an innocent moment.
 */
export function registerShellCommands(): void {
  for (const command of HANDLERS) {
    if (!commands.has(command.id)) commands.register(command);
  }
}

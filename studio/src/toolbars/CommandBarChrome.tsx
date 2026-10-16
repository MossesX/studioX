/**
 * @file The command bar's HOST half — the fills and the shell overlays.
 *
 * The asset (`command-bar.ts`) owns the arrangement; everything alive on the
 * bar lives here:
 *
 *   - **fills** (`COMMAND_BAR_FILLS`, passed through `AppShell`'s `banner`
 *     prop): the ticking clock (interval cleared on unmount), the sync line
 *     ("local only" — there is nothing to sync with yet and the bar should say
 *     so rather than invent a state), and the disabled dock chip — the seam
 *     the future dock system wires into. `note` is deliberately unfilled: it
 *     is the floating-window count, and floating windows arrive with the task
 *     manager; a status the host does not fill renders nothing, not a hole.
 *
 *   - **overlays** (`ShellOverlays`): the Modules menu, the search palette and
 *     the toast. Commands reach them as ONE CustomEvent dispatched by the
 *     registered handlers (`shell-commands.ts`), so the handlers can register
 *     at subsystem start while the state lives here, in the component that
 *     renders it.
 *
 * The Modules menu is built FROM THE LIVE REGISTRY at the moment it opens —
 * `registry.modules()` — never a hardcoded list, so a module registered
 * tomorrow appears with no edit here. The palette searches the same registry,
 * which is the honest minimal "everything" while modules are the only
 * searchable population.
 *
 * ── MUI (2026-08-10, P3) ─────────────────────────────────────────────────────
 *
 * The three overlays were a hand-rolled fixed-position menu, a hand-rolled
 * modal with a raw `<input>`, and a hand-rolled toast with its own timer. Each
 * of those is a component MUI already ships, and each hand-rolled copy was
 * missing something the real one has: the menu had no focus trap and no
 * keyboard navigation, the modal did not restore focus or lock scroll, and the
 * toast was not announced to assistive technology beyond a bare `role`.
 *
 *   - Modules menu → `Menu` + `MenuItem` + `ListItemIcon` / `ListItemText`.
 *   - Search palette → `Dialog` + `TextField` + `List` / `ListItemButton`.
 *   - Toast → `Snackbar` + `SnackbarContent`, whose `autoHideDuration` replaces
 *     the hand-run `setTimeout` entirely.
 *
 * **THE FOCUS-LOOP TRAP, AND WHY MUI IS STILL THE REASON.** The bar's search
 * control is a BUTTON STYLED AS A FIELD (core's `Toolbar`, item kind `field`),
 * never a read-only `<input>` with an `onFocus` that opens the palette. MUI
 * restores focus to the trigger when a dialog closes; with an `onFocus` trigger
 * that restoration re-opens the palette, forever, and the surface cannot be
 * escaped. That was paid for once already. Rebuilding the palette on MUI's own
 * `Dialog` does not soften it — it makes the restoration MUI's documented
 * behaviour rather than an accident — so the trigger stays a button, with a
 * click handler and no focus handler, and this comment stays with it.
 *
 * The same restoration is why the Modules menu's toggle lives on the COMMAND
 * path rather than on the button: while `Menu` is open its `Modal` owns the
 * pointer, so a second click on the affordance is a backdrop click that closes
 * it. Both routes end closed, which is what the toggle promised.
 */
"use client";

import * as React from "react";
import type { ReactNode } from "react";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import SnackbarContent from "@mui/material/SnackbarContent";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { commands, Glyph, registry, session, token } from "@axf/core";
import type { Module } from "@axf/core";

import { SHELL_EVENT } from "./shell-commands";
import type { ShellSignal } from "./shell-commands";

/* ------------------------------------------------------------------- fills */

/** Clock: `toLocaleTimeString()`, 1s tick, cleared on unmount. Renders empty
 *  until the first client tick so server and first client paint agree. */
function BarClock() {
  const [now, setNow] = React.useState<string | null>(null);
  React.useEffect(() => {
    const tick = () => setNow(new Date().toLocaleTimeString());
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);
  if (now === null) return null;
  return (
    <Typography component="span" sx={{ fontSize: "inherit", fontVariantNumeric: "tabular-nums" }}>
      {now}
    </Typography>
  );
}

/**
 * The dock chip — a disabled placeholder, per MASTER §3 item 9: no dock system
 * exists yet, and this chip is the seam it wires into. Disabled is the honest
 * state; the tooltip says why rather than leaving a grey mystery.
 *
 * The `Tooltip` wraps a `span` rather than the button directly. A disabled MUI
 * button has `pointer-events: none`, so it fires no enter event and a tooltip
 * attached to it never shows — which is the whole content of this control. The
 * span is MUI's documented way round that, and it is why the affordance can be
 * honest about being unavailable instead of just being grey.
 */
function DockChip() {
  return (
    <Tooltip title="Chat dock — no dock system yet; this chip is the seam it wires into">
      <Box component="span" sx={{ display: "inline-flex" }}>
        <IconButton
          disabled
          size="small"
          aria-label="Chat dock (not available yet)"
          sx={{
            height: 22,
            minWidth: 24,
            padding: "0 5px",
            borderRadius: "var(--axf-radius-tight)",
            border: `1px solid ${token("edge")}`,
            color: token("dim"),
            opacity: 0.45,
            cursor: "not-allowed"
          }}
        >
          <Glyph id="icon-chat" size={13} />
        </IconButton>
      </Box>
    </Tooltip>
  );
}

/**
 * The session chip — the bar's item 10, which was a reserved position toasting
 * "not wired yet" until 2026-08-15.
 *
 * Signed out it is one button, *Sign in*. Signed in it is the account chip
 * carrying the person's name, with *Sign out* and *Settings* behind it. Both
 * halves fire REGISTERED COMMANDS by name — the same idiom as the actions either
 * side of it, so the chip owns no behaviour and the same three acts are reachable
 * from a hotkey or a menu row without this component being involved.
 *
 * ## It reads CORE's session, not the accounts store
 *
 * The bar is shell chrome and must render in a peel that carries no accounts
 * module, so it subscribes to `@axf/core`'s `SessionStore` — which the accounts
 * store keeps in step (`modules/accounts/store.ts` calls `coreSession.signIn` /
 * `signOut` on every transition, and that sync is the reason that store exists).
 * `session.serverState` is pinned to signed-out and is what `useSyncExternalStore`
 * hands the hydrating render, so the server and the first client paint agree and
 * a persisted session lands one frame later as an ordinary repaint.
 *
 * ## The menu is on the COMMAND path's own anchor
 *
 * `Menu` rather than a hand-rolled popover, for the reasons this file's header
 * gives about the Modules menu: focus trap, keyboard navigation and restoration
 * are MUI's, and the hand-rolled copy had none of them. The anchor is this
 * button, held in state — a chip has exactly one, unlike `modules.open`, which is
 * reachable from a bar that draws no affordance at all.
 */
function SessionChip() {
  const state = React.useSyncExternalStore(session.subscribe, session.state, session.serverState);
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);

  const chipSx = {
    gap: "6px",
    height: 22,
    padding: "0 7px",
    borderRadius: "var(--axf-radius-tight)",
    border: `1px solid ${token("edge")}`,
    color: token("ink"),
    fontFamily: "inherit",
    fontSize: 11,
    whiteSpace: "nowrap",
    maxWidth: 170
  } as const;

  if (!state.signedIn) {
    return (
      <Tooltip title="Sign in — the login screen is the only thing that can start a session">
        <ButtonBase
          aria-label="Sign in"
          onClick={() => commands.run("accounts.session.signIn")}
          sx={{ ...chipSx, display: "inline-flex", alignItems: "center" }}
        >
          <Glyph id="icon-account" size={13} />
          <Box component="span">Sign in</Box>
        </ButtonBase>
      </Tooltip>
    );
  }

  const who = state.user ?? "signed in";
  const run = (command: string) => () => {
    setAnchor(null);
    commands.run(command);
  };

  return (
    <>
      <ButtonBase
        aria-label={`Account — ${who}`}
        aria-haspopup="menu"
        onClick={(e) => setAnchor((open) => (open ? null : e.currentTarget))}
        sx={{ ...chipSx, display: "inline-flex", alignItems: "center", minWidth: 0 }}
      >
        <Glyph id="icon-account" size={13} />
        <Box
          component="span"
          sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {who}
        </Box>
      </ButtonBase>
      <Menu
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          list: { "aria-label": "Account", dense: true, sx: { padding: "6px" } },
          paper: { sx: { ...surfaceSx, minWidth: 200, marginTop: "4px" } }
        }}
      >
        <MenuItem
          onClick={run("accounts.session.account")}
          sx={{ gap: 0, borderRadius: "var(--axf-radius-tight)", color: token("ink"), fontSize: 13 }}
        >
          <ListItemIcon sx={{ minWidth: 0, marginRight: "10px", color: "inherit" }}>
            <Glyph id="icon-account" size={15} />
          </ListItemIcon>
          <ListItemText
            primary={who}
            secondary="Your account"
            slotProps={{
              primary: { sx: { fontSize: 13, fontWeight: 600 } },
              secondary: { sx: { color: token("dim"), fontSize: 11 } }
            }}
          />
        </MenuItem>
        <MenuItem
          onClick={run("accounts.session.settings")}
          sx={{ gap: 0, borderRadius: "var(--axf-radius-tight)", color: token("ink"), fontSize: 13 }}
        >
          <ListItemIcon sx={{ minWidth: 0, marginRight: "10px", color: "inherit" }}>
            <Glyph id="icon-gear" size={15} />
          </ListItemIcon>
          <ListItemText primary="Settings" slotProps={{ primary: { sx: { fontSize: 13 } } }} />
        </MenuItem>
        {/* Red, exactly as core's floor draws the same act — one colour for
            leaving, wherever it is reached from. */}
        <MenuItem
          onClick={run("accounts.session.signOut")}
          sx={{ gap: 0, borderRadius: "var(--axf-radius-tight)", color: token("err"), fontSize: 13 }}
        >
          <ListItemIcon sx={{ minWidth: 0, marginRight: "10px", color: "inherit" }}>
            <Glyph id="icon-account" size={15} />
          </ListItemIcon>
          <ListItemText primary="Sign out" slotProps={{ primary: { sx: { fontSize: 13 } } }} />
        </MenuItem>
      </Menu>
    </>
  );
}

/** Host content for the bar's slot and status items, by item id. */
export const COMMAND_BAR_FILLS: Record<string, ReactNode> = {
  sync: "local only",
  clock: <BarClock />,
  dock: <DockChip />,
  account: <SessionChip />
};

/* ---------------------------------------------------------------- overlays */

const TOAST_MS = 2600;

function moduleRows(): Module[] {
  return registry.modules();
}

/** Surface chrome shared by the menu and the palette — one definition, because
 *  two overlays that drift apart look like two different applications. */
const surfaceSx = {
  background: token("panel"),
  border: `1px solid ${token("edge")}`,
  borderRadius: token("radius"),
  boxShadow: token("shadow"),
  backgroundImage: "none"
} as const;

/** The row every module gets, in both overlays. Same glyph, same order, same
 *  route code — a module must not look like two different things depending on
 *  which overlay found it. */
function moduleRow(m: Module) {
  return {
    icon: (
      <ListItemIcon sx={{ minWidth: 0, marginRight: "10px", color: "inherit" }}>
        <Glyph id={m.glyph ?? "icon-grid"} size={15} />
      </ListItemIcon>
    ),
    route: (
      <Typography
        component="code"
        sx={{ color: token("dim"), fontFamily: token("mono"), fontSize: 10.5, marginLeft: "10px" }}
      >
        {m.route}
      </Typography>
    )
  };
}

/**
 * Where the Modules menu hangs.
 *
 * Two cases, and the second is not a corner: `console-bar` — the banner the
 * dashboard wrapper activates, i.e. the one actually on screen — declares NO
 * menu item, so there is no affordance to anchor to and `modules.open` is
 * reached by command alone. The hand-rolled menu had a `{left:10, top:44}`
 * fallback for exactly that; the first MUI rewrite dropped it and made the
 * command silently dead (`anchorEl` null → `open` false → nothing, no error).
 * Caught by `scripts/shell-chrome-probe.mjs` on its first run.
 */
type MenuAt = { readonly el: HTMLElement } | { readonly at: { left: number; top: number } };

export function ShellOverlays() {
  const [menuAt, setMenuAt] = React.useState<MenuAt | null>(null);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  // `seq` re-keys the Snackbar so a second toast restarts the auto-hide instead
  // of inheriting the first one's remaining time — MUI's own answer for
  // consecutive snackbars, and the reason no timer is run by hand here.
  const [toast, setToast] = React.useState<{ message: string; seq: number } | null>(null);

  React.useEffect(() => {
    const onShell = (e: Event) => {
      const signal = (e as CustomEvent<ShellSignal>).detail;
      if (signal.kind === "menu") {
        setMenuAt((open) => {
          if (open) return null; // second press toggles it away
          // Anchor on the bar's menu affordance, found at open — the command
          // carries no anchor, and a bar has at most one menu. `Menu` then
          // positions and re-positions itself against that node, which is what
          // the hand-rolled version's measured rectangle could not do when the
          // window resized under an open menu. With no affordance on the active
          // bar, the menu still opens, under the bar's left edge.
          const el = document.querySelector<HTMLElement>(
            '[data-axf-toolbar] button[aria-haspopup="menu"]'
          );
          return el ? { el } : { at: { left: 10, top: 44 } };
        });
      } else if (signal.kind === "palette") {
        setQuery("");
        setPaletteOpen(true);
      } else {
        setToast((prev) => ({ message: signal.message, seq: (prev?.seq ?? 0) + 1 }));
      }
    };
    // ⌃⇧G — the hint the search field displays, made true. Through the command
    // registry, not a direct call, so the hotkey and the click stay one path.
    // ⌃⇧D (P8) — cycle the dashboard wrapper, the swap the P8 gate observes
    // live around the card screen; same one-path rule.
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        commands.run("search.open");
      }
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        commands.run("dashboard.swap");
      }
    };
    window.addEventListener(SHELL_EVENT, onShell);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(SHELL_EVENT, onShell);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const go = (route: string) => {
    setMenuAt(null);
    setPaletteOpen(false);
    window.location.assign(route);
  };

  const q = query.trim().toLowerCase();
  const matches = paletteOpen
    ? moduleRows().filter(
        (m) =>
          !q ||
          m.title.toLowerCase().includes(q) ||
          m.route.toLowerCase().includes(q) ||
          m.summary.toLowerCase().includes(q)
      )
    : [];

  return (
    <>
      {/* ------------------------------------------------- the Modules menu */}
      <Menu
        open={Boolean(menuAt)}
        anchorEl={menuAt && "el" in menuAt ? menuAt.el : undefined}
        anchorReference={menuAt && "at" in menuAt ? "anchorPosition" : "anchorEl"}
        anchorPosition={menuAt && "at" in menuAt ? menuAt.at : undefined}
        onClose={() => setMenuAt(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          list: { "aria-label": "Modules", dense: true, sx: { padding: "6px" } },
          paper: { sx: { ...surfaceSx, minWidth: 240, maxHeight: "70vh", marginTop: "4px" } }
        }}
      >
        {moduleRows().map((m) => {
          const row = moduleRow(m);
          return (
            <MenuItem
              key={m.id}
              onClick={() => go(m.route)}
              sx={{
                gap: 0,
                borderRadius: "var(--axf-radius-tight)",
                color: token("ink"),
                fontSize: 13
              }}
            >
              {row.icon}
              <ListItemText
                primary={m.title}
                slotProps={{ primary: { sx: { fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" } } }}
              />
              {row.route}
            </MenuItem>
          );
        })}
        {moduleRows().length === 0 && (
          // `disabled` on its own would grey the text into the theme's disabled
          // colour and read as "temporarily unavailable". It is an error state,
          // so it says so in `err` — and `disableRipple` because nothing here is
          // clickable.
          <MenuItem
            disabled
            disableRipple
            sx={{
              "&.Mui-disabled": { opacity: 1 },
              color: token("err"),
              fontFamily: token("mono"),
              fontSize: 12
            }}
          >
            no modules registered
          </MenuItem>
        )}
      </Menu>

      {/* ----------------------------------------------- the search palette */}
      <Dialog
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        aria-label="Search everything"
        fullWidth
        maxWidth={false}
        // Top-aligned rather than centred: a palette that jumps vertically as
        // its result count changes is a palette you cannot aim at.
        sx={{ "& .MuiDialog-container": { alignItems: "flex-start", paddingTop: "16vh" } }}
        slotProps={{
          paper: { sx: { ...surfaceSx, width: "min(560px, 90vw)", margin: 0, overflow: "hidden" } }
        }}
      >
        <TextField
          autoFocus
          fullWidth
          value={query}
          placeholder="Search everything…"
          variant="standard"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // Escape is `Dialog`'s already; Enter is ours, because "the first
            // match is the answer" is this palette's contract, not a dialog's.
            if (e.key === "Enter" && matches[0]) go(matches[0].route);
          }}
          slotProps={{
            input: {
              disableUnderline: true,
              sx: {
                padding: "12px 14px",
                borderBottom: `1px solid ${token("edge")}`,
                color: token("ink"),
                fontSize: 14
              }
            }
          }}
        />
        <List dense sx={{ maxHeight: "50vh", overflowY: "auto", padding: "6px" }}>
          {matches.map((m, i) => {
            const row = moduleRow(m);
            return (
              <ListItemButton
                key={m.id}
                // The first match is what Enter takes, so it is drawn as the
                // one Enter would take. `selected` rather than a hand-painted
                // background: the state has a name in MUI, and naming it is
                // what makes it follow the theme.
                selected={i === 0}
                onClick={() => go(m.route)}
                sx={{
                  gap: 0,
                  borderRadius: "var(--axf-radius-tight)",
                  color: token("ink"),
                  "&.Mui-selected": { background: token("panel2") }
                }}
              >
                {row.icon}
                <ListItemText
                  primary={m.title}
                  secondary={m.summary}
                  slotProps={{
                    primary: { sx: { fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" } },
                    secondary: {
                      sx: {
                        color: token("dim"),
                        fontSize: 11.5,
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis"
                      }
                    }
                  }}
                />
                {row.route}
              </ListItemButton>
            );
          })}
          {matches.length === 0 && (
            <Typography
              component="span"
              sx={{ display: "block", color: token("dim"), fontFamily: token("mono"), fontSize: 12, padding: "8px" }}
            >
              no module matches “{query}”
            </Typography>
          )}
        </List>
      </Dialog>

      {/* --------------------------------------------------------- the toast */}
      <Snackbar
        key={toast?.seq}
        open={Boolean(toast)}
        autoHideDuration={TOAST_MS}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        <SnackbarContent
          role="status"
          message={toast?.message}
          sx={{ ...surfaceSx, color: token("ink"), fontSize: 13, maxWidth: 360 }}
        />
      </Snackbar>
    </>
  );
}

"use client";

/**
 * @file The tab bar itself: a thin animated band across the very top of the app,
 * and the bar of open surfaces that comes out of it.
 *
 * Ported from GizmoX's `src/plugins/top-strip/TopStrip.tsx`. Mounted through
 * core's `shell.strip` point, so the shell knows nothing about it beyond "a
 * plugin registered a band" — dropping the contribution removes it and leaves
 * every file in place.
 *
 * ── what the port kept, and what it dropped ───────────────────────────────────
 *
 * KEPT: the behaviour. Which surfaces are open, how the bar reveals, what the
 * pointer does, what closing the surface you are looking at means.
 *
 * DROPPED: `style.ts`, 797 lines of it — every pattern, motion, palette, fill,
 * shape, indicator and easing dial the GizmoX version could be configured with.
 * Nothing here decides a colour or a corner: the band is `accent`, the bar is
 * `panel` on `edge`, the active tab is tinted from `accent`, and all of it moves
 * with `--axf-motion`. That is not a smaller feature, it is the framework doing
 * the job the 797 lines were doing by hand — a theme roll restyles this bar with
 * no setting turned and no code touched, which the GizmoX one could not do.
 *
 * ── the two positions, and why both exist ─────────────────────────────────────
 *
 * A hover peek is `position: absolute` under the band, so glancing at the bar
 * OVERLAYS the page rather than reflowing the whole app for a glance. Once it is
 * pinned (or in "always" mode) it becomes a real row and takes its own height, so
 * the app below shifts down and the bar is never sitting on top of a module's
 * chrome. Pinning counts as a deliberate, sticky choice; hovering does not.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";

import { Glyph, token, useModuleSettings } from "@axf/core";

import { TAB_BAR_ID } from "./tab-bar.decl";
import {
  closeTab,
  openTab,
  resolveTab,
  successorTab,
  useModuleTabs,
  useTabBarPinned
} from "./tabs";
import type { ModuleTab } from "./tabs";

/** The band's resting and hovered heights, in px. Not settings: they are the
 *  affordance itself, and a band tall enough to be worth configuring is a band
 *  that should have been the bar. */
const BAND_REST = 5;
const BAND_HOVER = 9;

/** The tab row's height. Everything inside it is sized from the theme. */
const BAR_HEIGHT = 30;

interface Config {
  readonly enabled: boolean;
  readonly reveal: string;
  readonly hideDelay: number;
  readonly maxTabs: number;
  readonly newestFirst: boolean;
  readonly closeOnPick: boolean;
  readonly middleClickClose: boolean;
  readonly showLabels: boolean;
}

/** The settings document, narrowed. Values are declared with defaults, so this
 *  never sees `undefined` — the casts state the decl's types, they do not
 *  supply missing ones. */
function readConfig(values: Record<string, boolean | number | string>): Config {
  return {
    enabled: Boolean(values.enabled ?? true),
    reveal: String(values.reveal ?? "hover"),
    hideDelay: Number(values.hideDelay ?? 450),
    maxTabs: Number(values.maxTabs ?? 12),
    newestFirst: Boolean(values.newestFirst ?? false),
    closeOnPick: Boolean(values.closeOnPick ?? true),
    middleClickClose: Boolean(values.middleClickClose ?? true),
    showLabels: Boolean(values.showLabels ?? true)
  };
}

export default function TabBar() {
  const cfg = readConfig(useModuleSettings(TAB_BAR_ID));
  const stored = useModuleTabs();
  const [pinned, setPinned] = useTabBarPinned();
  const [hovered, setHovered] = React.useState(false);
  const hideTimer = React.useRef<number | null>(null);

  // The route, read after mount so the server frame and the first client frame
  // agree — the same reason `AppShell`'s own route readout does it this way.
  // `popstate` covers back/forward; every other navigation in this app is a
  // full page load, which re-runs all of this anyway.
  const [path, setPath] = React.useState<string | null>(null);
  React.useEffect(() => {
    const read = () => setPath(window.location.pathname);
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);

  const tabs = React.useMemo(
    () => (cfg.newestFirst ? [...stored].reverse() : stored),
    [stored, cfg.newestFirst]
  );
  const active = path === null ? null : resolveTab(path);

  // Register the surface we are ON. Every way in — the nav, a command, a deep
  // link, the address bar — passes through the pathname, so no route can open
  // without getting its tab and there is no second path to forget.
  React.useEffect(() => {
    if (!cfg.enabled || path === null) return;
    const tab = resolveTab(path);
    if (tab) openTab(tab, cfg.maxTabs);
  }, [path, cfg.enabled, cfg.maxTabs]);

  React.useEffect(
    () => () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    },
    []
  );

  const onEnter = React.useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setHovered(true);
  }, []);

  const onLeave = React.useCallback(() => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(
      () => setHovered(false),
      Math.max(0, cfg.hideDelay)
    );
  }, [cfg.hideDelay]);

  const always = cfg.reveal === "always";
  const open = tabs.length > 0 && (always || pinned || (cfg.reveal === "hover" && hovered));
  const inFlow = always || pinned;

  const go = React.useCallback(
    (tab: ModuleTab) => {
      // `window.location.assign`, matching `NavShell` — this app navigates by
      // full load, and a router push here would make the tab bar the one
      // surface that navigates differently from every other.
      if (!always && cfg.closeOnPick) setHovered(false);
      window.location.assign(tab.route);
    },
    [always, cfg.closeOnPick]
  );

  /** Close a tab and, when it is the one on screen, move off it. The menu row
   *  does the same through `tab-bar.tab.close`; this is the pointer path. */
  const dismiss = React.useCallback(
    (tab: ModuleTab) => {
      const next = successorTab(tabs, tab.id);
      const onScreen = tab.id === active?.id;
      closeTab(tab.id);
      if (onScreen && next) window.location.assign(next.route);
    },
    [tabs, active?.id]
  );

  if (!cfg.enabled) return null;

  return (
    <Box
      // ONE area for the band and the bar together: everything a right-click
      // here means is about the bar itself. A tab adds its own area inside.
      data-axf-area="tab-bar.strip"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      sx={{ position: "relative", flexShrink: 0, zIndex: 1200 }}
    >
      {/* The band — the whole hover target, full width. In "click" mode it is
          the pin control as well, which is what makes that mode usable with a
          pointer that does not hover (a touch screen). */}
      <Box
        onClick={() => {
          if (cfg.reveal === "click" && !always) setPinned(!pinned);
        }}
        title={
          tabs.length === 0
            ? "Open surfaces appear here"
            : cfg.reveal === "click"
              ? "Click for open surfaces"
              : "Hover for open surfaces"
        }
        sx={{
          height: hovered || open ? `${BAND_HOVER}px` : `${BAND_REST}px`,
          cursor: cfg.reveal === "click" && !always ? "pointer" : "default",
          transition: `height ${token("motion")} ${token("easing")}`,
          // The identity colour, moving. `background-size` is what the
          // animation slides; the gradient itself is three stops of the live
          // accent so a theme roll recolours the band with everything else.
          backgroundImage: `linear-gradient(90deg, ${token("accent")}, ${token("info")}, ${token("accent")})`,
          backgroundSize: "200% 100%",
          animation: "axfStripFlow 9s linear infinite",
          "@keyframes axfStripFlow": {
            from: { backgroundPosition: "0% 0%" },
            to: { backgroundPosition: "200% 0%" }
          },
          // Motion is a theme decision everywhere else in this app, and a reader
          // who asked the OS for less motion is not asking per-app.
          "@media (prefers-reduced-motion: reduce)": { animation: "none" }
        }}
      />

      {/* The bar. Absolute while it is only being peeked at, a real row once it
          is pinned. `visibility` rather than unmounting: the closed bar keeps
          its position so the open one does not jump into place. */}
      {tabs.length > 0 && (
        <Box
          data-axf-tabbar-open={open ? "" : undefined}
          sx={{
            position: inFlow ? "static" : "absolute",
            top: inFlow ? undefined : "100%",
            left: 0,
            right: 0,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            px: 0.75,
            height: open ? `${BAR_HEIGHT}px` : 0,
            overflow: "hidden",
            visibility: open ? "visible" : "hidden",
            background: token("panel"),
            borderBottom: `1px solid ${token("edge")}`,
            boxShadow: inFlow ? "none" : token("shadow"),
            transition: `height ${token("motion")} ${token("easing")}`
          }}
        >
          {tabs.map((t) => {
            const isActive = t.id === active?.id;
            return (
              <ButtonBase
                key={t.id}
                // The tab's own area, plus the id every menu row resolves by.
                // `tab-bar.commands.ts` reads `data.tab` off the area walk —
                // nothing is handed to a command.
                data-axf-area="tab-bar.tab"
                data-axf-tab={t.id}
                onClick={() => go(t)}
                onAuxClick={(e: React.MouseEvent) => {
                  if (e.button === 1 && cfg.middleClickClose) {
                    e.preventDefault();
                    dismiss(t);
                  }
                }}
                title={`${t.label} — ${t.route}`}
                sx={{
                  flexShrink: 1,
                  minWidth: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  px: 1,
                  height: `${BAR_HEIGHT - 8}px`,
                  borderRadius: token("radius-tight"),
                  fontFamily: token("sans"),
                  fontSize: token("size-label"),
                  color: isActive ? token("ink") : token("dim"),
                  background: isActive
                    ? `color-mix(in srgb, ${token("accent")} 18%, transparent)`
                    : "transparent",
                  boxShadow: isActive ? `inset 0 -2px 0 0 ${token("accent")}` : "none",
                  transition: `background ${token("motion")} ${token("easing")}`,
                  "&:hover": {
                    background: `color-mix(in srgb, ${token("accent")} 10%, transparent)`,
                    color: token("ink")
                  }
                }}
              >
                {t.glyph ? <Glyph id={t.glyph} size={14} /> : null}
                {cfg.showLabels && (
                  <Typography
                    component="span"
                    sx={{
                      font: "inherit",
                      maxWidth: 160,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap"
                    }}
                  >
                    {t.label}
                  </Typography>
                )}
                {/* A span, not a nested button: a button inside a button is
                    invalid markup that browsers resolve by dropping one of
                    them (the same finding `/settings`' pack card records).
                    Keyboard users close a tab through the menu row, which is
                    reachable with the context-menu key. */}
                <Box
                  component="span"
                  aria-hidden
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    dismiss(t);
                  }}
                  sx={{
                    display: "inline-flex",
                    opacity: 0.5,
                    // An X is a rotated +. The glyph contract carries no
                    // `icon-close`, and the established answer in this tree is
                    // this rotation rather than a new required drawing every
                    // pack would have to supply (`amberxvid/kit/icons.tsx`).
                    transform: "rotate(45deg)",
                    "&:hover": { opacity: 1, color: token("err") }
                  }}
                >
                  <Glyph id="icon-plus" size={11} />
                </Box>
              </ButtonBase>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

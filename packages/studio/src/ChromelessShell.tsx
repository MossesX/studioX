/**
 * @file The shell WITHOUT the chrome — the theme and the crash net, and nothing
 * else. One route uses it: `/login`.
 *
 * ## Why an exception exists at all
 *
 * `AppShell`'s docblock records an owner directive from 2026-08-08: every route
 * renders the full shell, because the chrome that each surface has to remember
 * is the chrome that goes missing. That directive is about SURFACES OF THE APP,
 * and it stands — the bug it was written for (`/` and the plugin routes with no
 * navbar) is exactly what it still prevents.
 *
 * The login screen is not a surface of the app. It is what stands in front of
 * the app, drawn for somebody the studio has not yet identified, and the chrome
 * it would inherit is chrome they cannot use: a nav menu whose every row
 * bounces back to this page, a command palette over modules they cannot open,
 * a tab bar of surfaces they are not in. Handing an unauthenticated visitor the
 * full list of the studio's modules is also the one thing a gate is supposed to
 * stop, so the exception is a security posture as much as a visual one.
 *
 * ## What is kept, and why each
 *
 * - `Boundary` (tier `app`) — the last net. A login screen that white-screens
 *   is a lock-out, so this is the LAST thing to drop, not the first.
 * - `AxfStyleRoot` — the one publisher of `:root` variables. Without it the
 *   page paints from `layout.tsx`'s head block alone and never follows a theme
 *   change; with it, the login screen is themed exactly like everything else.
 * - `AxfMuiRoot` — the MUI provider the login card's controls resolve through.
 *
 * What is dropped is the chrome and its dialogs (banner, nav, context menu,
 * inline toolbars, settings dialogs, tab bar) and every background sync the
 * shell mounts — a signed-out page has nothing to sync and no cookie to sync
 * it with.
 *
 * The `Box` repeats `AppShell`'s viewport column deliberately rather than
 * importing it: it is three declarations, and the alternative is exporting a
 * layout primitive from core so that two callers can share a `height: 100vh`.
 */
"use client";

import type { ReactNode } from "react";

import Box from "@mui/material/Box";

import { AxfMuiRoot, AxfStyleRoot, Boundary } from "@axf/core";

export default function ChromelessShell({ children }: { children: ReactNode }) {
  return (
    <Boundary tier="app" source="shell">
      <AxfStyleRoot />
      <AxfMuiRoot>
        <Box
          data-axf-shell
          sx={{
            background: "var(--axf-page)",
            color: "var(--axf-ink)",
            fontFamily: "var(--axf-sans)",
            fontSize: "var(--axf-size-body)",
            // A fixed viewport, for the same reason AppShell's column is one:
            // the screen below fills it and the page itself never scrolls.
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {children}
        </Box>
      </AxfMuiRoot>
    </Boundary>
  );
}

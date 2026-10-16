/**
 * @file The client entry that boots before it hosts.
 *
 * **Boot belongs to the client graph, and ONLY to the client graph.** Both
 * halves of that sentence cost a debugging session, so both are written down.
 *
 * ## Why boot has to run here
 *
 * The registry is per-runtime. The browser bundle evaluates `@axf/core`
 * separately from the server and gets its OWN `registry` and `kernel`. A boot
 * that happened only on the server would leave the browser's empty, and
 * `ModuleHost`, being a client component, reads the empty one. So boot runs at
 * module scope here, and `boot()` is idempotent so a re-render or a fast
 * refresh never double-registers.
 *
 * ## Why a SERVER COMPONENT must never boot (the "(none)" bug, 2026-08-09)
 *
 * `/demo`, `/taskman` and `/status` each used to `await boot()` in the route
 * before rendering this component. That looked like belt-and-braces. It was
 * the defect.
 *
 * A server component runs in the **react-server layer**, where every
 * `"use client"` module resolves to a client REFERENCE rather than to the real
 * module. Studio's subsystem is composed from such modules — the dashboard
 * wrapper and its look binding (`dashboards/amberx-console.tsx`) is
 * `"use client"`, and `start()` registers values it imports from it. In that
 * layer a pack's `.payload` is `undefined`, so `packs.register()` threw
 * `Cannot read properties of undefined (reading 'palette')`, the kernel did its
 * job and marked studio `failed`, and boot returned with the registry half
 * populated. The route then rendered this host, which honestly reported
 * `No module registered with id "demo". Registered: (none)` — into the SSR
 * HTML, where it also produced a hydration mismatch against the browser, which
 * had booted correctly.
 *
 * The registry was not lying and the kernel was not lying. The route was
 * asking a runtime that structurally cannot hold this subsystem.
 *
 * So: routes render `<BootedHost>` (or `<BootClient/>`) and nothing else. A
 * surface that needs to REPORT the runtime reports the client one — that is
 * the runtime the app actually runs on.
 *
 * The chrome (style root, app boundary, banner, nav) is `StudioShell`'s /
 * `AppShell`'s, mounted once in `app/layout.tsx` — this file hosts the module
 * and nothing else.
 *
 * ## The PERMISSION GATE (2026-08-13, accounts P6)
 *
 * One conditional, deliberately — this is the chokepoint every module route
 * already passes through, so putting the gate here makes coverage a structural
 * property rather than a habit each route has to remember. A route that forgot
 * to check would be a module an administrator believes is revoked and is not,
 * and that is a silent fault: nobody is looking for it.
 *
 * It is a NO-OP for today's users, and provably so rather than hopefully so.
 * `usePermission` answers `true` while signed out (a single-operator studio
 * stays fully open until an administrator says otherwise) and `true` for
 * administrators; only a signed-in non-admin whose effective permissions deny
 * this id gets anything but `<ModuleHost>`, byte for byte as before.
 *
 * The gate is UI, not security. It decides what is worth putting in front of
 * someone; the API routes that mutate accounts, permissions and profiles
 * refuse an unauthorised caller themselves (P2), and must keep doing so — a
 * hidden screen has never been a boundary.
 */
"use client";

import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { Glyph, ModuleHost, registry, token } from "@axf/core";

import { boot } from "./boot";
import { usePermission } from "./modules/accounts/store";

// Module scope: runs once per bundle evaluation, before the first render.
void boot();

/**
 * What a revoked module looks like. Honest on purpose: it names the module, it
 * says who took the decision, and it offers the one route every account can
 * reach. A blank screen or a 404 would leave the user guessing whether the
 * thing is broken, and an administrator fielding the question.
 */
function RestrictedPanel({ moduleId }: { moduleId: string }) {
  const title = registry.module(moduleId)?.title ?? moduleId;
  return (
    <Stack
      sx={{ flex: 1, minHeight: 0, alignItems: "center", justifyContent: "center", p: 3 }}
    >
      <Paper
        variant="outlined"
        sx={{
          width: "min(440px, 92vw)",
          p: 3.5,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1.5,
          textAlign: "center"
        }}
      >
        <Glyph id="icon-eye-off" size={30} />
        <Typography sx={{ fontFamily: token("mono"), fontSize: 15, fontWeight: 700 }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: 13, color: token("dim") }}>
          Access to this module is restricted by an administrator
        </Typography>
        <Button href="/" size="small" variant="outlined" sx={{ mt: 1, textTransform: "none" }}>
          Go to Dashboard
        </Button>
      </Paper>
    </Stack>
  );
}

export default function BootedHost({ moduleId }: { moduleId: string }) {
  // Called unconditionally, above the branch — the hook order is the same on
  // every render for every user, allowed or not.
  const allowed = usePermission(moduleId);
  if (!allowed) return <RestrictedPanel moduleId={moduleId} />;
  return <ModuleHost moduleId={moduleId} />;
}

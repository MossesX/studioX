"use client";

/**
 * @file `/project-state` — the surface behind the one-item bar.
 *
 * Three things, top to bottom: the `project-state-bar` toolbar asset (its one
 * action is the whole write path), the outcome of the last run surfaced
 * INLINE, and a read-only preview of the resume prompt with a copy button —
 * the prompt is the deliverable, and copying it is what a person comes here
 * to do.
 *
 * The screen consumes the generator over HTTP ONLY (`GET /api/project-state`).
 * It imports nothing from `*.server.ts` — a client component that statically
 * imports the server half drags `node:fs` into the browser bundle, and tsc
 * says nothing until the bundler does (the Unarchived-tab lesson).
 *
 * Chrome — style root, MUI provider, banner, nav — is all `StudioShell`'s.
 * The `<Toolbar>` mounted here is the plugin's own pane bar, not chrome: it is
 * rendered by asset id, and its command goes straight to the registry, exactly
 * as core's `InlineToolbars` dispatches an inline bar.
 */
import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { Toolbar, commands, token } from "@axf/core";

import { PROJECT_STATE_BAR, PROJECT_STATE_SURFACE } from "./project-state-bar";
import { useGenerateStatus } from "./project-state.commands";

/** The GET route's answer — the summary, never the full sessions array. */
interface StateSummary {
  readonly generatedAt: string;
  readonly generatorVersion?: string;
  readonly resumePrompt: string;
  readonly sessionCount: number;
}

/** What the screen knows about the file pair on disk. */
type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "empty"; readonly hint: string }
  | { readonly kind: "ready"; readonly state: StateSummary }
  | { readonly kind: "error"; readonly message: string };

export default function ProjectStateScreen() {
  const [loaded, setLoaded] = React.useState<Loaded>({ kind: "loading" });
  const status = useGenerateStatus();
  const [copied, setCopied] = React.useState(false);

  // Re-read after every completed run: `generatedAt` changes on each success,
  // so the effect refetches exactly once per generation and never loops.
  const doneStamp = status.phase === "done" ? status.result.generatedAt : null;
  React.useEffect(() => {
    let stale = false;
    (async () => {
      try {
        const res = await fetch("/api/project-state");
        const body = (await res.json().catch(() => null)) as
          | (StateSummary & { error?: string })
          | null;
        if (stale) return;
        if (res.status === 404) {
          setLoaded({ kind: "empty", hint: body?.error ?? "never generated" });
        } else if (!res.ok || !body || typeof body.resumePrompt !== "string") {
          setLoaded({
            kind: "error",
            message: body?.error ?? `GET /api/project-state answered ${res.status}`
          });
        } else {
          setLoaded({ kind: "ready", state: body });
        }
      } catch (err) {
        if (!stale) setLoaded({ kind: "error", message: (err as Error).message });
      }
    })();
    return () => {
      stale = true;
    };
  }, [doneStamp]);

  // Best-effort, with the success made visible on the button itself — a copy
  // that changes nothing on screen is a dead control that happens to work.
  const copyPrompt = (prompt: string): void => {
    try {
      void navigator.clipboard?.writeText(prompt).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      });
    } catch {
      /* refused — nothing worth breaking the page for */
    }
  };

  return (
    <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, minHeight: 0 }}>
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Project state
        </Typography>
        {loaded.kind === "ready" ? (
          <Chip
            size="small"
            variant="outlined"
            label={`generated ${loaded.state.generatedAt} · ${loaded.state.sessionCount} sessions`}
          />
        ) : null}
      </Stack>

      {/* The plugin's own pane bar, drawn from the registered asset by id.
          Commands go straight to the registry — same dispatch as an inline
          bar, and the reason the screen carries no onClick of its own. */}
      <Toolbar
        surface={PROJECT_STATE_SURFACE}
        asset={PROJECT_STATE_BAR.id}
        onCommand={(command) => void commands.run(command)}
      />

      {status.phase === "running" ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <CircularProgress size={14} />
          <Typography variant="body2" sx={{ color: token("dim") }}>
            Digesting sessions — unchanged ones come from the cache…
          </Typography>
        </Stack>
      ) : null}
      {status.phase === "done" ? (
        <Alert severity="success" variant="outlined">
          Generated {status.result.generatedAt} — {status.result.sessionsDigested} session(s)
          digested, {status.result.fromCache} from cache. Written to {status.result.mdPath}.
        </Alert>
      ) : null}
      {status.phase === "error" ? (
        <Alert severity="error" variant="outlined">
          Generation failed: {status.message}
        </Alert>
      ) : null}

      {loaded.kind === "loading" ? (
        <Typography variant="body2" sx={{ color: token("dim") }}>
          Reading the current state file…
        </Typography>
      ) : null}

      {loaded.kind === "empty" ? (
        // The honest first-run state: no fabricated preview, one pointer at
        // the one control that changes it.
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body1" sx={{ fontWeight: 600, mb: 0.5 }}>
            No project state has been generated yet
          </Typography>
          <Typography variant="body2" sx={{ color: token("dim") }}>
            &ldquo;Generate project state&rdquo; in the bar above reads every current and archived
            session that touched AmberX, plus the PLANNING-STATE.md family, and writes
            PROJECT-STATE.md + PROJECT-STATE.json at the AmberX root. ({loaded.hint})
          </Typography>
        </Paper>
      ) : null}

      {loaded.kind === "error" ? (
        <Alert severity="error" variant="outlined">
          {loaded.message}
        </Alert>
      ) : null}

      {loaded.kind === "ready" ? (
        <Paper
          variant="outlined"
          sx={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: "center",
              px: 1.5,
              py: 0.75,
              borderBottom: `1px solid ${token("edge")}`
            }}
          >
            <Typography
              variant="overline"
              sx={{ letterSpacing: 1, color: token("dim"), flex: 1 }}
            >
              Resume prompt — paste as the first message of a new session
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => copyPrompt(loaded.state.resumePrompt)}
            >
              {copied ? "Copied" : "Copy resume prompt"}
            </Button>
          </Stack>
          <Box
            component="pre"
            sx={{
              m: 0,
              px: 1.5,
              py: 1.25,
              overflow: "auto",
              maxHeight: "60vh",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: token("mono"),
              fontSize: 11.5,
              color: token("ink")
            }}
          >
            {loaded.state.resumePrompt}
          </Box>
        </Paper>
      ) : null}
    </Box>
  );
}

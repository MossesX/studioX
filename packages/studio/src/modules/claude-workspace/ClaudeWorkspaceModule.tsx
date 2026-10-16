"use client";

/**
 * @file The Claude workspace — the `/claude` screen, `axf-claude` P3.
 *
 * What this file owns, and nothing else does:
 *
 *   1. **The pane geometry**, through core's `PaneLayout` — which was built for
 *      exactly this module (`AXF_CAPABILITIES["pane-layout"]` says so by name:
 *      *"the claude workspace is multi-pane and core had no split renderer"*).
 *      A `storageKey` is passed, so the reader's column widths survive a reload
 *      through the kv primitive; the renderer's own law is that only an
 *      interaction ever writes one.
 *   2. **The start dialog** — a conversation's model, effort, permission mode
 *      and working directory are fixed when it starts and the service refuses
 *      an unknown one by name, so they are asked for once, here, rather than
 *      being global settings that would be silently overridden.
 *   3. **The dialogs commands cannot mount** — rename, the sui — reached
 *      through `ui.ts`, because a context-menu command is a plain function with
 *      no React available to it.
 *
 * What it deliberately does NOT own: menus (data on the decl), the transport
 * (the subsystem, over HTTP), the fold (`transcript.ts`), or any colour (the
 * theme owns every `--axf-*` value, no exceptions).
 *
 * ── the CLI probe ────────────────────────────────────────────────────────────
 *
 * The workspace asks `/api/claude` whether `claude --version` actually answers,
 * once, on mount. A missing CLI is the single most likely reason this screen
 * does nothing on a fresh machine, and the failure without a probe is a Send
 * button that produces an error four seconds later at the bottom of a stream.
 * Saying it up front costs one request.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, PaneLayout, definePanes, token } from "@axf/core";

import { MONO, Tag, money, tokens as fmtTokens } from "./bits";
import Composer from "./Composer";
import Library from "./LibraryPane";
import PanelHost from "./PanelHost";
import ProjectsDialog from "./ProjectsDialog";
import Transcript from "./TranscriptView";
import { probeCli } from "./client";
import { library, useLibrary } from "./library";
import { MODEL_CATALOG, DEFAULT_TIER } from "../buildmgr/models";
import { projects, useProjects } from "./projects";
import { session, useSession, useTranscript } from "./session";
import { useWorkspaceUi, workspaceUi } from "./ui";
// The effort and permission vocabularies, pinned as exhaustive records against
// the broker's unions. In their own file since P4: the project editor offers
// the identical three choices, and importing them from here would be a cycle.
import {
  EFFORT_LABELS,
  EFFORT_LEVELS,
  PERMISSION_LABELS,
  PERMISSION_MODES,
  type EffortValue,
  type PermissionValue
} from "./vocab";

const TREE = definePanes({
  kind: "split",
  direction: "row",
  weights: [22, 56, 22],
  children: [
    { kind: "pane", id: "library", minSize: 200 },
    { kind: "pane", id: "main", minSize: 380 },
    { kind: "pane", id: "panels", minSize: 160 }
  ]
});

/* ------------------------------- start dialog ------------------------------- */

function StartDialog({
  open,
  onClose,
  onStart
}: {
  open: boolean;
  onClose: () => void;
  onStart: (options: {
    title?: string;
    model: string;
    effort?: string;
    permissionMode: string;
    cwd?: string;
    system?: string;
    projectId?: string;
  }) => Promise<void>;
}) {
  const projectState = useProjects();
  const [projectId, setProjectId] = React.useState<string>("");
  const [title, setTitle] = React.useState("");
  const [model, setModel] = React.useState(DEFAULT_TIER);
  const [effort, setEffort] = React.useState<EffortValue>(null);
  const [permissionMode, setPermissionMode] = React.useState<PermissionValue>("default");
  const [cwd, setCwd] = React.useState("");
  const [system, setSystem] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const project = projects.byId(projectId || null);

  /**
   * Adopt a project's defaults into the fields.
   *
   * The fields are FILLED rather than hidden, because the three model-shaped
   * ones are genuinely overridable per conversation and hiding them would make
   * the project look stricter than it is. The working directory is the
   * exception and is locked: the service refuses a start whose cwd disagrees
   * with the project's, so an editable box here would be an input whose only
   * possible non-default value is a 400.
   */
  const adopt = React.useCallback((id: string) => {
    setProjectId(id);
    setError(null);
    const picked = projects.byId(id || null);
    if (!picked) return;
    setModel(picked.model);
    setEffort(picked.effort);
    setPermissionMode(picked.permissionMode);
  }, []);

  // Opening on the project the library is filtered to. The selector and the
  // filter are ONE choice (`projects.ts` argues it): a dialog that opened on
  // "no project" while the pane behind it showed one would be the disagreement
  // that rule exists to prevent, restated in a dialog.
  React.useEffect(() => {
    if (!open) return;
    adopt(projectState.selectedId ?? "");
    // The dialog is remounted-in-place rather than re-created, so the fields
    // survive a close; re-adopting on open is what keeps them honest.
  }, [open, projectState.selectedId, adopt]);

  /**
   * Leave the dialog — including mid-start, which is the whole point of it.
   *
   * `busy` disables Cancel and blanks `onClose`, so a `start()` that never
   * settles used to seal every exit at once: no Cancel, no Escape, no backdrop,
   * and a full-screen modal over the workspace. The app was not frozen and the
   * tab was not locked; there was simply no way out of the dialog, which is
   * indistinguishable from frozen to the person looking at it.
   *
   * It RESETS `busy` rather than only closing, because the dialog is
   * remounted-in-place (see the adopt effect) — leaving the flag set would hand
   * the next open the same trap with the fields already filled in.
   *
   * The in-flight request is deliberately NOT cancelled. `start()` is a POST
   * that either created a conversation or did not, and the answer is the
   * library's to report; abandoning the dialog is about this screen, not about
   * the server. Hence the toast: a conversation may still be about to appear,
   * and silence there would read as the start having been thrown away.
   */
  function abandon() {
    if (busy) workspaceUi.say("Left the start dialog — if the conversation was created it appears in the library.");
    setBusy(false);
    onClose();
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await onStart({
        title: title.trim() || undefined,
        model,
        // "" means "do not pass --effort", which is a VALUE with a meaning and
        // not an unset default — `ConversationRecord.effort` argues it at
        // length: picking one here would override a CLI decision on every turn,
        // at a real difference in cost.
        effort: effort ?? undefined,
        permissionMode,
        // Never sent alongside a project: it is the project's, and the service
        // refuses a disagreement rather than picking a winner.
        cwd: project ? undefined : cwd.trim() || undefined,
        system: system.trim() || undefined,
        projectId: projectId || undefined
      });
      onClose();
    } catch (err) {
      // Shown IN the dialog, not as a toast: the refusal is about a field the
      // reader is looking at, and closing the dialog would take the field away
      // with the message.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      /*
       * Escape always works, a backdrop click does not while a start is in
       * flight. The two are not the same gesture: Escape and the X are somebody
       * SAYING let me out, and a click on the backdrop is most often a miss.
       * Blocking the deliberate ones to protect against the accidental one is
       * what made this dialog inescapable.
       */
      onClose={(_event, reason) => {
        if (busy && reason === "backdropClick") return;
        abandon();
      }}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle
        sx={{ fontSize: 15, fontWeight: 700, display: "flex", alignItems: "center", gap: 1 }}
      >
        <Box component="span" sx={{ flex: 1 }}>
          New conversation
        </Box>
        {/* Never disabled, unlike Cancel — this is the one control that has to
            keep working when everything else is waiting on the server. An X is
            a rotated +: the glyph contract carries no `icon-close`, and this
            rotation is the established answer in this tree rather than a new
            required drawing every branding pack would have to supply
            (`plugins/tab-bar/TabBar.tsx`, `amberxvid/kit/icons.tsx`). */}
        <Tooltip title={busy ? "Stop waiting and close — the start keeps running" : "Close"}>
          <IconButton
            size="small"
            aria-label="Close"
            onClick={abandon}
            sx={{ transform: "rotate(45deg)", "&:hover": { color: token("err") } }}
          >
            <Glyph id="icon-plus" size={13} />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={1.6} sx={{ mt: 0.6 }}>
          <TextField
            size="small"
            select
            label="Project"
            value={projectId}
            onChange={(e) => adopt(e.target.value)}
            slotProps={{ select: { displayEmpty: true } }}
            helperText={
              project
                ? `Runs in ${project.cwd}. Its instructions${
                    project.knowledge.length
                      ? ` and ${project.knowledge.length} knowledge file${project.knowledge.length === 1 ? "" : "s"}`
                      : ""
                  } are prepended to the first turn.`
                : "No project: the conversation runs wherever you point it and carries no standing instructions."
            }
          >
            <MenuItem value="">
              <Box component="span" sx={{ color: token("dim") }}>
                (no project)
              </Box>
            </MenuItem>
            {projectState.projects.map((candidate) => (
              <MenuItem key={candidate.id} value={candidate.id}>
                {candidate.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Title"
            placeholder="Left blank, the service mints a dated one"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <TextField
            size="small"
            select
            label="Model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            helperText="The catalog is the one roster; an unknown model is refused rather than defaulted."
          >
            {MODEL_CATALOG.map((info) => (
              <MenuItem key={info.slug} value={info.slug}>
                {info.label} — ${info.inPerMTok}/${info.outPerMTok} per MTok
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            select
            label="Effort"
            value={effort ?? ""}
            onChange={(e) => setEffort((e.target.value || null) as EffortValue)}
            helperText="Left unset, the flag is not passed and the CLI uses its own default."
          >
            <MenuItem value="">(do not pass --effort)</MenuItem>
            {EFFORT_LEVELS.map((level) => (
              <MenuItem key={level} value={level}>
                {EFFORT_LABELS[level]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            select
            label="Permission mode"
            value={permissionMode}
            onChange={(e) => setPermissionMode(e.target.value as PermissionValue)}
          >
            {PERMISSION_MODES.map((mode) => (
              <MenuItem key={mode} value={mode}>
                {PERMISSION_LABELS[mode]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Working directory"
            placeholder="Left blank, the server's own cwd"
            value={project ? project.cwd : cwd}
            onChange={(e) => setCwd(e.target.value)}
            disabled={Boolean(project)}
            helperText={
              project
                ? `Bound by “${project.name}”. A conversation in a project runs in the project's tree; the service refuses a start that asks for another.`
                : "What the CLI's tools can see. A path that does not exist is refused loudly rather than falling back."
            }
            slotProps={{ input: { sx: MONO } }}
          />
          <TextField
            size="small"
            label="System contract"
            placeholder={
              project
                ? "Optional, and additional — the project's instructions come first."
                : "Optional. Prepended on the first turn only."
            }
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            multiline
            minRows={2}
            maxRows={8}
          />
          {error && <Typography sx={{ fontSize: 12, color: token("err") }}>{error}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {/* No longer disabled while busy — see `abandon`. The LABEL changes
            instead, because "Cancel" next to a spinner promises to cancel the
            start, and this button does not: the POST is already gone. */}
        <Button size="small" onClick={abandon}>
          {busy ? "Close" : "Cancel"}
        </Button>
        <Button size="small" variant="contained" onClick={() => void start()} disabled={busy}>
          {busy ? "Starting…" : "Start"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ------------------------------ rename dialog ------------------------------- */

function RenameDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const state = useLibrary();
  const meta = id ? state.conversations.find((c) => c.id === id) : null;
  const [title, setTitle] = React.useState("");
  React.useEffect(() => setTitle(meta?.title ?? ""), [meta?.title, id]);

  async function save() {
    if (!id) return;
    try {
      await library.rename(id, title);
      workspaceUi.say("Renamed");
      onClose();
    } catch (err) {
      workspaceUi.say(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <Dialog open={Boolean(id)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 700 }}>Rename conversation</DialogTitle>
      <DialogContent dividers>
        <TextField
          autoFocus
          size="small"
          fullWidth
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button size="small" variant="contained" onClick={() => void save()} disabled={!title.trim()}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* --------------------------------- the screen -------------------------------- */

export default function ClaudeWorkspaceModule() {
  const state = useSession();
  const model = useTranscript();
  const ui = useWorkspaceUi();
  // Subscribed here, not just in the panes, so the header's project tag
  // repaints when a project is renamed in the manager.
  useProjects();
  const [startOpen, setStartOpen] = React.useState(false);
  const [cli, setCli] = React.useState<{ ok: boolean; detail: string } | null>(null);

  React.useEffect(() => {
    let alive = true;
    void probeCli().then((result) => {
      if (alive) setCli(result);
    });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!ui.toast) return;
    const timer = window.setTimeout(() => workspaceUi.clearToast(), 4000);
    return () => window.clearTimeout(timer);
  }, [ui.toast]);

  const record = state.record;
  const project = projects.byId(record?.projectId);

  const onStart = React.useCallback(
    async (options: Parameters<React.ComponentProps<typeof StartDialog>["onStart"]>[0]) => {
      await session.start(options);
      // The new conversation has to appear in the library immediately, or the
      // reader is looking at a transcript with no row selected anywhere.
      await library.refresh();
    },
    []
  );

  const onSend = React.useCallback(async (text: string) => {
    // Not awaited to completion: `send()` resolves when the turn ENDS, and the
    // composer only needs to know the send was accepted. The store already has
    // the segment by the time this returns, so a rejection here is a genuine
    // refusal (no conversation open) rather than a failed turn — which belongs
    // in the transcript, where it is rendered as a notice.
    void session.send(text);
  }, []);

  const renderPane = React.useCallback(
    (id: string): React.ReactNode => {
      if (id === "library") {
        return (
          <Box sx={{ height: "100%", minHeight: 0, borderRight: `1px solid ${token("edge")}` }}>
            <Library onNew={() => setStartOpen(true)} />
          </Box>
        );
      }
      if (id === "panels") {
        return (
          <Box sx={{ height: "100%", minHeight: 0, borderLeft: `1px solid ${token("edge")}` }}>
            <PanelHost />
          </Box>
        );
      }
      return (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
          <Transcript
            model={model}
            loading={state.loading}
            emptyState={
              <Box sx={{ m: "auto", textAlign: "center", maxWidth: 460, py: 4 }}>
                <Glyph id="icon-chat" size={34} />
                <Typography sx={{ fontSize: 14, fontWeight: 700, mt: 1 }}>
                  {record ? "Nothing said yet" : "No conversation open"}
                </Typography>
                <Typography sx={{ fontSize: 12, color: token("dim"), mt: 0.6, lineHeight: 1.6 }}>
                  {record
                    ? "Ask something below. Answers stream as they are written; tool calls, thinking and subagent runs appear inline as they happen."
                    : "Pick one from the library, or start a new one. Conversations are on disk and resume through a server restart."}
                </Typography>
                {!record && (
                  <Button size="small" variant="contained" sx={{ mt: 1.4 }} onClick={() => setStartOpen(true)}>
                    New conversation
                  </Button>
                )}
              </Box>
            }
          />
          {state.error && (
            <Typography sx={{ fontSize: 11.5, color: token("err"), px: 1.6, py: 0.4 }}>
              {state.error}
            </Typography>
          )}
          <Composer
            disabled={!record || model.streaming}
            streaming={model.streaming}
            onSend={onSend}
            onStop={() => void session.stop()}
            placeholder={record ? undefined : "Open or start a conversation first"}
          />
        </Box>
      );
    },
    [model, record, state.loading, state.error, onSend]
  );

  return (
    <Box
      data-axf-area="claude-workspace.surface"
      sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
    >
      {/* ------------------------------------------------------------ header */}
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        sx={{
          alignItems: "center",
          flexWrap: "wrap",
          px: 1.4,
          py: 0.7,
          borderBottom: `1px solid ${token("edge")}`
        }}
      >
        <Glyph id="icon-chat" size={20} />
        <Typography
          sx={{
            fontSize: 15,
            fontWeight: 700,
            maxWidth: 420,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
          title={record?.title}
        >
          {record?.title ?? "Claude"}
        </Typography>

        {record && (
          <>
            {/* The project first: it is the frame the rest is read inside, and
                it is what tells you which tree the cwd tag below belongs to. A
                conversation whose project was deleted keeps its own settings
                and simply shows none — see `removeProject`. */}
            {project && (
              <Tag
                tone="accent"
                title={`Project “${project.name}” — bound to ${project.cwd}. Its instructions reached this conversation's first turn.`}
              >
                {project.name}
              </Tag>
            )}
            <Tag tone="accent2">{record.model}</Tag>
            {record.effort && <Tag tone="dim">effort {record.effort}</Tag>}
            <Tag tone={record.permissionMode === "bypassPermissions" ? "warn" : "dim"}>
              {record.permissionMode}
            </Tag>
            <Tooltip title={`Working directory: ${record.cwd}`}>
              <Box component="span">
                <Tag tone="dim">{record.cwd.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? "/"}</Tag>
              </Box>
            </Tooltip>
            <Tag
              tone={record.totalCostUsd > 0 ? "ok" : "dim"}
              title="The CLI's own reported total — what the account was actually charged, cache tiers included."
            >
              {money(record.totalCostUsd)}
            </Tag>
            {record.cliSessionId ? (
              <Tag tone="ok" title={`Resumable — --resume ${record.cliSessionId}`}>
                resumable
              </Tag>
            ) : (
              <Tag tone="dim" title="The CLI has not reported a session id yet; it arrives on the first turn.">
                new session
              </Tag>
            )}
            {model.usage && (
              <Tag tone="dim" title="Last turn's tokens: input + cache read + cache creation.">
                {fmtTokens(
                  model.usage.inputTokens + model.usage.cacheReadTokens + model.usage.cacheCreationTokens
                )}{" "}
                in · {fmtTokens(model.usage.outputTokens)} out
              </Tag>
            )}
          </>
        )}

        <Box sx={{ flex: 1 }} />

        {cli && !cli.ok && (
          <Tooltip title={cli.detail}>
            <Box component="span">
              <Tag tone="err">the claude CLI did not answer</Tag>
            </Box>
          </Tooltip>
        )}

        <Button size="small" variant="outlined" onClick={() => setStartOpen(true)}>
          New
        </Button>
        {/* The settings affordance moved to the SHELL (core 0.0.20): the gear
            on ModuleHost and the universal "Module settings" row open the one
            SettingsDialog — the framework this button's old comment said did
            not exist yet. */}
      </Stack>

      {/* -------------------------------------------------------------- panes */}
      <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <PaneLayout tree={TREE} renderPane={renderPane} storageKey="claude-workspace" />
      </Box>

      <StartDialog open={startOpen} onClose={() => setStartOpen(false)} onStart={onStart} />
      <RenameDialog id={ui.renaming} onClose={() => workspaceUi.rename(null)} />
      {/* Driven through `ui.ts` rather than local state: a context-menu command
          is a plain function and cannot mount a dialog, and "Manage projects…"
          is one of them. */}
      <ProjectsDialog open={ui.projectsOpen} onClose={() => workspaceUi.projects(false)} />

      <Snackbar
        open={Boolean(ui.toast)}
        message={ui.toast ?? ""}
        onClose={() => workspaceUi.clearToast()}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}

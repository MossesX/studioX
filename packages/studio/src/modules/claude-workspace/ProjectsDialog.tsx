"use client";

/**
 * @file The project manager — `axf-claude` P4's screen.
 *
 * One dialog, two columns: the projects that exist, and the editor for the one
 * selected. Everything a project holds is here, because a project is *"a bound
 * working directory, instructions, knowledge files, and defaults"* and splitting
 * those across a wizard would mean four steps to change one path.
 *
 * ── the working directory is the first field, and it says what it resolves to ─
 *
 * The step's own words: *"the CLI already runs with a cwd, so surface it
 * deliberately rather than leaving it implicit."* Surfacing it is not putting a
 * text box on a screen — it is making the binding legible at the moment it is
 * set. So the field is first, it is monospace, the service refuses a directory
 * that does not exist by name, and the refusal is rendered against the field
 * rather than as a toast that closes over the thing it is about.
 *
 * ── the knowledge rows resolve, live ─────────────────────────────────────────
 *
 * Each row shows what its path resolves to on disk right now: a size, or a
 * reason it does not. That readout is the whole reason `GET /projects/<id>`
 * answers two things at once (`KnowledgeStatus` states the argument): a
 * knowledge file that is missing is SKIPPED at turn time, silently by design,
 * because telling the model about the operator's typo helps nobody. Which makes
 * this the only place the typo can be caught — before a turn has been spent.
 *
 * ── the draft is local, the record is not ────────────────────────────────────
 *
 * Edits live in component state until Save, so a half-typed path is never
 * written and never resolved. `projects.save()` folds the returned record back
 * into the store, which is what updates the library filter, the start dialog's
 * selector and the header tag at once — none of them are told anything here.
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
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { MONO, Tag } from "./bits";
import { MODEL_CATALOG, DEFAULT_TIER } from "../buildmgr/models";
import { useLibrary } from "./library";
import { projects, useProjects } from "./projects";
import { workspaceUi } from "./ui";
import {
  EFFORT_LABELS,
  EFFORT_LEVELS,
  PERMISSION_LABELS,
  PERMISSION_MODES,
  type EffortValue,
  type PermissionValue
} from "./vocab";
import type { KnowledgeFile, ProjectRecord } from "../../claude/types";

/** The editor's working copy. A draft with no `id` is a project being created;
 *  one identity check rather than a parallel `mode` flag that can disagree
 *  with it. */
interface Draft {
  id: string | null;
  name: string;
  cwd: string;
  instructions: string;
  knowledge: KnowledgeFile[];
  model: string;
  effort: EffortValue;
  permissionMode: PermissionValue;
}

const BLANK: Draft = {
  id: null,
  name: "",
  cwd: "",
  instructions: "",
  knowledge: [],
  model: DEFAULT_TIER,
  effort: null,
  permissionMode: "default"
};

function draftOf(record: ProjectRecord): Draft {
  return {
    id: record.id,
    name: record.name,
    cwd: record.cwd,
    instructions: record.instructions,
    knowledge: record.knowledge.map((file) => ({ ...file })),
    model: record.model,
    effort: record.effort,
    permissionMode: record.permissionMode
  };
}

/** Bytes, at the resolution a person reads. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* -------------------------------- project rows -------------------------------- */

function ProjectRow({
  record,
  conversations,
  active,
  onPick
}: {
  record: ProjectRecord;
  conversations: number;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <Box
      data-axf-area="claude-workspace.project"
      data-axf-project={record.id}
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick();
        }
      }}
      sx={{
        px: 1,
        py: 0.7,
        cursor: "pointer",
        borderLeft: `2px solid ${active ? token("accent") : "transparent"}`,
        background: active ? token("panel2") : "transparent",
        "&:hover": { background: token("panel2") }
      }}
    >
      <Typography
        sx={{
          fontSize: 12.8,
          fontWeight: active ? 700 : 600,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
        title={record.name}
      >
        {record.name}
      </Typography>
      <Typography
        sx={{
          ...MONO,
          fontSize: 10.5,
          color: token("dim"),
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          direction: "rtl",
          textAlign: "left"
        }}
        title={record.cwd}
      >
        {record.cwd}
      </Typography>
      <Box sx={{ display: "flex", gap: 0.5, mt: 0.35, flexWrap: "wrap" }}>
        <Tag tone="accent2">{record.model}</Tag>
        {record.knowledge.length > 0 && (
          <Tag tone="dim">
            {record.knowledge.length} file{record.knowledge.length === 1 ? "" : "s"}
          </Tag>
        )}
        <Tag tone={conversations ? "ok" : "dim"}>
          {conversations} conv{conversations === 1 ? "" : "s"}
        </Tag>
      </Box>
    </Box>
  );
}

/* -------------------------------- knowledge rows ------------------------------ */

function KnowledgeRows({
  draft,
  onChange
}: {
  draft: Draft;
  onChange: (knowledge: KnowledgeFile[]) => void;
}) {
  const state = useProjects();
  const statuses = projects.knowledgeFor(draft.id);

  const set = (index: number, patch: Partial<KnowledgeFile>) => {
    onChange(draft.knowledge.map((file, i) => (i === index ? { ...file, ...patch } : file)));
  };

  return (
    <Stack spacing={0.6}>
      {draft.knowledge.map((file, index) => {
        // Matched by PATH rather than by index: the statuses came back for the
        // saved record, and the draft may have added or removed rows since. An
        // index match would put the wrong tick against the wrong path, which is
        // worse than no tick at all.
        const status = statuses.find((s) => s.path === file.path);
        return (
          <Stack key={index} direction="row" spacing={0.6} sx={{ alignItems: "flex-start" }}>
            <TextField
              size="small"
              value={file.path}
              onChange={(e) => set(index, { path: e.target.value })}
              placeholder="README.md, or an absolute path"
              slotProps={{ input: { sx: { ...MONO, fontSize: 12 } } }}
              sx={{ flex: 2 }}
              helperText={
                !draft.id
                  ? "Resolved once the project is saved."
                  : !file.path.trim()
                    ? " "
                    : !status
                      ? "Not resolved yet — save to check it."
                      : status.exists
                        ? `${size(status.bytes)}${status.truncated ? " — will be truncated" : ""}`
                        : (status.error ?? "not found")
              }
              // The colour is the whole affordance: a missing knowledge file is
              // skipped at turn time and says nothing, so this row is the only
              // warning there is.
              error={Boolean(draft.id && file.path.trim() && status && !status.exists)}
            />
            <TextField
              size="small"
              value={file.note ?? ""}
              onChange={(e) => set(index, { note: e.target.value })}
              placeholder="why it is here (optional)"
              sx={{ flex: 3 }}
              slotProps={{ input: { sx: { fontSize: 12 } } }}
              helperText=" "
            />
            <Tooltip title="Remove this file from the project's knowledge. The file on disk is not touched.">
              <IconButton
                size="small"
                aria-label={`Remove ${file.path || "this knowledge file"}`}
                onClick={() => onChange(draft.knowledge.filter((_, i) => i !== index))}
                sx={{ mt: 0.3 }}
              >
                {/* `eraser` — "remove without deleting" in the glyph contract,
                    which is exactly what this does: the row leaves the list and
                    the file stays on disk. Not a stand-in for a missing X; the
                    distinction is the one thing about this button worth
                    getting across. */}
                <Glyph id="icon-eraser" size={12} />
              </IconButton>
            </Tooltip>
          </Stack>
        );
      })}

      <Box>
        <Button
          size="small"
          variant="outlined"
          onClick={() => onChange([...draft.knowledge, { path: "" }])}
          disabled={state.loading}
        >
          Add a knowledge file
        </Button>
      </Box>
    </Stack>
  );
}

/* ---------------------------------- the dialog -------------------------------- */

export default function ProjectsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const state = useProjects();
  const conversations = useLibrary().conversations;
  const [draft, setDraft] = React.useState<Draft>(BLANK);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Opening the dialog reloads the list, then adopts the selected project as
  // the draft — so the editor opens on the project the library is filtered to
  // rather than on nothing, which is what the reader is already looking at.
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    void projects.refresh().then(() => {
      if (!alive) return;
      const selected = projects.selected();
      if (selected) {
        setDraft(draftOf(selected));
        void projects.loadKnowledge(selected.id);
      }
    });
    return () => {
      alive = false;
    };
  }, [open]);

  const pick = React.useCallback((record: ProjectRecord) => {
    setError(null);
    setDraft(draftOf(record));
    void projects.loadKnowledge(record.id);
  }, []);

  /** Leave, including mid-save — the same escape hatch, and for the same reason,
   *  as `StartDialog`'s `abandon`: `busy` blanked `onClose` and disabled Cancel
   *  at once, so a save or delete that never settled sealed every exit behind a
   *  full-screen backdrop. `busy` is reset because this dialog is also
   *  remounted-in-place, and a stuck flag would trap the next open too. */
  function abandon() {
    if (busy) workspaceUi.say("Left the project manager — the save is still running.");
    setBusy(false);
    onClose();
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const request = {
        name: draft.name,
        cwd: draft.cwd,
        instructions: draft.instructions,
        // Blank rows are dropped rather than refused: an empty row is how a
        // person cancels an "Add" they thought better of, and failing the save
        // over it would make the button a trap.
        knowledge: draft.knowledge.filter((file) => file.path.trim()),
        model: draft.model,
        effort: draft.effort ?? "",
        permissionMode: draft.permissionMode
      };
      const record = draft.id
        ? await projects.save(draft.id, request)
        : await projects.create(request);
      setDraft(draftOf(record));
      workspaceUi.say(`Saved “${record.name}”`);
    } catch (err) {
      // In the dialog, not as a toast: the refusal names a field the reader is
      // looking at, and a toast would close over the thing it is about.
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    const members = conversations.filter((c) => c.projectId === draft.id).length;
    const ok = window.confirm(
      members
        ? `Delete “${draft.name}”? Its ${members} conversation${members === 1 ? "" : "s"} ` +
            `will be kept and unfiled — their transcripts, working directories and models are ` +
            `their own and are not touched.`
        : `Delete “${draft.name}”? The project's instructions and knowledge list are removed. ` +
            `Nothing on disk in ${draft.cwd} is touched.`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      // `detach` only when there is something to detach, so the ordinary delete
      // still travels the path that REFUSES to orphan — a flag passed
      // unconditionally is a guard turned off unconditionally.
      await projects.remove(draft.id, members ? { detach: true } : {});
      setDraft(BLANK);
      workspaceUi.say("Project deleted");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const dirty = React.useMemo(() => {
    const record = state.projects.find((p) => p.id === draft.id);
    if (!record) return Boolean(draft.name.trim() || draft.cwd.trim());
    return JSON.stringify(draftOf(record)) !== JSON.stringify(draft);
  }, [draft, state.projects]);

  return (
    <Dialog
      open={open}
      // Escape always; a backdrop click only when nothing is in flight. See
      // `StartDialog`'s copy of this for the argument.
      onClose={(_event, reason) => {
        if (busy && reason === "backdropClick") return;
        abandon();
      }}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle
        sx={{ fontSize: 15, fontWeight: 700, display: "flex", alignItems: "baseline", gap: 1 }}
      >
        <Box component="span">Projects</Box>
        <Typography component="span" sx={{ fontSize: 11.5, color: token("dim"), flex: 1 }}>
          a bound working directory, standing instructions and the files that go with them
        </Typography>
        {/* Never disabled — an X is a rotated + (no `icon-close` in the glyph
            contract; see `plugins/tab-bar/TabBar.tsx`). */}
        <Tooltip title={busy ? "Stop waiting and close — the save keeps running" : "Close"}>
          <IconButton
            size="small"
            aria-label="Close"
            onClick={abandon}
            sx={{ alignSelf: "center", transform: "rotate(45deg)", "&:hover": { color: token("err") } }}
          >
            <Glyph id="icon-plus" size={13} />
          </IconButton>
        </Tooltip>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0 }}>
        <Box sx={{ display: "flex", minHeight: 420 }}>
          {/* ----------------------------------------------------- the list */}
          <Box
            data-axf-area="claude-workspace.projects"
            sx={{
              width: 220,
              flexShrink: 0,
              borderRight: `1px solid ${token("edge")}`,
              display: "flex",
              flexDirection: "column"
            }}
          >
            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {!state.ready && (
                <Typography sx={{ fontSize: 11.5, color: token("dim"), p: 1 }}>Loading…</Typography>
              )}
              {state.ready && !state.projects.length && (
                <Typography sx={{ fontSize: 11.5, color: token("dim"), p: 1, lineHeight: 1.6 }}>
                  No projects yet. One binds a working directory to a set of instructions and
                  knowledge files, and every conversation started under it inherits all of them.
                </Typography>
              )}
              {state.projects.map((record) => (
                <ProjectRow
                  key={record.id}
                  record={record}
                  conversations={conversations.filter((c) => c.projectId === record.id).length}
                  active={record.id === draft.id}
                  onPick={() => pick(record)}
                />
              ))}
            </Box>
            <Box sx={{ p: 0.8, borderTop: `1px solid ${token("edge")}` }}>
              <Button
                size="small"
                variant="outlined"
                fullWidth
                onClick={() => {
                  setError(null);
                  setDraft(BLANK);
                }}
              >
                New project
              </Button>
            </Box>
          </Box>

          {/* --------------------------------------------------- the editor */}
          <Box sx={{ flex: 1, minWidth: 0, p: 1.6, overflowY: "auto" }}>
            <Stack spacing={1.6}>
              <TextField
                size="small"
                label="Name"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="What this project is"
                autoFocus
              />

              <TextField
                size="small"
                label="Bound working directory"
                value={draft.cwd}
                onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
                placeholder="C:\Home\Projects\something"
                slotProps={{ input: { sx: MONO } }}
                helperText={
                  "Every conversation in this project runs its CLI here, and the directory is " +
                  "named in the model's contract as well as set on the process. A path that does " +
                  "not exist is refused rather than falling back."
                }
              />

              <TextField
                size="small"
                label="Instructions"
                value={draft.instructions}
                onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
                placeholder="Standing context for every conversation in this project."
                multiline
                minRows={4}
                maxRows={14}
                helperText="Prepended to the first turn of every conversation here. Edits reach the next new conversation immediately; a conversation already resumed keeps the contract it started with."
              />

              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 700, mb: 0.6 }}>
                  Knowledge files
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: token("dim"), mb: 0.8, lineHeight: 1.6 }}>
                  Paths, not copies — the file on disk is the knowledge. Relative paths resolve
                  inside the bound directory. Included verbatim on the first turn, so they are
                  billed on every new conversation.
                </Typography>
                <KnowledgeRows
                  draft={draft}
                  onChange={(knowledge) => setDraft({ ...draft, knowledge })}
                />
              </Box>

              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  select
                  label="Default model"
                  value={draft.model}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                  sx={{ flex: 2 }}
                >
                  {MODEL_CATALOG.map((info) => (
                    <MenuItem key={info.slug} value={info.slug}>
                      {info.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  select
                  label="Default effort"
                  value={draft.effort ?? ""}
                  onChange={(e) =>
                    setDraft({ ...draft, effort: (e.target.value || null) as EffortValue })
                  }
                  sx={{ flex: 1 }}
                >
                  <MenuItem value="">(unset)</MenuItem>
                  {EFFORT_LEVELS.map((level) => (
                    <MenuItem key={level} value={level}>
                      {EFFORT_LABELS[level]}
                    </MenuItem>
                  ))}
                </TextField>
              </Stack>

              <TextField
                size="small"
                select
                label="Default permission mode"
                value={draft.permissionMode}
                onChange={(e) =>
                  setDraft({ ...draft, permissionMode: e.target.value as PermissionValue })
                }
              >
                {PERMISSION_MODES.map((mode) => (
                  <MenuItem key={mode} value={mode}>
                    {PERMISSION_LABELS[mode]}
                  </MenuItem>
                ))}
              </TextField>

              <Typography sx={{ fontSize: 11.5, color: token("dim"), lineHeight: 1.6 }}>
                The three defaults above fill a new conversation's dialog and can be changed there
                — a model genuinely varies turn to turn. The working directory does not: a
                conversation in this project runs in this tree, and a start that asks for another
                one is refused.
              </Typography>

              {error && (
                <Typography sx={{ fontSize: 12, color: token("err") }} role="alert">
                  {error}
                </Typography>
              )}
            </Stack>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        {draft.id && (
          <Button size="small" color="error" onClick={() => void remove()} disabled={busy}>
            Delete
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {/* Enabled while busy — it closes the dialog, it does not call back a
            save that has already gone. */}
        <Button size="small" onClick={abandon}>
          Close
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={() => void save()}
          disabled={busy || !dirty || !draft.name.trim() || !draft.cwd.trim()}
        >
          {busy ? "Saving…" : draft.id ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

"use client";

/**
 * @file The AmberX Vid recording library (P5) — browse, replay, playback over
 * the versioned edit-ready manifest store.
 *
 * Browse is grid + list (the choice sticks in `localStorage`, read on mount —
 * never during render): thumbnails, duration, capture date, owner and the
 * engine badge (browser / tray / server) on every recording, filtered by one search
 * box. The player is a full playback surface — scrub, speed, loop, fullscreen,
 * per-recording notes — over the store's Range-serving media route, with the
 * MediaRecorder-webm Infinity-duration quirk handled (seek-to-huge forces
 * Chrome to build the seek index, the manifest's duration is the honest
 * fallback throughout).
 *
 * Visibility follows the store (2026-08-03): the listing a member gets back
 * holds ONLY their own captures — an administrator gets every member's, which
 * is why the owner column and the "everyone's recordings" scope chip are only
 * meaningful for them. Nothing is filtered here; the server never sends what
 * the caller may not see.
 *
 * Mutations are lean and gated exactly like the API: rename and notes on your
 * own finished recordings, delete on your own OR — for an administrator — on
 * anyone's, plus the admin-only "Delete all" sweep of the whole library (the
 * server journals each to the activity ledger); export downloads a recording
 * you can see via the route's `download=1` disposition. The manifest rides
 * end-to-end untouched — `edits` surfaces as a badge when a future editing
 * phase writes any, and nothing here ever strips a field.
 *
 * Context menus stay deliberately lean per the build directive: play, rename,
 * export, delete — exact-object headers, nothing encyclopedic. Empty states
 * are branded, honest, and animation respects the module intensity knob.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Search as SearchIcon } from "./kit/icons";
import { Refresh as RefreshIcon } from "./kit/icons";
import { GridView as GridIcon } from "./kit/icons";
import { ViewList as ListIcon } from "./kit/icons";
import { PlayArrow as PlayIcon } from "./kit/icons";
import { Pause as PauseIcon } from "./kit/icons";
import { Autorenew as LoopIcon } from "./kit/icons";
import { Fullscreen as FullscreenIcon } from "./kit/icons";
import { FullscreenExit as FullscreenExitIcon } from "./kit/icons";
import { Download as ExportIcon } from "./kit/icons";
import { Edit as RenameIcon } from "./kit/icons";
import { Delete as DeleteIcon } from "./kit/icons";
import { Save as SaveIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip, useCtx, type CtxItem } from "./kit/ax";
import { GizmoXMark } from "./gizmox-kit";
import DataTable, { type ColumnDef } from "./kit/DataTable";
import { useToast } from "./kit/Toast";
import type { RecordingManifest } from "./lib/types";
import { fmtBytes, fmtClock } from "./Recorder";
import { useAnimationIntensity } from "./Splash";
import { axvPlatform, useAxvSubjectResolver } from "./ctxBridge";

/* --------------------------------- contracts ---------------------------------- */

export interface LibraryProps {
  /** The loaded profile's username — mutation rights follow ownership. */
  meUsername: string;
  /**
   * True when the loaded profile is an administrator: they receive every
   * member's recordings from the store and may delete any of them, singly or
   * with the whole-library sweep. Cosmetic here — the server re-verifies the
   * role on every request.
   */
  isAdmin: boolean;
  /** Username → display name (screenname when chosen) for the owner column. */
  screennameOf: (username: string) => string;
  /** Bumps when either engine finalizes a capture — the refetch key. */
  refreshTick: number;
  /** Non-null opens the player on that recording (the recorder's play action). */
  focusId: string | null;
  onFocusConsumed: () => void;
}

type LibView = "grid" | "list";
type LibState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; recordings: RecordingManifest[] };

const VIEW_KEY = "gx:amberxvid.library.view";
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const mediaUrl = (id: string): string => `/api/amberxvid/recordings/${id}/file`;
const thumbUrl = (id: string): string => `${mediaUrl(id)}?kind=thumb`;

/** One colour per capture engine — `server` (P10) reads distinct from both
 *  local engines, because where a recording was made is the fact the badge
 *  exists to state. */
const engineChipKind = (engine: string): string =>
  engine === "tray" ? "warn" : engine === "server" ? "info" : "accent";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** POST one library action; returns the fresh manifest or throws its error. */
async function libraryAction(body: Record<string, unknown>): Promise<RecordingManifest> {
  const res = await fetch("/api/amberxvid/recordings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; manifest?: RecordingManifest; error?: string }
    | null;
  if (!res.ok || !json?.ok || !json.manifest) {
    throw new Error(json?.error ?? `library answered ${res.status}`);
  }
  return json.manifest;
}

/* ---------------------------------- library ----------------------------------- */

export default function Library({
  meUsername,
  isAdmin,
  screennameOf,
  refreshTick,
  focusId,
  onFocusConsumed,
}: LibraryProps) {
  const toast = useToast();
  const intensity = useAnimationIntensity();
  const { openCtx, ctxMenu } = useCtx();

  const [state, setState] = React.useState<LibState>({ kind: "loading" });
  const [view, setView] = React.useState<LibView>("grid");
  const [find, setFind] = React.useState("");
  const [playerId, setPlayerId] = React.useState<string | null>(null);
  const [renameTarget, setRenameTarget] = React.useState<RecordingManifest | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<RecordingManifest | null>(null);
  const [purgeOpen, setPurgeOpen] = React.useState(false);
  const [purging, setPurging] = React.useState(false);

  /* the view choice sticks — read on mount, never during render */
  React.useEffect(() => {
    const stored = window.localStorage.getItem(VIEW_KEY);
    if (stored === "grid" || stored === "list") setView(stored);
  }, []);
  const switchView = (next: LibView) => {
    setView(next);
    window.localStorage.setItem(VIEW_KEY, next);
  };

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/amberxvid/recordings");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setState({ kind: "error", message: body?.error ?? `library answered ${res.status}` });
        return;
      }
      const body = (await res.json()) as { recordings: RecordingManifest[] };
      // Finished recordings only — an open capture belongs to its engine.
      setState({ kind: "ready", recordings: body.recordings.filter((r) => r.endedAt !== null) });
    } catch {
      setState({ kind: "error", message: "the library store did not answer" });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load, refreshTick]);

  /* the recorder's "play in the library" hand-off */
  React.useEffect(() => {
    if (focusId !== null) {
      setPlayerId(focusId);
      onFocusConsumed();
    }
  }, [focusId, onFocusConsumed]);

  const recordings = state.kind === "ready" ? state.recordings : [];
  const needle = find.trim().toLowerCase();
  const shown = recordings.filter(
    (r) =>
      !needle ||
      r.title.toLowerCase().includes(needle) ||
      r.owner.toLowerCase().includes(needle) ||
      screennameOf(r.owner).toLowerCase().includes(needle) ||
      r.engine.includes(needle)
  );
  const playerRec = playerId ? recordings.find((r) => r.id === playerId) ?? null : null;

  /* ------------------------------- mutations --------------------------------- */

  const isMine = (r: RecordingManifest) => r.owner.toLowerCase() === meUsername.toLowerCase();
  /** Delete answers to the owner and to an administrator; rename/notes do not. */
  const canDelete = (r: RecordingManifest) => isMine(r) || isAdmin;

  const patchLocal = React.useCallback((manifest: RecordingManifest) => {
    setState((s) =>
      s.kind === "ready"
        ? { kind: "ready", recordings: s.recordings.map((r) => (r.id === manifest.id ? manifest : r)) }
        : s
    );
  }, []);

  const exportRecording = React.useCallback(
    (r: RecordingManifest) => {
      const a = document.createElement("a");
      a.href = `${mediaUrl(r.id)}?download=1`;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast(`Exporting "${r.title}" — check your downloads`);
    },
    [toast]
  );

  const confirmDelete = React.useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      await libraryAction({ action: "delete", id: target.id });
      setPlayerId((p) => (p === target.id ? null : p));
      setState((s) =>
        s.kind === "ready"
          ? { kind: "ready", recordings: s.recordings.filter((r) => r.id !== target.id) }
          : s
      );
      toast(`Deleted "${target.title}"`);
    } catch (e) {
      toast(`Delete failed — ${e instanceof Error ? e.message : "store unreachable"}`);
    }
  }, [deleteTarget, toast]);

  /** The administrator's sweep — every recording in the store, gone. */
  const purgeAll = React.useCallback(async () => {
    setPurging(true);
    try {
      const res = await fetch("/api/amberxvid/recordings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-all" }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; deleted?: number; skippedOpen?: number; error?: string }
        | null;
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? `library answered ${res.status}`);
      setPurgeOpen(false);
      setPlayerId(null);
      await load();
      const skipped = Number(json.skippedOpen ?? 0);
      toast(
        `Deleted ${Number(json.deleted ?? 0)} recording(s)${skipped > 0 ? ` — ${skipped} still capturing were left alone` : ""}`
      );
    } catch (e) {
      toast(`Delete all failed — ${e instanceof Error ? e.message : "store unreachable"}`);
    } finally {
      setPurging(false);
    }
  }, [load, toast]);

  /* lean by directive: play, rename, export, delete — nothing encyclopedic */
  /**
   * The declared `amberxvid.recording` area's behaviour (P15).
   *
   * A resolver over the loaded recordings — both views are `.map()`s (and one
   * of them is a `DataTable`, whose rows this component does not even render).
   * Every row summons what this screen already does: the rename DIALOG, the
   * delete CONFIRM, the player. None of it is re-implemented here, so a delete
   * from the menu is the same delete as a delete from the row.
   */
  useAxvSubjectResolver("recording", (id) => {
    const r = recordings.find((x) => x.id === id);
    if (!r) return null;
    return {
      play: () => setPlayerId(r.id),
      rename: () => setRenameTarget(r),
      remove: () => setDeleteTarget(r),
      // Reveals, never publishes — see `SurfaceActions.openMyProfile`.
      showInProfile: () => axvPlatform()?.surface.openMyProfile(),
    };
  });

  const recordingMenu = (r: RecordingManifest): CtxItem[] => {
    const items: CtxItem[] = [
      { label: "Play", onClick: () => setPlayerId(r.id) },
      { label: "Export", onClick: () => exportRecording(r) },
    ];
    if (isMine(r)) items.push({ label: "Rename", onClick: () => setRenameTarget(r) });
    if (canDelete(r)) {
      items.push("---", {
        label: isMine(r) ? "Delete" : `Delete (${screennameOf(r.owner)}'s)`,
        danger: true,
        onClick: () => setDeleteTarget(r),
      });
    }
    return items;
  };

  /* --------------------------------- columns --------------------------------- */

  // The owner column only says something when the listing can hold more than
  // one owner — i.e. for an administrator.
  const columns: ColumnDef<RecordingManifest>[] = (
    [
    {
      key: "thumb",
      label: "",
      width: 64,
      render: (r) =>
        r.thumbnail ? (
          <Box
            component="img"
            src={thumbUrl(r.id)}
            alt=""
            sx={{ width: 52, height: 30, objectFit: "cover", borderRadius: 0.5, display: "block", bgcolor: "#000" }}
          />
        ) : (
          <Box sx={{ width: 52, height: 30, borderRadius: 0.5, display: "grid", placeItems: "center", bgcolor: "#000" }}>
            <GizmoXMark size={16} glow={false} />
          </Box>
        ),
    },
    {
      key: "title",
      label: "Title",
      width: 260,
      sortable: true,
      sortValue: (r) => r.title.toLowerCase(),
      render: (r) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {r.title}
          </Typography>
          {r.edits.length > 0 && <GxChip label={`edited ×${r.edits.length}`} kind="accent" />}
        </Box>
      ),
    },
    {
      key: "engine",
      label: "Engine",
      width: 90,
      sortable: true,
      sortValue: (r) => r.engine,
      render: (r) => <GxChip label={r.engine} kind={engineChipKind(r.engine)} />,
    },
    {
      key: "duration",
      label: "Duration",
      width: 90,
      align: "right",
      sortable: true,
      sortValue: (r) => r.durationS,
      render: (r) => (
        <Typography sx={{ fontFamily: GX.mono, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          {fmtClock(r.durationS * 1000)}
        </Typography>
      ),
    },
    {
      key: "size",
      label: "Size",
      width: 90,
      align: "right",
      sortable: true,
      sortValue: (r) => r.sizeBytes,
      render: (r) => (
        <Typography sx={{ fontFamily: GX.mono, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
          {fmtBytes(r.sizeBytes)}
        </Typography>
      ),
    },
    {
      key: "captured",
      label: "Captured",
      width: 150,
      sortable: true,
      sortValue: (r) => r.startedAt,
      render: (r) => (
        <Typography sx={{ fontFamily: GX.mono, fontSize: 11.5, color: GX.dim }}>{fmtDate(r.startedAt)}</Typography>
      ),
    },
    {
      key: "owner",
      label: "Owner",
      width: 130,
      sortable: true,
      sortValue: (r) => screennameOf(r.owner).toLowerCase(),
      render: (r) => (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {screennameOf(r.owner)}
          </Typography>
          {isMine(r) && <GxChip label="you" kind="accent" />}
        </Box>
      ),
    },
    {
      key: "detail",
      label: "Detail",
      width: 170,
      render: (r) => (
        <Typography sx={{ fontFamily: GX.mono, fontSize: 11, color: GX.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {r.width}×{r.height} · {r.quality}
          {r.micEnabled ? "" : " · no mic"}
          {r.notes ? " · notes" : ""}
        </Typography>
      ),
    },
    ] as ColumnDef<RecordingManifest>[]
  ).filter((c) => isAdmin || c.key !== "owner");

  /* ---------------------------------- render --------------------------------- */

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, flex: 1, minHeight: 0 }}>
      {/* header row: count, search, view toggle, refresh */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, flexWrap: "wrap" }}>
        <Typography sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: GX.dim }}>
          Recording library
          {state.kind === "ready" ? ` · ${shown.length}${needle ? ` of ${recordings.length}` : ""}` : ""}
        </Typography>
        <GxChip label={isAdmin ? "every member's" : "your recordings"} kind={isAdmin ? "warn" : "dim"} />
        <Box sx={{ flex: 1 }} />
        {isAdmin && (
          <Tooltip title="Administrator — delete every recording in the store">
            <span>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                disabled={recordings.length === 0 || purging}
                onClick={() => setPurgeOpen(true)}
                data-el-id="amberxvid:library:delete-all"
                sx={{ py: 0.25, fontSize: 11.5, flexShrink: 0 }}
              >
                Delete all
              </Button>
            </span>
          </Tooltip>
        )}
        <TextField
          size="small"
          placeholder={isAdmin ? "Find a recording — title, owner, engine" : "Find a recording — title, engine"}
          value={find}
          onChange={(e) => setFind(e.target.value)}
          sx={{ minWidth: 200, flex: "1 1 200px", maxWidth: 320 }}
          data-el-id="amberxvid:library:find"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 15, color: GX.dim }} />
                </InputAdornment>
              ),
            },
          }}
        />
        <Tooltip title="Grid view">
          <IconButton
            size="small"
            onClick={() => switchView("grid")}
            data-el-id="amberxvid:library:view-grid"
            sx={{ color: view === "grid" ? GX.accent : GX.dim }}
          >
            <GridIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="List view">
          <IconButton
            size="small"
            onClick={() => switchView("list")}
            data-el-id="amberxvid:library:view-list"
            sx={{ color: view === "list" ? GX.accent : GX.dim }}
          >
            <ListIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Refresh the library">
          <IconButton size="small" onClick={() => void load()} sx={{ color: GX.dim }}>
            <RefreshIcon sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* body */}
      {state.kind === "loading" ? (
        <Typography sx={{ fontSize: 12, color: GX.dim, p: 1 }}>Loading the library…</Typography>
      ) : state.kind === "error" ? (
        <Typography sx={{ fontSize: 12, color: GX.err, p: 1 }}>{state.message}</Typography>
      ) : shown.length === 0 ? (
        <BrandedEmpty filtered={needle.length > 0} />
      ) : view === "list" ? (
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <DataTable
            columns={columns}
            rows={shown}
            rowKey={(r) => r.id}
            storageKey="gx:amberxvid.library.cols"
            dense
            defaultSort={{ key: "captured", dir: "desc" }}
            emptyText="No recordings match"
            onRowDoubleClick={(r) => setPlayerId(r.id)}
            onRowContextMenu={(e, r) => openCtx(e, `Recording · ${r.title}`, recordingMenu(r))}
            // The declared area, on the grid view's rows — so both views of the
            // same recordings offer the same menu (P15).
            rowAttrs={(r) => ({
              "data-axf-area": "amberxvid.recording",
              "data-axf-recording": r.id,
              "data-axf-recording-owner": r.owner,
            })}
          />
        </Box>
      ) : (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(196px, 1fr))",
            gap: 1,
            alignContent: "start",
            pb: 0.5,
          }}
        >
          {shown.map((r) => (
            <Box
              key={r.id}
              onClick={() => setPlayerId(r.id)}
              onContextMenu={(e) => openCtx(e, `Recording · ${r.title}`, recordingMenu(r))}
              // The declared `amberxvid.recording` area (P15).
              data-axf-area="amberxvid.recording"
              data-axf-recording={r.id}
              data-axf-recording-owner={r.owner}
              data-el-id={`amberxvid:library:card:${r.id}`}
              sx={{
                cursor: "pointer",
                borderRadius: 1,
                border: `1px solid ${GX.edge}`,
                overflow: "hidden",
                bgcolor: GX.panel2,
                transition: intensity === "off" ? "none" : "border-color 150ms, transform 150ms",
                "&:hover": {
                  borderColor: gxa(GX.accent, "66"),
                  transform: intensity === "maximum" ? "translateY(-2px)" : undefined,
                },
              }}
            >
              <Box sx={{ position: "relative" }}>
                {r.thumbnail ? (
                  <Box
                    component="img"
                    src={thumbUrl(r.id)}
                    alt={r.title}
                    sx={{ width: "100%", height: 106, objectFit: "cover", display: "block", bgcolor: "#000" }}
                  />
                ) : (
                  <Box sx={{ width: "100%", height: 106, display: "grid", placeItems: "center", bgcolor: "#000" }}>
                    <GizmoXMark size={34} glow={false} />
                  </Box>
                )}
                <Typography
                  sx={{
                    position: "absolute",
                    bottom: 6,
                    right: 6,
                    px: 0.6,
                    py: 0.1,
                    borderRadius: 0.5,
                    bgcolor: "rgba(0,0,0,0.65)",
                    fontFamily: GX.mono,
                    fontSize: 10,
                    color: "#fff",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmtClock(r.durationS * 1000)}
                </Typography>
                <Box sx={{ position: "absolute", top: 6, left: 6, display: "flex", gap: 0.5 }}>
                  <GxChip label={r.engine} kind={engineChipKind(r.engine)} />
                  {r.edits.length > 0 && <GxChip label={`edited ×${r.edits.length}`} kind="accent" />}
                </Box>
              </Box>
              <Box sx={{ p: 0.85 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.title}
                </Typography>
                <Typography sx={{ fontFamily: GX.mono, fontSize: 10, color: GX.dim }}>
                  {fmtDate(r.startedAt)} · {fmtBytes(r.sizeBytes)}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.35, minWidth: 0 }}>
                  {isAdmin && (
                    <Typography sx={{ fontSize: 10.5, color: GX.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {screennameOf(r.owner)}
                    </Typography>
                  )}
                  {isAdmin && isMine(r) && <GxChip label="you" kind="accent" />}
                  <Box sx={{ flex: 1 }} />
                  {!r.micEnabled && (
                    <Typography sx={{ fontSize: 9.5, color: GX.dim }}>no mic</Typography>
                  )}
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* the player */}
      {playerRec && (
        <PlayerDialog
          rec={playerRec}
          mine={isMine(playerRec)}
          canDelete={canDelete(playerRec)}
          ownerName={screennameOf(playerRec.owner)}
          onClose={() => setPlayerId(null)}
          onExport={() => exportRecording(playerRec)}
          onRename={() => setRenameTarget(playerRec)}
          onDelete={() => setDeleteTarget(playerRec)}
          onManifest={patchLocal}
        />
      )}

      {/* rename */}
      {renameTarget && (
        <RenameDialog
          rec={renameTarget}
          onClose={() => setRenameTarget(null)}
          onRenamed={(m) => {
            patchLocal(m);
            setRenameTarget(null);
            toast(`Renamed to "${m.title}"`);
          }}
        />
      )}

      {/* delete confirm */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        {deleteTarget && (
          <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Delete this recording?</Typography>
            <Typography sx={{ fontSize: 12.5, color: GX.dim }}>
              &ldquo;{deleteTarget.title}&rdquo; — {fmtClock(deleteTarget.durationS * 1000)} ·{" "}
              {fmtBytes(deleteTarget.sizeBytes)} · captured {fmtDate(deleteTarget.startedAt)}. The media
              file, thumbnail and manifest are removed for good.
            </Typography>
            <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
              <Button size="small" variant="outlined" onClick={() => setDeleteTarget(null)}>
                Keep it
              </Button>
              <Button
                size="small"
                variant="contained"
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => void confirmDelete()}
                data-el-id="amberxvid:library:confirm-delete"
              >
                Delete
              </Button>
            </Box>
          </Box>
        )}
      </Dialog>

      {/* the administrator's whole-library sweep */}
      <Dialog open={purgeOpen} onClose={() => (purging ? undefined : setPurgeOpen(false))} maxWidth="xs" fullWidth>
        <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Delete every recording?</Typography>
          <Typography sx={{ fontSize: 12.5, color: GX.dim }}>
            All {recordings.length} recording(s) in the store —{" "}
            {fmtBytes(recordings.reduce((n, r) => n + r.sizeBytes, 0))} across{" "}
            {new Set(recordings.map((r) => r.owner.toLowerCase())).size} member(s) — media, thumbnails
            and manifests, gone for good. Captures still uploading are left alone. This cannot be
            undone.
          </Typography>
          <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
            <Button size="small" variant="outlined" disabled={purging} onClick={() => setPurgeOpen(false)}>
              Keep them
            </Button>
            <Button
              size="small"
              variant="contained"
              color="error"
              startIcon={<DeleteIcon />}
              disabled={purging}
              onClick={() => void purgeAll()}
              data-el-id="amberxvid:library:confirm-delete-all"
            >
              {purging ? "Deleting…" : `Delete all ${recordings.length}`}
            </Button>
          </Box>
        </Box>
      </Dialog>

      {ctxMenu}
    </Box>
  );
}

/* -------------------------------- empty state ---------------------------------- */

function BrandedEmpty({ filtered }: { filtered: boolean }) {
  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 180,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1.25,
        p: 3,
        textAlign: "center",
        border: `1px dashed ${GX.edge}`,
        borderRadius: 1.5,
      }}
    >
      <GizmoXMark size={56} glow={false} />
      <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>
        {filtered ? "No recording matches that search" : "The library is empty"}
      </Typography>
      <Typography sx={{ fontSize: 12, color: GX.dim, maxWidth: 420 }}>
        {filtered
          ? "Clear the search to see every recording again."
          : "Record from the webcam stage — or arm background mode and let the tray service capture with the browser closed. Every finished capture lands here, ready to replay."}
      </Typography>
    </Box>
  );
}

/* ---------------------------------- rename ------------------------------------- */

function RenameDialog({
  rec,
  onClose,
  onRenamed,
}: {
  rec: RecordingManifest;
  onClose: () => void;
  onRenamed: (m: RecordingManifest) => void;
}) {
  const toast = useToast();
  const [title, setTitle] = React.useState(rec.title);
  const [busy, setBusy] = React.useState(false);

  const save = async () => {
    setBusy(true);
    try {
      onRenamed(await libraryAction({ action: "rename", id: rec.id, title }));
    } catch (e) {
      toast(`Rename failed — ${e instanceof Error ? e.message : "store unreachable"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <Box sx={{ p: 2.5, display: "flex", flexDirection: "column", gap: 1.5 }}>
        <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Rename recording</Typography>
        <TextField
          autoFocus
          size="small"
          fullWidth
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && title.trim()) void save();
          }}
          data-el-id="amberxvid:library:rename-title"
        />
        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          <Button size="small" variant="outlined" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={busy || !title.trim() || title.trim() === rec.title}
            onClick={() => void save()}
          >
            Rename
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}

/* ---------------------------------- player ------------------------------------- */

function PlayerDialog({
  rec,
  mine,
  canDelete,
  ownerName,
  onClose,
  onExport,
  onRename,
  onDelete,
  onManifest,
}: {
  rec: RecordingManifest;
  mine: boolean;
  /** Owner or administrator — the only two who may remove this capture. */
  canDelete: boolean;
  ownerName: string;
  onClose: () => void;
  onExport: () => void;
  onRename: () => void;
  onDelete: () => void;
  onManifest: (m: RecordingManifest) => void;
}) {
  const toast = useToast();
  const intensity = useAnimationIntensity();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  // True while the seek-to-huge duration fix is in flight (webm quirk below).
  const durationFixRef = React.useRef(false);

  const [playing, setPlaying] = React.useState(false);
  const [currentS, setCurrentS] = React.useState(0);
  const [durationS, setDurationS] = React.useState(rec.durationS);
  const [speed, setSpeed] = React.useState(1);
  const [loop, setLoop] = React.useState(false);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [notes, setNotes] = React.useState(rec.notes);
  const [savingNotes, setSavingNotes] = React.useState(false);

  /* fresh recording in the dialog → fresh player + notes state */
  React.useEffect(() => {
    setPlaying(false);
    setCurrentS(0);
    setDurationS(rec.durationS);
    setNotes(rec.notes);
    durationFixRef.current = false;
  }, [rec.id, rec.durationS, rec.notes]);

  React.useEffect(() => {
    const el = videoRef.current;
    if (el) el.playbackRate = speed;
  }, [speed, rec.id]);

  React.useEffect(() => {
    const el = videoRef.current;
    if (el) el.loop = loop;
  }, [loop, rec.id]);

  /* fullscreen mirrors the real document state, not a hope */
  React.useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  /**
   * MediaRecorder webm reports `Infinity` duration (the known Chrome quirk) —
   * seeking to a huge time forces the browser to build the seek index and emit
   * a real `durationchange`; until then the manifest's duration is the truth.
   */
  const onLoadedMetadata = () => {
    const el = videoRef.current;
    if (!el) return;
    if (!Number.isFinite(el.duration) || el.duration === 0) {
      durationFixRef.current = true;
      el.currentTime = 1e7;
    } else {
      setDurationS(el.duration);
    }
  };
  const onDurationChange = () => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration) || el.duration === 0) return;
    setDurationS(el.duration);
    if (durationFixRef.current) {
      durationFixRef.current = false;
      el.currentTime = 0;
    }
  };

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  const seek = (value: number) => {
    const el = videoRef.current;
    if (!el || durationFixRef.current) return;
    el.currentTime = value;
    setCurrentS(value);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  };

  const saveNotes = async () => {
    setSavingNotes(true);
    try {
      onManifest(await libraryAction({ action: "notes", id: rec.id, notes }));
      toast("Notes saved");
    } catch (e) {
      toast(`Notes failed — ${e instanceof Error ? e.message : "store unreachable"}`);
    } finally {
      setSavingNotes(false);
    }
  };
  const notesDirty = notes !== rec.notes;

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
        {/* title row */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <GizmoXMark size={20} glow={false} ring="transparent" />
          <Typography sx={{ fontSize: 15, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {rec.title}
          </Typography>
          <GxChip label={rec.engine} kind={engineChipKind(rec.engine)} />
          {rec.edits.length > 0 && <GxChip label={`edited ×${rec.edits.length}`} kind="accent" />}
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontFamily: GX.mono, fontSize: 10.5, color: GX.dim }}>
            {rec.width}×{rec.height} · {rec.quality}
            {rec.micEnabled ? "" : " · no mic"} · {fmtBytes(rec.sizeBytes)} · {ownerName} ·{" "}
            {fmtDate(rec.startedAt)}
          </Typography>
        </Box>

        {/* stage — fullscreen target, so the controls ride along */}
        <Box
          ref={stageRef}
          sx={{
            position: "relative",
            borderRadius: 1,
            overflow: "hidden",
            bgcolor: "#000",
            display: "flex",
            flexDirection: "column",
            "&:fullscreen": { borderRadius: 0 },
          }}
        >
          <Box
            component="video"
            ref={videoRef}
            src={mediaUrl(rec.id)}
            autoPlay
            onClick={togglePlay}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={() => {
              if (!durationFixRef.current) setCurrentS(videoRef.current?.currentTime ?? 0);
            }}
            onLoadedMetadata={onLoadedMetadata}
            onDurationChange={onDurationChange}
            sx={{
              width: "100%",
              flex: 1,
              minHeight: 0,
              maxHeight: fullscreen ? "none" : "52vh",
              objectFit: "contain",
              display: "block",
              cursor: "pointer",
            }}
            data-el-id="amberxvid:library:player-video"
          />
          {!playing && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                pointerEvents: "none",
                opacity: 0.85,
                transition: intensity === "off" ? "none" : "opacity 200ms",
              }}
              aria-hidden
            >
              <Box sx={{ width: 64, height: 64, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "rgba(0,0,0,0.55)", border: `2px solid ${gxa(GX.accent, "88")}` }}>
                <PlayIcon sx={{ fontSize: 30, color: GX.accent }} />
              </Box>
            </Box>
          )}
          <Box sx={{ position: "absolute", top: 8, right: 10, opacity: 0.45, pointerEvents: "none" }} aria-hidden>
            <GizmoXMark size={18} glow={false} ring="transparent" />
          </Box>

          {/* control bar — inside the stage so fullscreen keeps it */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.25, py: 0.5, bgcolor: "rgba(10,10,10,0.92)", flexShrink: 0 }}>
            <IconButton size="small" onClick={togglePlay} data-el-id="amberxvid:library:player-play" sx={{ color: GX.ink }}>
              {playing ? <PauseIcon sx={{ fontSize: 19 }} /> : <PlayIcon sx={{ fontSize: 19 }} />}
            </IconButton>
            <Typography sx={{ fontFamily: GX.mono, fontSize: 11, color: GX.dim, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
              {fmtClock(currentS * 1000)} / {fmtClock(durationS * 1000)}
            </Typography>
            <Slider
              size="small"
              value={Math.min(currentS, durationS)}
              min={0}
              max={Math.max(durationS, 0.1)}
              step={0.1}
              onChange={(_, v) => seek(v as number)}
              sx={{ mx: 1, color: GX.accent }}
              data-el-id="amberxvid:library:player-scrub"
            />
            <TextField
              select
              size="small"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
              sx={{ width: 84, "& .MuiInputBase-input": { fontFamily: GX.mono, fontSize: 11.5, py: 0.4 } }}
              data-el-id="amberxvid:library:player-speed"
            >
              {SPEEDS.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}×
                </MenuItem>
              ))}
            </TextField>
            <Tooltip title={loop ? "Loop is on" : "Loop is off"}>
              <IconButton
                size="small"
                onClick={() => setLoop((l) => !l)}
                data-el-id="amberxvid:library:player-loop"
                sx={{ color: loop ? GX.accent : GX.dim }}
              >
                <LoopIcon sx={{ fontSize: 17 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
              <IconButton size="small" onClick={toggleFullscreen} data-el-id="amberxvid:library:player-fullscreen" sx={{ color: GX.dim }}>
                {fullscreen ? <FullscreenExitIcon sx={{ fontSize: 17 }} /> : <FullscreenIcon sx={{ fontSize: 17 }} />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* notes — per-recording, owner-saved, everyone reads */}
        <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={5}
            size="small"
            label={mine ? "Notes" : `Notes (only ${ownerName} can edit)`}
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 4000))}
            disabled={!mine}
            data-el-id="amberxvid:library:player-notes"
          />
          {mine && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<SaveIcon />}
              disabled={!notesDirty || savingNotes}
              onClick={() => void saveNotes()}
              sx={{ flexShrink: 0, mt: 0.25 }}
            >
              Save
            </Button>
          )}
        </Box>

        {/* actions */}
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Button size="small" variant="outlined" startIcon={<ExportIcon />} onClick={onExport} data-el-id="amberxvid:library:player-export">
            Export
          </Button>
          {mine && (
            <Button size="small" variant="outlined" startIcon={<RenameIcon />} onClick={onRename}>
              Rename
            </Button>
          )}
          {canDelete && (
            <Button size="small" variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={onDelete}>
              {mine ? "Delete" : `Delete (${ownerName}'s)`}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="outlined" onClick={onClose}>
            Close
          </Button>
        </Box>
      </Box>
    </Dialog>
  );
}

"use client";

/**
 * @file The AmberX Vid admin control window (P9) — the administrator's whole
 * management surface, opened ONLY by the admin-gated toolbar button and fully
 * separate from the sui (which carries no admin or account controls, ever).
 *
 * A real floating window on the FloatablePanes mechanics: drags from its
 * title bar, resizes from all eight edges/corners (same MIN sizes and
 * keep-visible clamps), minimizes to the shared right-edge `MinimizedDock`,
 * carries the framework `FloatStatusBar`, and remembers its box in
 * `localStorage` (`gx:amberxvid:adminwin`, read after mount — never during
 * render).
 *
 * Four sections over `/api/amberxvid/admin` (`AdminOverview`) + the existing
 * member routes acting as the admin (`resolveActor`):
 *   - **Accounts** — the CRUD: add with a temp password (first login forces
 *     the change), re-issue temp passwords, promote/demote, disable/enable,
 *     remove (with the data cascade). The store refuses self-demote/disable/
 *     remove so an admin can never lock the whole module out.
 *   - **Members** — profile management (status line, about-me, clear avatar)
 *     and album/photo management (rename, captions, covers, deletes).
 *   - **Messages** — data pruning only, counts and sizes, never message text:
 *     delete one conversation, prune older-than-N-days, wipe a member's.
 *   - **Recordings** — the whole library's storage, per member: delete one
 *     member's captures or every capture in the store. The administrator is
 *     the only role that sees another member's recordings at all (everyone
 *     else's library holds strictly their own), which makes this the one
 *     surface where the library can be cleaned out.
 *   - **Presence** — who is online right now (SSE-connection truth), last
 *     seen otherwise; polls every 5 s while the section is on screen.
 *
 * Every destructive action goes through one confirm dialog; every mutation
 * lands as a fresh overview from the same response. Context menus stay lean
 * per the build directive. Animations scale with the module intensity knob.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Close as CloseIcon } from "./kit/icons";
import { Minimize as MinimizeIcon } from "./kit/icons";
import { DragIndicator as DragIndicatorIcon } from "./kit/icons";
import { Security as AdminIcon } from "./kit/icons";
import { VpnKey as AccountsIcon } from "./kit/icons";
import { Person as MembersIcon } from "./kit/icons";
import { ForumRounded as MessagesIcon } from "./kit/icons";
import { Videocam as RecordingsIcon } from "./kit/icons";
import { Visibility as PresenceIcon } from "./kit/icons";
import { Refresh as RefreshIcon } from "./kit/icons";
import { Add as AddUserIcon } from "./kit/icons";
import { Delete as DeleteIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { useCtx, GxChip, type CtxItem } from "./kit/ax";
import { useToast } from "./kit/Toast";
import { GizmoXMark } from "./gizmox-kit";
import { FloatStatusBar, MinimizedDock } from "./kit/FloatChrome";
import { useAnimationIntensity } from "./Splash";
import AvatarView from "./Avatar";
import type {
  AccountMe,
  AdminAccountRow,
  AdminOverview,
  AdminRecordingStats,
  Album,
  Profile,
} from "./lib/types";
import { useMediaHealth } from "./lib/mediaHealth";

/* ------------------------------ window mechanics ------------------------------ */

/** Same floor + keep-visible clamps as FloatablePanes — the shared mechanics. */
const MIN_W = 640;
const MIN_H = 400;
const KEEP_VISIBLE = 96;
/**
 * Over the module's floating surfaces and the messenger drawer (MUI 1200), but
 * UNDER MUI's modal layer (1300) — a window above it swallows its own context
 * menus and dialogs: at 1320 the account-row menu rendered behind the window
 * and could not be clicked at all.
 */
const Z_WINDOW = 1250;
const STORAGE_KEY = "gx:amberxvid:adminwin";

interface WinBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const INITIAL_BOX: WinBox = { x: 110, y: 80, w: 940, h: 620 };

type Edge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const CURSORS: Record<Edge, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

/* ---------------------------------- helpers ----------------------------------- */

function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return new Date(iso).toLocaleString();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** `1:23:45` / `4:07` — capture time reads better than a raw second count. */
function fmtDur(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

type Section = "accounts" | "members" | "messages" | "recordings" | "presence";

interface ConfirmSpec {
  title: string;
  body: string;
  verb: string;
  run: () => Promise<void>;
}

interface ApiJson {
  ok?: boolean;
  error?: string;
  overview?: AdminOverview;
  [k: string]: unknown;
}

export interface AdminWindowProps {
  open: boolean;
  me: AccountMe;
  onClose: () => void;
  /** Account-shape changes (add/edit/remove) — the module refreshes its roster. */
  onAccountsChanged: () => void;
}

/* ----------------------------------- window ------------------------------------ */

/** P11 — the admin's media-plane status line: the media server's /health,
 *  polled while the window is up, saying the same thing the hub and call
 *  indicators say (plus the numbers an operator wants). Never a guess. */
function MediaServerStatusLine({ active }: { active: boolean }) {
  const health = useMediaHealth(active);
  const s = health?.stats ?? null;
  return (
    <Box
      data-el-id="amberxvid:admin:media-health"
      sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, pb: 0.5, flexShrink: 0, minWidth: 0 }}
    >
      {health === null ? (
        <GxChip label="media server · checking…" kind="dim" />
      ) : health.up ? (
        <GxChip label="media server · online" kind="ok" />
      ) : (
        <GxChip label="media server · OFFLINE" kind="err" />
      )}
      <Typography
        sx={{ fontFamily: GX.mono, fontSize: 10, color: GX.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {health === null
          ? "asking /health…"
          : health.up && s
            ? `${s.rooms ?? 0} room(s) · ${s.participants ?? 0} seat(s) · ${s.producers ?? 0} up / ${s.consumers ?? 0} down · ${s.recordings ?? 0} recording · pid ${s.pid ?? "?"} · up ${Math.floor((s.uptimeS ?? 0) / 60)}m`
            : (health.message ?? "the media server is unreachable")}
      </Typography>
    </Box>
  );
}

export default function AdminWindow({ open, me, onClose, onAccountsChanged }: AdminWindowProps) {
  const toast = useToast();
  const intensity = useAnimationIntensity();
  const { openCtx, ctxMenu } = useCtx();

  /* ------------------------------ box + minimize ------------------------------ */

  const [box, setBox] = React.useState<WinBox>(INITIAL_BOX);
  const [live, setLive] = React.useState<WinBox | null>(null);
  const [minimized, setMinimized] = React.useState(false);

  // The saved box is localStorage — read after mount, never during render.
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<WinBox>;
      if (
        typeof saved.x === "number" &&
        typeof saved.y === "number" &&
        typeof saved.w === "number" &&
        typeof saved.h === "number"
      ) {
        setBox({
          x: Math.max(KEEP_VISIBLE - saved.w, Math.min(saved.x, window.innerWidth - KEEP_VISIBLE)),
          y: Math.max(0, Math.min(saved.y, window.innerHeight - 48)),
          w: Math.max(MIN_W, saved.w),
          h: Math.max(MIN_H, saved.h),
        });
      }
    } catch {
      /* junk stays on the default box */
    }
  }, []);

  const boxRef = React.useRef(box);
  boxRef.current = box;

  const commitBox = React.useCallback((next: WinBox) => {
    setBox(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* persistence is best-effort */
    }
  }, []);

  // One gesture handler for both verbs — no edge = drag, edge = resize (the
  // FloatablePanes idiom, committed once on release).
  const gesture = (edge?: Edge) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!edge && (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX;
    const sy = e.clientY;
    const start = boxRef.current;

    const at = (ev: PointerEvent): WinBox => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!edge) {
        return {
          ...start,
          x: Math.min(Math.max(KEEP_VISIBLE - start.w, start.x + dx), window.innerWidth - KEEP_VISIBLE),
          y: Math.min(Math.max(0, start.y + dy), window.innerHeight - 32),
        };
      }
      let { x, y, w, h } = start;
      if (edge.includes("e")) w = Math.max(MIN_W, start.w + dx);
      if (edge.includes("s")) h = Math.max(MIN_H, start.h + dy);
      if (edge.includes("w")) {
        w = Math.max(MIN_W, start.w - dx);
        x = start.x + (start.w - w);
      }
      if (edge.includes("n")) {
        h = Math.max(MIN_H, start.h - dy);
        y = start.y + (start.h - h);
      }
      return { x, y, w, h };
    };

    const move = (ev: PointerEvent) => setLive(at(ev));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setLive(null);
      commitBox(at(ev));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  /* ---------------------------------- data ------------------------------------ */

  const [section, setSection] = React.useState<Section>("accounts");
  const [overview, setOverview] = React.useState<AdminOverview | null>(null);
  const [profiles, setProfiles] = React.useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState<ConfirmSpec | null>(null);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [ovRes, profRes] = await Promise.all([
        fetch("/api/amberxvid/admin"),
        fetch("/api/amberxvid/profiles"),
      ]);
      const ov = (await ovRes.json().catch(() => null)) as ApiJson | null;
      if (!ovRes.ok || !ov?.ok || !ov.overview) {
        setLoadError(ov?.error ?? `admin service answered ${ovRes.status}`);
        return;
      }
      setOverview(ov.overview);
      const prof = (await profRes.json().catch(() => null)) as { ok?: boolean; profiles?: Profile[] } | null;
      if (profRes.ok && prof?.ok && prof.profiles) {
        setProfiles(new Map(prof.profiles.map((p) => [p.username.toLowerCase(), p])));
      }
    } catch {
      setLoadError("the admin service did not answer");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Presence stays honest while it is on screen: poll every 5 s (≥ 200 ms
  // house rule), cleared the moment the section or window goes away.
  React.useEffect(() => {
    if (!open || minimized || section !== "presence") return;
    const t = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(t);
  }, [open, minimized, section, refresh]);

  /** POST one admin/member action; a fresh overview riding the response lands
   *  directly, saving the second round trip. */
  const post = React.useCallback(
    async (url: string, body: Record<string, unknown>): Promise<ApiJson | null> => {
      setBusy(true);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as ApiJson | null;
        if (!res.ok || !json?.ok) {
          toast(json?.error ?? `the service answered ${res.status}`);
          return null;
        }
        if (json.overview) setOverview(json.overview);
        return json;
      } catch {
        toast("the service did not answer");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const nameOf = React.useCallback(
    (u: string): string =>
      overview?.accounts.find((a) => a.username.toLowerCase() === u.toLowerCase())?.screenname ?? u,
    [overview],
  );

  /* ------------------------------ account actions ------------------------------ */

  const [newUser, setNewUser] = React.useState("");
  const [newTempPw, setNewTempPw] = React.useState("");
  const [newIsAdmin, setNewIsAdmin] = React.useState(false);
  const [resetFor, setResetFor] = React.useState<string | null>(null);
  const [resetPw, setResetPw] = React.useState("");

  const addUser = async () => {
    // P1: credentials are the studio's. Adding a person creates a STUDIO
    // account; the amberxvid grant is default-allow, so they are a member the
    // moment the account exists — no second step, and nothing for this pane
    // to remember to do.
    const json = await post("/api/accounts/users", {
      action: "add-user",
      username: newUser.trim(),
      tempPassword: newTempPw,
      role: newIsAdmin ? "administrator" : "member",
    });
    if (!json) return;
    toast(`Added ${newIsAdmin ? "administrator" : "member"} "${newUser.trim()}" — their first login forces a password change`);
    setNewUser("");
    setNewTempPw("");
    setNewIsAdmin(false);
    await refresh();
    onAccountsChanged();
  };

  const issueTempPassword = async () => {
    if (!resetFor) return;
    const json = await post("/api/accounts/users", {
      action: "reset-password",
      username: resetFor,
      tempPassword: resetPw,
    });
    if (!json) return;
    toast(`Temp password issued for "${resetFor}" — their next login forces the change`);
    setResetFor(null);
    setResetPw("");
    await refresh();
    onAccountsChanged();
  };

  const setRole = async (a: AdminAccountRow, role: "administrator" | "member") => {
    const json = await post("/api/accounts/users", { action: "update-user", username: a.username, role });
    if (!json) return;
    toast(`"${a.username}" is now ${role === "administrator" ? "an administrator" : "a member"}`);
    onAccountsChanged();
  };

  const setDisabled = (a: AdminAccountRow, disabled: boolean) => {
    if (!disabled) {
      void (async () => {
        const json = await post("/api/accounts/users", { action: "update-user", username: a.username, disabled });
        if (!json) return;
        toast(`"${a.username}" re-enabled`);
        onAccountsChanged();
      })();
      return;
    }
    setConfirm({
      title: `Disable ${a.username}?`,
      body: `Disables their STUDIO account: "${a.username}" keeps everything they own but cannot sign in anywhere — AmberX Vid included — until re-enabled.`,
      verb: "Disable",
      run: async () => {
        const json = await post("/api/accounts/users", { action: "update-user", username: a.username, disabled });
        if (!json) return;
        toast(`"${a.username}" disabled`);
        onAccountsChanged();
      },
    });
  };

  const removeAccount = (a: AdminAccountRow) => {
    setConfirm({
      title: `Remove ${a.username} from AmberX Vid?`,
      body: `Revokes their AmberX Vid membership and deletes their profile, photo albums, messenger settings and last-seen stamp. Their STUDIO ACCOUNT survives — they keep it and everything else it opens; an administrator can grant AmberX Vid back at any time. Conversations survive for the other participant (wipe them in Messages).`,
      verb: "Remove from AmberX Vid",
      run: async () => {
        const json = await post("/api/amberxvid/admin", { action: "remove-member", username: a.username });
        if (!json) return;
        const cascaded = Array.isArray(json.cascaded) ? (json.cascaded as string[]) : [];
        toast(
          cascaded.length > 0
            ? `Removed "${a.username}" from AmberX Vid, with their ${cascaded.join(", ")}`
            : `Removed "${a.username}" from AmberX Vid`,
        );
        if (selectedMember?.toLowerCase() === a.username.toLowerCase()) setSelectedMember(null);
        await refresh();
        onAccountsChanged();
      },
    });
  };

  const wipeMemberThreads = (a: AdminAccountRow) => {
    setConfirm({
      title: `Delete ${a.username}'s conversations?`,
      body: `Every DIRECT conversation "${a.username}" is part of is deleted for both participants — history and queued offline messages included. Groups they are in survive; they are removed from them, because the rest of the room's history is not theirs to take.`,
      verb: "Delete conversations",
      run: async () => {
        const json = await post("/api/amberxvid/admin", { action: "delete-user-threads", username: a.username });
        if (!json) return;
        toast(
          `Deleted ${Number(json.threadsDeleted ?? 0)} conversation(s), ${Number(json.messagesRemoved ?? 0)} message(s)` +
            (Number(json.threadsLeft ?? 0) > 0
              ? ` · removed them from ${Number(json.threadsLeft)} group(s), which survive`
              : ""),
        );
      },
    });
  };

  const accountMenu = (a: AdminAccountRow): CtxItem[] => {
    const self = a.username.toLowerCase() === me.username.toLowerCase();
    return [
      { label: "Issue temp password", onClick: () => setResetFor(a.username) },
      ...(!self
        ? ([
            a.role === "administrator"
              ? { label: "Demote to member", onClick: () => void setRole(a, "member") }
              : { label: "Promote to administrator", onClick: () => void setRole(a, "administrator") },
            a.disabled
              ? { label: "Re-enable account", onClick: () => setDisabled(a, false) }
              : { label: "Disable account", danger: true, onClick: () => setDisabled(a, true) },
            "---",
            { label: "Delete their conversations", danger: true, onClick: () => wipeMemberThreads(a) },
            { label: "Remove account", danger: true, onClick: () => removeAccount(a) },
          ] as CtxItem[])
        : []),
    ];
  };

  /* ------------------------------ member management ----------------------------- */

  const [selectedMember, setSelectedMember] = React.useState<string | null>(null);
  const [memberAlbums, setMemberAlbums] = React.useState<Album[]>([]);
  const [openAlbumId, setOpenAlbumId] = React.useState<string | null>(null);
  const [statusDraft, setStatusDraft] = React.useState("");
  const [aboutDraft, setAboutDraft] = React.useState("");
  const [captionEdit, setCaptionEdit] = React.useState<{ albumId: string; photoId: string; text: string } | null>(null);

  const selectedProfile = selectedMember ? (profiles.get(selectedMember.toLowerCase()) ?? null) : null;

  // Seed the profile drafts + fetch albums whenever the selection changes.
  React.useEffect(() => {
    setStatusDraft(selectedProfile?.statusLine ?? "");
    setAboutDraft(selectedProfile?.aboutMe ?? "");
  }, [selectedProfile]);

  const loadAlbums = React.useCallback(async (owner: string) => {
    try {
      const res = await fetch(`/api/amberxvid/albums?owner=${encodeURIComponent(owner)}`);
      const json = (await res.json().catch(() => null)) as { ok?: boolean; albums?: Album[] } | null;
      setMemberAlbums(res.ok && json?.ok && json.albums ? json.albums : []);
    } catch {
      setMemberAlbums([]);
    }
  }, []);

  React.useEffect(() => {
    setMemberAlbums([]);
    setOpenAlbumId(null);
    if (selectedMember) void loadAlbums(selectedMember);
  }, [selectedMember, loadAlbums]);

  const saveProfile = async () => {
    if (!selectedMember) return;
    const json = await post("/api/amberxvid/profiles", {
      owner: selectedMember,
      statusLine: statusDraft,
      aboutMe: aboutDraft,
    });
    if (!json) return;
    toast(`Saved ${nameOf(selectedMember)}'s profile`);
    await refresh();
  };

  const clearAvatar = () => {
    if (!selectedMember) return;
    const who = nameOf(selectedMember);
    setConfirm({
      title: `Clear ${who}'s avatar?`,
      body: "Their designed avatar is removed everywhere (profile, buddy list, chat) — they can design a new one any time.",
      verb: "Clear avatar",
      run: async () => {
        const json = await post("/api/amberxvid/profiles", { owner: selectedMember, avatar: null });
        if (!json) return;
        toast(`Cleared ${who}'s avatar`);
        await refresh();
      },
    });
  };

  const albumAction = async (body: Record<string, unknown>, done: string) => {
    if (!selectedMember) return;
    const json = await post("/api/amberxvid/albums", { owner: selectedMember, ...body });
    if (!json) return;
    toast(done);
    await loadAlbums(selectedMember);
    await refresh();
  };

  const deleteAlbum = (album: Album) => {
    setConfirm({
      title: `Delete album "${album.title}"?`,
      body: `All ${album.photos.length} photo(s) in ${nameOf(album.owner)}'s album are deleted with it. This cannot be undone.`,
      verb: "Delete album",
      run: () => albumAction({ action: "delete", albumId: album.id }, `Album "${album.title}" deleted`),
    });
  };

  const deletePhoto = (album: Album, photoId: string) => {
    setConfirm({
      title: "Delete this photo?",
      body: `The photo is removed from ${nameOf(album.owner)}'s album "${album.title}". This cannot be undone.`,
      verb: "Delete photo",
      run: () => albumAction({ action: "delete-photo", albumId: album.id, photoId }, "Photo deleted"),
    });
  };

  /* ------------------------------ message pruning ------------------------------- */

  const [pruneDays, setPruneDays] = React.useState("30");

  const pruneOld = () => {
    const days = Number.parseInt(pruneDays, 10);
    if (!Number.isFinite(days) || days < 0) {
      toast("Enter a number of days ≥ 0 (0 prunes everything)");
      return;
    }
    setConfirm({
      title: days === 0 ? "Prune ALL message data?" : `Prune messages older than ${days} day(s)?`,
      body:
        days === 0
          ? "Every message in the store is deleted for all members — history and offline queues included. The conversations themselves stay (emptied), because a group is a shared room and a retention sweep must not evict anybody from one."
          : `Messages sent more than ${days} day(s) ago are deleted from every conversation. The conversations themselves stay, emptied ones included.`,
      verb: "Prune",
      run: async () => {
        const json = await post("/api/amberxvid/admin", { action: "prune-messages", olderThanDays: days });
        if (!json) return;
        toast(
          `Pruned ${Number(json.messagesRemoved ?? 0)} message(s) across ${Number(json.threadsTouched ?? 0)} conversation(s)`,
        );
      },
    });
  };

  /* ------------------------------ recording actions ----------------------------- */

  /** One member's captures. Open (still uploading) captures are left alone. */
  const wipeMemberRecordings = (row: AdminRecordingStats) => {
    setConfirm({
      title: `Delete ${nameOf(row.owner)}'s recordings?`,
      body: `All ${row.recordings - row.open} finished capture(s) — ${fmtBytes(row.bytes)}, ${fmtDur(row.durationS)} of video — media, thumbnails and manifests removed for good.${row.open > 0 ? ` ${row.open} still uploading are left alone.` : ""} This cannot be undone.`,
      verb: "Delete recordings",
      run: async () => {
        const json = await post("/api/amberxvid/admin", { action: "delete-recordings", username: row.owner });
        if (!json) return;
        toast(`Deleted ${Number(json.deleted ?? 0)} recording(s) of ${nameOf(row.owner)}`);
      },
    });
  };

  /** The whole library, every member. The admin-only sweep. */
  const wipeAllRecordings = (rows: AdminRecordingStats[]) => {
    const total = rows.reduce((n, r) => n + r.recordings - r.open, 0);
    const bytes = rows.reduce((n, r) => n + r.bytes, 0);
    setConfirm({
      title: "Delete every recording?",
      body: `All ${total} finished capture(s) across ${rows.length} member(s) — ${fmtBytes(bytes)} — gone for good. Captures still uploading are left alone. This cannot be undone.`,
      verb: `Delete all ${total}`,
      run: async () => {
        const json = await post("/api/amberxvid/admin", { action: "delete-recordings" });
        if (!json) return;
        toast(`Deleted ${Number(json.deleted ?? 0)} recording(s) — the library is empty`);
      },
    });
  };

  const deleteOneThread = (id: string, label: string, messages: number) => {
    setConfirm({
      title: "Delete this conversation?",
      body: `${label} — ${messages} message(s), gone for everybody in it, queued offline messages included.`,
      verb: "Delete conversation",
      run: async () => {
        const json = await post("/api/amberxvid/admin", { action: "delete-thread", threadId: id });
        if (!json) return;
        toast(`Conversation deleted (${Number(json.messagesRemoved ?? 0)} message(s))`);
      },
    });
  };

  /* --------------------------------- rendering ---------------------------------- */

  if (!open) return null;

  const b = live ?? box;
  const dur = intensity === "off" ? 0 : intensity === "subtle" ? 120 : 200;

  const sectionButton = (id: Section, label: string, icon: React.ReactNode, count?: number) => (
    <Button
      key={id}
      size="small"
      variant={section === id ? "contained" : "outlined"}
      startIcon={icon}
      onClick={() => setSection(id)}
      data-el-id={`amberxvid:admin:section-${id}`}
      sx={{ py: 0.25, fontSize: 11.5, flexShrink: 0 }}
    >
      {label}
      {count !== undefined ? ` · ${count}` : ""}
    </Button>
  );

  const rowSx = {
    display: "flex",
    alignItems: "center",
    gap: 1,
    p: 0.75,
    borderRadius: 1,
    border: `1px solid ${GX.edge}`,
    bgcolor: GX.panel2,
    transition: dur ? `border-color ${dur}ms, background-color ${dur}ms` : "none",
    "&:hover": { borderColor: gxa(GX.accent, "44"), bgcolor: gxa(GX.accent, "0a") },
  } as const;

  const handle = (edge: Edge, sx: object) => (
    <Box
      key={edge}
      onPointerDown={gesture(edge)}
      sx={{ position: "absolute", cursor: CURSORS[edge], touchAction: "none", zIndex: 2, ...sx }}
    />
  );

  /* ----------------------------------- sections --------------------------------- */

  const accountsSection = overview && (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {/* add-user — the ONLY way an account is born */}
      <Box sx={{ ...rowSx, gap: 1, flexWrap: "wrap", "&:hover": {} }}>
        <AddUserIcon sx={{ fontSize: 16, color: GX.accent }} />
        <TextField
          size="small"
          placeholder="username (GizmoX account)"
          value={newUser}
          onChange={(e) => setNewUser(e.target.value)}
          data-el-id="amberxvid:admin:add-username"
          sx={{ width: 190 }}
        />
        <TextField
          size="small"
          placeholder="temp password"
          type="password"
          value={newTempPw}
          onChange={(e) => setNewTempPw(e.target.value)}
          data-el-id="amberxvid:admin:add-temppw"
          sx={{ width: 160 }}
        />
        <FormControlLabel
          control={<Checkbox size="small" checked={newIsAdmin} onChange={(e) => setNewIsAdmin(e.target.checked)} />}
          label={<Typography sx={{ fontSize: 11.5 }}>administrator</Typography>}
        />
        <Button
          size="small"
          variant="contained"
          disabled={busy || !newUser.trim() || newTempPw.length < 6}
          onClick={() => void addUser()}
          data-el-id="amberxvid:admin:add-user"
          sx={{ py: 0.25 }}
        >
          Add user
        </Button>
        <Typography sx={{ fontSize: 10.5, color: GX.dim }}>
          first login forces the password change, then a screenname
        </Typography>
      </Box>

      {overview.accounts.map((a) => {
        const self = a.username.toLowerCase() === me.username.toLowerCase();
        const profile = profiles.get(a.username.toLowerCase()) ?? null;
        return (
          <Box
            key={a.username}
            onContextMenu={(e) => openCtx(e, `Account · ${a.username}`, accountMenu(a))}
            data-el-id={`amberxvid:admin:account:${a.username}`}
            sx={rowSx}
          >
            <AvatarView spec={profile?.avatar ?? null} name={a.screenname ?? a.username} size={30} />
            <Box sx={{ minWidth: 0, width: 200 }}>
              <Typography noWrap sx={{ fontSize: 13, fontWeight: 700, lineHeight: 1.2 }}>
                {a.screenname ?? `${a.username} (no screenname yet)`}
              </Typography>
              <Typography noWrap sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono }}>
                {a.username} · by {a.createdBy}
              </Typography>
            </Box>
            <GxChip label={a.role} kind={a.role === "administrator" ? "warn" : "dim"} />
            {self && <GxChip label="you" kind="accent" />}
            {a.mustChangePassword && <GxChip label="temp password" kind="info" />}
            {a.disabled && <GxChip label="disabled" kind="err" />}
            <Box sx={{ flex: 1 }} />
            <Typography sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono, whiteSpace: "nowrap" }}>
              {a.lastLoginAt ? `login ${fmtAgo(a.lastLoginAt)}` : "never logged in"}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setResetFor(a.username)}
              data-el-id={`amberxvid:admin:reset:${a.username}`}
              sx={{ py: 0, fontSize: 10.5, flexShrink: 0 }}
            >
              Temp pw
            </Button>
            {!self && (
              <Tooltip title="Remove account (confirmed)">
                <IconButton
                  size="small"
                  onClick={() => removeAccount(a)}
                  data-el-id={`amberxvid:admin:remove:${a.username}`}
                  sx={{ p: 0.25, color: GX.err }}
                >
                  <DeleteIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        );
      })}
    </Box>
  );

  const entered = (overview?.accounts ?? []).filter((a) => a.screenname !== null && !a.mustChangePassword);
  const openAlbum = memberAlbums.find((al) => al.id === openAlbumId) ?? null;

  const membersSection = overview && (
    <Box sx={{ display: "flex", gap: 1.25, minHeight: 0, height: "100%" }}>
      {/* member picker */}
      <Box sx={{ width: 220, flexShrink: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 0.5 }}>
        {entered.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: GX.dim, p: 1 }}>
            No member has completed entry yet — profiles appear here once screennames exist.
          </Typography>
        ) : (
          entered.map((a) => {
            const profile = profiles.get(a.username.toLowerCase()) ?? null;
            const sel = selectedMember?.toLowerCase() === a.username.toLowerCase();
            return (
              <Box
                key={a.username}
                component="button"
                onClick={() => setSelectedMember(a.username)}
                data-el-id={`amberxvid:admin:member:${a.username}`}
                sx={{
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  p: 0.75,
                  borderRadius: 1,
                  border: `1px solid ${sel ? gxa(GX.accent, "66") : "transparent"}`,
                  bgcolor: sel ? gxa(GX.accent, "14") : "transparent",
                  "&:hover": { bgcolor: gxa(GX.accent, "0d") },
                }}
              >
                <AvatarView spec={profile?.avatar ?? null} name={a.screenname ?? a.username} size={28} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>
                    {a.screenname}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: 10, color: GX.dim }}>{a.username}</Typography>
                </Box>
              </Box>
            );
          })
        )}
      </Box>

      {/* profile + albums for the selection */}
      <Box sx={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
        {!selectedMember ? (
          <Box sx={{ display: "grid", placeItems: "center", flex: 1, p: 3 }}>
            <Box sx={{ textAlign: "center" }}>
              <GizmoXMark size={44} glow={false} />
              <Typography sx={{ fontSize: 12.5, color: GX.dim, mt: 1 }}>
                Pick a member — profile, avatar and albums are managed here.
              </Typography>
            </Box>
          </Box>
        ) : (
          <>
            <Box sx={{ ...rowSx, alignItems: "flex-start", flexDirection: "column", gap: 1, "&:hover": {} }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, alignSelf: "stretch" }}>
                <AvatarView spec={selectedProfile?.avatar ?? null} name={nameOf(selectedMember)} size={40} />
                <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{nameOf(selectedMember)}</Typography>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  disabled={busy || !selectedProfile?.avatar}
                  onClick={clearAvatar}
                  data-el-id="amberxvid:admin:clear-avatar"
                  sx={{ py: 0, fontSize: 10.5 }}
                >
                  Clear avatar
                </Button>
              </Box>
              <TextField
                size="small"
                fullWidth
                label="Status line"
                value={statusDraft}
                onChange={(e) => setStatusDraft(e.target.value)}
                data-el-id="amberxvid:admin:profile-status"
              />
              <TextField
                size="small"
                fullWidth
                multiline
                minRows={2}
                label="About me"
                value={aboutDraft}
                onChange={(e) => setAboutDraft(e.target.value)}
                data-el-id="amberxvid:admin:profile-about"
              />
              <Button
                size="small"
                variant="contained"
                disabled={busy}
                onClick={() => void saveProfile()}
                data-el-id="amberxvid:admin:profile-save"
                sx={{ py: 0.25, alignSelf: "flex-end" }}
              >
                Save profile
              </Button>
            </Box>

            <Typography sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.2, textTransform: "uppercase", color: GX.dim }}>
              Albums · {memberAlbums.length}
            </Typography>
            {memberAlbums.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: GX.dim }}>
                {nameOf(selectedMember)} has no photo albums.
              </Typography>
            ) : (
              memberAlbums.map((album) => (
                <Box key={album.id}>
                  <Box
                    onContextMenu={(e) =>
                      openCtx(e, `Album · ${album.title}`, [
                        { label: openAlbumId === album.id ? "Close photos" : "Open photos", onClick: () => setOpenAlbumId(openAlbumId === album.id ? null : album.id) },
                        "---",
                        { label: "Delete album", danger: true, onClick: () => deleteAlbum(album) },
                      ])
                    }
                    data-el-id={`amberxvid:admin:album:${album.id}`}
                    sx={rowSx}
                  >
                    <Box
                      component="button"
                      onClick={() => setOpenAlbumId(openAlbumId === album.id ? null : album.id)}
                      sx={{ all: "unset", cursor: "pointer", display: "flex", alignItems: "center", gap: 1, flex: 1, minWidth: 0 }}
                    >
                      <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>{album.title}</Typography>
                      <GxChip label={`${album.photos.length} photo(s)`} kind="dim" />
                    </Box>
                    <Tooltip title="Delete album (confirmed)">
                      <IconButton size="small" onClick={() => deleteAlbum(album)} sx={{ p: 0.25, color: GX.err }}>
                        <DeleteIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                  {openAlbumId === album.id && (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, p: 1 }}>
                      {album.photos.length === 0 ? (
                        <Typography sx={{ fontSize: 11.5, color: GX.dim }}>This album is empty.</Typography>
                      ) : (
                        album.photos.map((p) => (
                          <Box
                            key={p.id}
                            onContextMenu={(e) =>
                              openCtx(e, `Photo · ${p.caption || p.id}`, [
                                { label: "Edit caption", onClick: () => setCaptionEdit({ albumId: album.id, photoId: p.id, text: p.caption }) },
                                {
                                  label: album.coverPhotoId === p.id ? "● Album cover" : "Make album cover",
                                  onClick: () => void albumAction({ action: "cover", albumId: album.id, photoId: p.id }, "Cover set"),
                                },
                                "---",
                                { label: "Delete photo", danger: true, onClick: () => deletePhoto(album, p.id) },
                              ])
                            }
                            sx={{
                              position: "relative",
                              width: 92,
                              borderRadius: 1,
                              overflow: "hidden",
                              border: `1px solid ${album.coverPhotoId === p.id ? gxa(GX.accent, "88") : GX.edge}`,
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- store bytes, not a static import */}
                            <img
                              src={`/api/amberxvid/albums/photo?owner=${encodeURIComponent(album.owner)}&album=${album.id}&id=${p.id}`}
                              alt={p.caption || "album photo"}
                              style={{ width: "100%", height: 68, objectFit: "cover", display: "block" }}
                            />
                            <Typography noWrap sx={{ fontSize: 9.5, color: GX.dim, px: 0.5, py: 0.25 }}>
                              {p.caption || "—"}
                            </Typography>
                          </Box>
                        ))
                      )}
                    </Box>
                  )}
                </Box>
              ))
            )}
          </>
        )}
      </Box>
    </Box>
  );

  const messagesSection = overview && (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box sx={{ ...rowSx, gap: 1, "&:hover": {} }}>
        <Typography sx={{ fontSize: 11.5, color: GX.ink }}>Prune messages older than</Typography>
        <TextField
          size="small"
          value={pruneDays}
          onChange={(e) => setPruneDays(e.target.value.replace(/[^0-9]/g, ""))}
          data-el-id="amberxvid:admin:prune-days"
          sx={{ width: 70, "& input": { textAlign: "center", fontFamily: GX.mono } }}
        />
        <Typography sx={{ fontSize: 11.5, color: GX.ink }}>day(s)</Typography>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          disabled={busy}
          onClick={pruneOld}
          data-el-id="amberxvid:admin:prune"
          sx={{ py: 0.25 }}
        >
          Prune
        </Button>
        <Typography sx={{ fontSize: 10.5, color: GX.dim }}>0 prunes everything · the conversations themselves are never deleted by a prune</Typography>
      </Box>

      {overview.threads.length === 0 ? (
        <Typography sx={{ fontSize: 12, color: GX.dim, p: 1 }}>
          No conversations in the store. Message data appears here as members chat.
        </Typography>
      ) : (
        overview.threads.map((t) => {
          // A DM is named by the pair; a group by its own name, falling back to
          // its membership when it was never named (a group may be untitled).
          const label =
            t.kind === "group"
              ? (t.title ?? `Group · ${t.participants.map(nameOf).join(", ")}`)
              : t.participants.map(nameOf).join(" ↔ ");
          return (
            <Box
              key={t.id}
              onContextMenu={(e) =>
                openCtx(e, `Conversation · ${label}`, [
                  { label: "Delete conversation", danger: true, onClick: () => deleteOneThread(t.id, label, t.messages) },
                ])
              }
              data-el-id={`amberxvid:admin:thread:${t.id}`}
              sx={rowSx}
            >
              <MessagesIcon sx={{ fontSize: 15, color: GX.dim }} />
              <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600, width: 260 }}>{label}</Typography>
              {t.kind === "group" && <GxChip label={`${t.participants.length} members`} kind="info" />}
              <GxChip label={`${t.messages} msg`} kind="dim" />
              {t.queued > 0 && <GxChip label={`${t.queued} queued`} kind="info" />}
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono, whiteSpace: "nowrap" }}>
                {fmtBytes(t.sizeBytes)} · last {fmtAgo(t.lastAt)}
              </Typography>
              <Tooltip title="Delete conversation (confirmed)">
                <IconButton size="small" onClick={() => deleteOneThread(t.id, label, t.messages)} sx={{ p: 0.25, color: GX.err }}>
                  <DeleteIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            </Box>
          );
        })
      )}
    </Box>
  );

  const recordingsSection = overview && (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Box sx={{ ...rowSx, gap: 1, flexWrap: "wrap", "&:hover": {} }}>
        <Typography sx={{ fontSize: 11.5, color: GX.ink }}>
          {overview.recordings.reduce((n, r) => n + r.recordings, 0)} recording(s) ·{" "}
          {fmtBytes(overview.recordings.reduce((n, r) => n + r.bytes, 0))} ·{" "}
          {fmtDur(overview.recordings.reduce((n, r) => n + r.durationS, 0))} of video
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="outlined"
          color="error"
          startIcon={<DeleteIcon />}
          disabled={busy || overview.recordings.length === 0}
          onClick={() => wipeAllRecordings(overview.recordings)}
          data-el-id="amberxvid:admin:delete-all-recordings"
          sx={{ py: 0.25 }}
        >
          Delete every recording
        </Button>
      </Box>

      <Typography sx={{ fontSize: 10.5, color: GX.dim }}>
        Members see only their own captures — you see the whole store. Deleting removes the media
        file, thumbnail and manifest; captures still uploading are never touched.
      </Typography>

      {overview.recordings.length === 0 ? (
        <Typography sx={{ fontSize: 12, color: GX.dim, p: 1 }}>
          No recordings in the store. Captures appear here as members record.
        </Typography>
      ) : (
        overview.recordings.map((r) => (
          <Box
            key={r.owner}
            onContextMenu={(e) =>
              openCtx(e, `Recordings · ${nameOf(r.owner)}`, [
                {
                  label: "Delete this member's recordings",
                  danger: true,
                  onClick: () => wipeMemberRecordings(r),
                },
              ])
            }
            data-el-id={`amberxvid:admin:recordings:${r.owner}`}
            sx={rowSx}
          >
            <RecordingsIcon sx={{ fontSize: 15, color: GX.dim }} />
            <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600, width: 200 }}>
              {nameOf(r.owner)}
            </Typography>
            <GxChip label={`${r.recordings} capture${r.recordings === 1 ? "" : "s"}`} kind="dim" />
            {r.open > 0 && <GxChip label={`${r.open} uploading`} kind="info" />}
            <Box sx={{ flex: 1 }} />
            <Typography sx={{ fontSize: 10.5, color: GX.dim, fontFamily: GX.mono, whiteSpace: "nowrap" }}>
              {fmtBytes(r.bytes)} · {fmtDur(r.durationS)}
              {r.lastAt ? ` · last ${fmtAgo(r.lastAt)}` : ""}
            </Typography>
            <Tooltip title={`Delete ${nameOf(r.owner)}'s recordings (confirmed)`}>
              <span>
                <IconButton
                  size="small"
                  disabled={busy || r.recordings === r.open}
                  onClick={() => wipeMemberRecordings(r)}
                  sx={{ p: 0.25, color: GX.err }}
                >
                  <DeleteIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        ))
      )}
    </Box>
  );

  const presenceSection = overview && (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography sx={{ fontSize: 10.5, color: GX.dim }}>
        Online = at least one live presence stream open right now (refreshes every 5 s while this
        section is on screen). Sessions close themselves when the last stream drops.
      </Typography>
      {overview.presence.length === 0 ? (
        <Typography sx={{ fontSize: 12, color: GX.dim, p: 1 }}>No entered member yet — presence starts with the first screenname.</Typography>
      ) : (
        overview.presence.map((p) => {
          const profile = profiles.get(p.username.toLowerCase()) ?? null;
          return (
            <Box key={p.username} data-el-id={`amberxvid:admin:presence:${p.username}`} sx={rowSx}>
              <Box
                sx={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  flexShrink: 0,
                  bgcolor: p.online ? GX.ok : GX.dim,
                  ...(p.online &&
                    intensity !== "off" && {
                      "@keyframes gxvPresencePulse": {
                        "0%": { boxShadow: `0 0 0 0 ${gxa(GX.ok, "55")}` },
                        "100%": { boxShadow: "0 0 0 6px transparent" },
                      },
                      animation: `gxvPresencePulse ${intensity === "maximum" ? 1 : 1.8}s ease-out infinite`,
                    }),
                }}
              />
              <AvatarView spec={profile?.avatar ?? null} name={nameOf(p.username)} size={28} />
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>
                  {nameOf(p.username)}
                </Typography>
                <Typography noWrap sx={{ fontSize: 10, color: GX.dim, fontFamily: GX.mono }}>{p.username}</Typography>
              </Box>
              <Box sx={{ flex: 1 }} />
              <Typography sx={{ fontSize: 10.5, color: p.online ? GX.ok : GX.dim, fontFamily: GX.mono }}>
                {p.online ? "online" : `last seen ${fmtAgo(p.lastSeenAt)}`}
              </Typography>
            </Box>
          );
        })
      )}
    </Box>
  );

  /* ------------------------------------ frame ------------------------------------ */

  return (
    <>
      <Box
        data-el-id="amberxvid:admin:window"
        sx={{
          position: "fixed",
          left: b.x,
          top: b.y,
          width: b.w,
          height: b.h,
          zIndex: Z_WINDOW,
          display: "flex",
          flexDirection: "column",
          borderRadius: 1,
          overflow: "hidden",
          border: `1px solid ${gxa(GX.warn, "55")}`,
          bgcolor: GX.panel,
          boxShadow: "0 18px 44px rgba(0,0,0,0.55)",
          ...(dur && {
            "@keyframes gxvAdminIn": {
              from: { opacity: 0, transform: "scale(0.97)" },
              to: { opacity: 1, transform: "scale(1)" },
            },
            animation: `gxvAdminIn ${dur}ms ease-out`,
          }),
          // Minimized keeps the window (and every half-typed field) mounted —
          // off screen and out of reach, exactly like a minimized pane.
          ...(minimized && { visibility: "hidden", pointerEvents: "none" }),
        }}
      >
        {/* title bar — the drag handle */}
        <Box
          onPointerDown={gesture()}
          title="Admin control window — drag to move, any edge to resize, double-click to minimize"
          onDoubleClick={() => setMinimized(true)}
          sx={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            px: 1,
            py: 0.5,
            userSelect: "none",
            cursor: "move",
            touchAction: "none",
            borderBottom: `1px solid ${gxa(GX.warn, "33")}`,
            bgcolor: gxa(GX.warn, "12"),
          }}
        >
          <DragIndicatorIcon sx={{ fontSize: 13, color: GX.dim, flexShrink: 0 }} />
          <GizmoXMark size={18} glow={false} ring="transparent" />
          <AdminIcon sx={{ fontSize: 15, color: GX.warn }} />
          <Typography sx={{ fontFamily: GX.mono, fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
            Admin control window
          </Typography>
          <GxChip label={me.screenname ?? me.username} kind="warn" />
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Refresh everything">
            <IconButton size="small" onClick={() => void refresh()} data-el-id="amberxvid:admin:refresh" sx={{ p: 0.25 }}>
              <RefreshIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Minimize to the right-edge stack">
            <IconButton size="small" onClick={() => setMinimized(true)} data-el-id="amberxvid:admin:minimize" sx={{ p: 0.25 }}>
              <MinimizeIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Close the admin window">
            <IconButton size="small" onClick={onClose} data-el-id="amberxvid:admin:close" sx={{ p: 0.25 }}>
              <CloseIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        </Box>

        {/* section nav */}
        <Box sx={{ display: "flex", gap: 0.5, p: 1, pb: 0.5, flexShrink: 0, flexWrap: "wrap" }}>
          {sectionButton("accounts", "Accounts", <AccountsIcon sx={{ fontSize: 15 }} />, overview?.accounts.length)}
          {sectionButton("members", "Profiles & albums", <MembersIcon sx={{ fontSize: 15 }} />, entered.length)}
          {sectionButton("messages", "Messages", <MessagesIcon sx={{ fontSize: 15 }} />, overview?.threads.length)}
          {sectionButton(
            "recordings",
            "Recordings",
            <RecordingsIcon sx={{ fontSize: 15 }} />,
            overview ? overview.recordings.reduce((n, r) => n + r.recordings, 0) : undefined,
          )}
          {sectionButton(
            "presence",
            "Presence",
            <PresenceIcon sx={{ fontSize: 15 }} />,
            overview ? overview.presence.filter((p) => p.online).length : undefined,
          )}
        </Box>

        {/* P11 — media-plane status line */}
        <MediaServerStatusLine active={open && !minimized} />

        {/* body */}
        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 1, position: "relative" }}>
          {/* branded watermark, static — the shell owns the animated logo */}
          <Box sx={{ position: "absolute", right: 12, bottom: 8, opacity: 0.05, pointerEvents: "none" }} aria-hidden>
            <GizmoXMark size={180} glow={false} />
          </Box>
          {loading && !overview ? (
            <Box sx={{ display: "grid", placeItems: "center", height: "100%" }}>
              <CircularProgress size={20} />
            </Box>
          ) : loadError ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "center", p: 3 }}>
              <Typography sx={{ fontSize: 12.5, color: GX.err }}>{loadError}</Typography>
              <Button size="small" variant="outlined" onClick={() => void refresh()}>
                Try again
              </Button>
            </Box>
          ) : section === "accounts" ? (
            accountsSection
          ) : section === "members" ? (
            membersSection
          ) : section === "messages" ? (
            messagesSection
          ) : section === "recordings" ? (
            recordingsSection
          ) : (
            presenceSection
          )}
        </Box>

        <FloatStatusBar size={{ w: b.w, h: b.h }} note="administrator only — nothing here lives in the sui" />

        {handle("n", { top: 0, left: 8, right: 8, height: 5 })}
        {handle("s", { bottom: 0, left: 8, right: 8, height: 5 })}
        {handle("w", { left: 0, top: 8, bottom: 8, width: 5 })}
        {handle("e", { right: 0, top: 8, bottom: 8, width: 5 })}
        {handle("nw", { top: 0, left: 0, width: 12, height: 12 })}
        {handle("ne", { top: 0, right: 0, width: 12, height: 12 })}
        {handle("sw", { bottom: 0, left: 0, width: 12, height: 12 })}
        {handle("se", { bottom: 0, right: 0, width: 15, height: 15 })}
      </Box>

      {minimized && (
        <MinimizedDock
          items={[{ id: "amberxvid-admin", title: "Admin control window", detail: "AmberX Vid" }]}
          onRestore={() => setMinimized(false)}
          onClose={() => {
            setMinimized(false);
            onClose();
          }}
        />
      )}

      {/* temp-password dialog (add-user's sibling — reset keeps the same flow) */}
      <Dialog open={resetFor !== null} onClose={() => setResetFor(null)} maxWidth="xs" fullWidth>
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Issue temp password · {resetFor}</Typography>
          <Typography sx={{ fontSize: 11.5, color: GX.dim }}>
            Their current password stops working now; the next login forces a change before entry.
          </Typography>
          <TextField
            size="small"
            autoFocus
            type="password"
            placeholder="temp password (min 6 characters)"
            value={resetPw}
            onChange={(e) => setResetPw(e.target.value)}
            data-el-id="amberxvid:admin:reset-temppw"
          />
          <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
            <Button size="small" variant="outlined" onClick={() => setResetFor(null)}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              color="warning"
              disabled={busy || resetPw.length < 6}
              onClick={() => void issueTempPassword()}
              data-el-id="amberxvid:admin:reset-confirm"
            >
              Issue
            </Button>
          </Box>
        </Box>
      </Dialog>

      {/* photo caption dialog */}
      <Dialog open={captionEdit !== null} onClose={() => setCaptionEdit(null)} maxWidth="xs" fullWidth>
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700 }}>Edit caption</Typography>
          <TextField
            size="small"
            autoFocus
            placeholder="caption"
            value={captionEdit?.text ?? ""}
            onChange={(e) => setCaptionEdit((c) => (c ? { ...c, text: e.target.value } : c))}
            data-el-id="amberxvid:admin:caption-text"
          />
          <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
            <Button size="small" variant="outlined" onClick={() => setCaptionEdit(null)}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={busy}
              onClick={() => {
                if (!captionEdit) return;
                void albumAction(
                  { action: "caption", albumId: captionEdit.albumId, photoId: captionEdit.photoId, caption: captionEdit.text },
                  "Caption saved",
                );
                setCaptionEdit(null);
              }}
              data-el-id="amberxvid:admin:caption-save"
            >
              Save
            </Button>
          </Box>
        </Box>
      </Dialog>

      {/* ONE confirm gate for every destructive action */}
      <Dialog open={confirm !== null} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 1.25 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 700, color: GX.err }}>{confirm?.title}</Typography>
          <Typography sx={{ fontSize: 12, color: GX.ink }}>{confirm?.body}</Typography>
          <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
            <Button size="small" variant="outlined" onClick={() => setConfirm(null)} data-el-id="amberxvid:admin:confirm-cancel">
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              color="error"
              disabled={busy}
              onClick={() => {
                const spec = confirm;
                setConfirm(null);
                if (spec) void spec.run();
              }}
              data-el-id="amberxvid:admin:confirm-yes"
            >
              {confirm?.verb}
            </Button>
          </Box>
        </Box>
      </Dialog>

      {ctxMenu}
    </>
  );
}

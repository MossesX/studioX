"use client";

/**
 * @file AmberX Vid profiles & albums (P6) — the profile viewer/editor and the
 * cross-user photo-album browser, one stage view.
 *
 * Left of the split: every entered member, drawn with the ONE shared avatar
 * renderer (`AvatarView`) — the same spec that shows here shows in chat and
 * the admin window. Right: the selected member's profile. Your own is live to
 * edit (status line, about-me, the avatar designer); everyone else's is
 * view-only, with their albums fully browsable — the cross-user duty.
 *
 * **The album browser this file used to contain is GONE (P10).** It mounts
 * `./Albums` — the platform photo surface — instead: one album UI, three mount
 * points (here, the Photos stage and the profile page's shelf). P9's note said
 * this phase would decide which of the two copies survives, and the one with
 * the justified grid, the keyboard lightbox, per-album visibility and the
 * wall's social rail is the one that did. Everything the old browser could do,
 * it can, plus what the local copy would have had to grow separately.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { Palette as DesignIcon } from "./kit/icons";
import { Refresh as RefreshIcon } from "./kit/icons";
import { Save as SaveIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip, useCtx, type CtxItem } from "./kit/ax";
import SplitPane from "./kit/SplitPane";
import { useToast } from "./kit/Toast";
import { ABOUT_MAX, STATUS_MAX, type AvatarSpec, type Profile } from "./lib/types";
import { isPortrait } from "./lib/avatar";
import AvatarView from "./Avatar";
import AvatarDesigner from "./AvatarDesigner";
import Albums from "./Albums";
import type { SocialIdentity } from "./SocialRail";
import { useAnimationIntensity } from "./Splash";

/* --------------------------------- contracts ---------------------------------- */

export interface ProfilesProps {
  /** The loaded profile's username — edit rights follow ownership. */
  meUsername: string;
  /** An administrator may act for any member — the album surface's edit
   *  affordances follow the store's `resolveActor` gate, so it has to know. */
  isAdmin?: boolean;
  /** Non-null focuses that member's profile (member ctx-menu deep link). */
  focusUser: string | null;
  onFocusConsumed: () => void;
  /** Fired after any own-profile save — the shell's profile card refetches. */
  onProfileChanged: () => void;
  /** P14: THE user menu — member rows carry the same right-click as every
   *  other surface (Message, Join stream, Rate member…). */
  userMenu?: (user: string) => CtxItem[];
  /** P14: live stream a member hosts → the LIVE chip on their row. */
  streamOf?: (user: string) => { id: string; title: string } | null;
  onJoinStream?: (streamId: string) => void;
}

type ProfilesState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; profiles: Profile[] };

/** POST one profile mutation; returns the fresh profile or throws its error. */
async function profileAction(body: Record<string, unknown>): Promise<Profile> {
  const res = await fetch("/api/amberxvid/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok?: boolean; profile?: Profile; error?: string }
    | null;
  if (!res.ok || !json?.ok || !json.profile) {
    throw new Error(json?.error ?? `profiles answered ${res.status}`);
  }
  return json.profile;
}

/* ----------------------------------- surface ----------------------------------- */

export default function Profiles({ meUsername, isAdmin = false, focusUser, onFocusConsumed, onProfileChanged, userMenu, streamOf, onJoinStream }: ProfilesProps) {
  const toast = useToast();
  const intensity = useAnimationIntensity();
  const { openCtx, ctxMenu } = useCtx();
  const animate = intensity !== "off";

  const [state, setState] = React.useState<ProfilesState>({ kind: "loading" });
  const [selected, setSelected] = React.useState<string>(meUsername);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/amberxvid/profiles");
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; profiles?: Profile[]; error?: string }
        | null;
      if (!res.ok || !json?.ok || !json.profiles) {
        setState({ kind: "error", message: json?.error ?? `profiles answered ${res.status}` });
        return;
      }
      setState({ kind: "ready", profiles: json.profiles });
    } catch {
      setState({ kind: "error", message: "the profile service did not answer" });
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Consume a deep-focus (the members list's "View profile") once, on arrival.
  React.useEffect(() => {
    if (focusUser) {
      setSelected(focusUser);
      onFocusConsumed();
    }
  }, [focusUser, onFocusConsumed]);

  if (state.kind === "loading") {
    return (
      <Box sx={{ flex: 1, display: "grid", placeItems: "center", p: 4 }}>
        <CircularProgress size={22} />
      </Box>
    );
  }
  if (state.kind === "error") {
    return (
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1.5, p: 4 }}>
        <Typography sx={{ fontSize: 13, color: GX.err }}>{state.message}</Typography>
        <Button size="small" variant="outlined" onClick={() => void load()}>Try again</Button>
      </Box>
    );
  }

  const { profiles } = state;
  // Mine first, then the roster's screenname order (the API already sorts).
  const ordered = [
    ...profiles.filter((p) => p.username.toLowerCase() === meUsername.toLowerCase()),
    ...profiles.filter((p) => p.username.toLowerCase() !== meUsername.toLowerCase()),
  ];
  const current =
    profiles.find((p) => p.username.toLowerCase() === selected.toLowerCase()) ?? ordered[0] ?? null;

  /**
   * The faces and names the album surface's social rail draws, out of the
   * roster this stage already loaded. The shell's own `wallIdentity` is richer
   * (it rides the live presence stream); this one is the same shape from the
   * data this screen has, so the rail never fetches identity of its own.
   */
  const identity: SocialIdentity = {
    screennameFor: (u) =>
      profiles.find((p) => p.username.toLowerCase() === u.toLowerCase())?.screenname ?? u,
    avatarOf: (u) =>
      profiles.find((p) => p.username.toLowerCase() === u.toLowerCase())?.avatar ?? null,
    onOpenProfile: (u) => setSelected(u),
  };

  const memberRow = (p: Profile) => {
    const mine = p.username.toLowerCase() === meUsername.toLowerCase();
    const active = current?.username === p.username;
    const liveStream = streamOf?.(p.username) ?? null;
    // The shared everywhere-menu (P14) with a local "view here" row on top;
    // the fallback keeps the surface honest if the shell ever omits it.
    const menu: CtxItem[] = [
      { label: "View profile", onClick: () => setSelected(p.username) },
      ...(userMenu ? userMenu(p.username) : []),
    ];
    return (
      <Box
        key={p.username}
        onClick={() => setSelected(p.username)}
        onContextMenu={(e) => openCtx(e, `Member · ${p.screenname}`, menu)}
        // The declared `amberxvid.member` area (P15) — the rows are data on
        // `amberxvid.decl.ts` and the behaviour is the shell's published
        // factory, so this surface only says WHO the row is about.
        data-axf-area="amberxvid.member"
        data-axf-member={p.username}
        data-axf-member-name={p.screenname}
        data-el-id={`amberxvid:profiles:member:${p.username}`}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.25,
          p: 0.75,
          borderRadius: 1,
          cursor: "pointer",
          border: `1px solid ${active ? gxa(GX.accent, "55") : "transparent"}`,
          bgcolor: active ? gxa(GX.accent, "14") : "transparent",
          transition: animate ? "border-color 150ms, background-color 150ms" : "none",
          "&:hover": { bgcolor: gxa(GX.accent, "0d") },
        }}
      >
        <AvatarView spec={p.avatar} name={p.screenname} size={32} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {p.screenname}
          </Typography>
          <Typography sx={{ fontSize: 10.5, color: GX.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {p.statusLine || p.username}
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        {mine && <GxChip label="you" kind="accent" />}
      </Box>
    );
  };

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <SplitPane
        direction="row"
        initial={250}
        min={190}
        max={420}
        storageKey="gx:amberxvid.profiles.split"
        firstTitle="Members"
        secondTitle="Profile"
        first={
          <Box sx={{ height: "100%", display: "flex", flexDirection: "column", gap: 0.75, pr: 1, minWidth: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0 }}>
              <Typography sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: GX.dim }}>
                Members · {profiles.length}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <Tooltip title="Refresh profiles">
                <IconButton size="small" onClick={() => void load()} aria-label="refresh profiles">
                  <RefreshIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            </Box>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 0.5 }}>
              {ordered.length === 0 ? (
                <Typography sx={{ fontSize: 12, color: GX.dim, p: 1 }}>
                  No member has completed entry yet.
                </Typography>
              ) : (
                ordered.map(memberRow)
              )}
            </Box>
          </Box>
        }
        second={
          current ? (
            <ProfilePane
              key={current.username}
              profile={current}
              me={meUsername}
              isAdmin={isAdmin}
              identity={identity}
              mine={current.username.toLowerCase() === meUsername.toLowerCase()}
              onSaved={(next) => {
                setState((s) =>
                  s.kind === "ready"
                    ? { kind: "ready", profiles: s.profiles.map((p) => (p.username === next.username ? next : p)) }
                    : s,
                );
                onProfileChanged();
              }}
            />
          ) : (
            <Box sx={{ flex: 1, display: "grid", placeItems: "center", p: 4 }}>
              <Typography sx={{ fontSize: 12.5, color: GX.dim }}>Pick a member to view their profile.</Typography>
            </Box>
          )
        }
      />
      {ctxMenu}
    </Box>
  );
}

/* -------------------------------- profile pane --------------------------------- */

function ProfilePane({
  profile,
  me,
  isAdmin,
  identity,
  mine,
  onSaved,
}: {
  profile: Profile;
  me: string;
  isAdmin: boolean;
  identity: SocialIdentity;
  mine: boolean;
  onSaved: (next: Profile) => void;
}) {
  const toast = useToast();
  const intensity = useAnimationIntensity();
  const animate = intensity !== "off";

  const [statusDraft, setStatusDraft] = React.useState(profile.statusLine);
  const [aboutDraft, setAboutDraft] = React.useState(profile.aboutMe);
  const [saving, setSaving] = React.useState(false);
  const [designerOpen, setDesignerOpen] = React.useState(false);

  const dirty = mine && (statusDraft !== profile.statusLine || aboutDraft !== profile.aboutMe);

  const saveText = React.useCallback(async () => {
    setSaving(true);
    try {
      const next = await profileAction({ statusLine: statusDraft, aboutMe: aboutDraft });
      onSaved(next);
      toast("Profile saved");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Profile save failed");
    } finally {
      setSaving(false);
    }
  }, [statusDraft, aboutDraft, onSaved, toast]);

  const saveAvatar = React.useCallback(
    async (spec: AvatarSpec): Promise<boolean> => {
      try {
        const next = await profileAction({ avatar: spec });
        onSaved(next);
        toast("Avatar saved — it now follows you everywhere in the module");
        return true;
      } catch (err) {
        toast(err instanceof Error ? err.message : "Avatar save failed");
        return false;
      }
    },
    [onSaved, toast],
  );

  return (
    <Box sx={{ height: "100%", minWidth: 0, display: "flex", flexDirection: "column", gap: 1.5, pl: 1.5, overflowY: "auto" }}>
      {/* identity header */}
      <Box sx={{ display: "flex", gap: 1.75, alignItems: "flex-start", flexShrink: 0 }}>
        <Box
          sx={{
            borderRadius: 1.5,
            overflow: "hidden",
            border: `1px solid ${GX.edge}`,
            flexShrink: 0,
            transition: animate ? "box-shadow 250ms" : "none",
            "&:hover": animate ? { boxShadow: `0 0 18px ${gxa(GX.accent, "33")}` } : undefined,
          }}
        >
          <AvatarView spec={profile.avatar} name={profile.screenname} size={108} round={false} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 19, fontWeight: 700, lineHeight: 1.2 }}>{profile.screenname}</Typography>
          <Typography sx={{ fontSize: 11, color: GX.dim, mb: 0.75 }}>{profile.username}</Typography>
          {mine ? (
            <TextField
              fullWidth
              size="small"
              placeholder="Status line — what are you up to?"
              value={statusDraft}
              onChange={(e) => setStatusDraft(e.target.value.slice(0, STATUS_MAX))}
              data-el-id="amberxvid:profiles:status"
            />
          ) : (
            <Typography sx={{ fontSize: 13, color: profile.statusLine ? GX.ink : GX.dim, fontStyle: profile.statusLine ? "normal" : "italic" }}>
              {profile.statusLine || "No status set."}
            </Typography>
          )}
          {mine && (
            <Box sx={{ display: "flex", gap: 1, mt: 1, flexWrap: "wrap" }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DesignIcon />}
                onClick={() => setDesignerOpen(true)}
                data-el-id="amberxvid:profiles:design-avatar"
              >
                {profile.avatar ? "Edit avatar" : "Design avatar"}
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={() => void saveText()}
                disabled={!dirty || saving}
                data-el-id="amberxvid:profiles:save"
              >
                {saving ? "Saving…" : "Save profile"}
              </Button>
            </Box>
          )}
        </Box>
      </Box>

      {/* about me */}
      <Box sx={{ flexShrink: 0 }}>
        <Typography sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: GX.dim, mb: 0.5 }}>
          About
        </Typography>
        {mine ? (
          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={6}
            size="small"
            placeholder="Tell the other members about yourself…"
            value={aboutDraft}
            onChange={(e) => setAboutDraft(e.target.value.slice(0, ABOUT_MAX))}
            data-el-id="amberxvid:profiles:about"
          />
        ) : (
          <Typography sx={{ fontSize: 12.5, whiteSpace: "pre-wrap", color: profile.aboutMe ? GX.ink : GX.dim, fontStyle: profile.aboutMe ? "normal" : "italic" }}>
            {profile.aboutMe || `${profile.screenname} hasn't written an about-me yet.`}
          </Typography>
        )}
      </Box>

      {/* albums — THE photo surface (P10), mounted rather than re-implemented */}
      <Albums
        me={me}
        isAdmin={isAdmin}
        owner={profile.username}
        ownerName={profile.screenname}
        identity={identity}
      />

      <AvatarDesigner
        open={designerOpen}
        // The designer edits the 16-axis spec and nothing else, so an AI
        // portrait opens it at the defaults rather than being force-cast into
        // a spec it has none of the fields for. The stored portrait is
        // untouched until the user actually saves a spec over it.
        initial={isPortrait(profile.avatar) ? null : profile.avatar}
        onClose={() => setDesignerOpen(false)}
        onSave={saveAvatar}
      />
    </Box>
  );
}

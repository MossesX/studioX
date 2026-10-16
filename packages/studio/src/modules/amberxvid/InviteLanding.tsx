"use client";

/**
 * @file **The invitation landing** — the screen a stranger with a link sees,
 * and the only unauthenticated surface in AmberX Vid (P7 of
 * `axf-amberxvid-social`, 2026-08-15).
 *
 * ## What it is trying to be
 *
 * One motion. A person was told "come watch this" and handed a link; the
 * distance between opening it and being in the room should be a username, a
 * password and a button. So the card asks for exactly that, and the server
 * does the four things behind it in one request — accounts user, module grant
 * through the matrix, the buddy edge, and the room — because a newcomer who
 * has to sign up, then find the suite, then find the stream, has been given
 * homework instead of an invitation.
 *
 * The screenname field is on this card for the same reason. Without it a fresh
 * account lands in the suite's `screenname` step rather than in the room, and
 * "straight into the room" quietly stops being true for every new member — the
 * exact case the phase gate walks.
 *
 * ## What it deliberately does not do
 *
 * - **It does not explain a dead link.** Expired, spent, revoked, forged and
 *   "the inviter has blocked you" are one sentence, because telling the last
 *   one apart from the others hands a blocked person the confirmation the
 *   silence exists to withhold (`lib/inviteContract.ts` → `INVITE_DEAD`).
 * - **It does not decide anything.** Every verdict on this screen is the
 *   server's, rendered — the same posture `ModuleLogin` takes. There is no
 *   membership rule, no policy and no token handling in this file.
 * - **It does not route.** The server answers with `next`, and the browser
 *   goes there. A landing that composed its own destination would be a second
 *   copy of the module's internal routing, one release from disagreeing with
 *   the first.
 */

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { GX } from "./kit/gx";
import { GizmoXMark } from "./Splash";
import { INVITE_DEAD, rawToken, targetPhrase, type InvitePublic } from "./lib/inviteContract";

type Load =
  | { kind: "loading" }
  | { kind: "dead"; message: string }
  | { kind: "live"; invite: InvitePublic };

interface RedeemReply {
  ok?: boolean;
  error?: string;
  next?: string;
  notes?: string[];
}

export default function InviteLanding({ token }: { token: string }) {
  const [load, setLoad] = React.useState<Load>({ kind: "loading" });
  const [mode, setMode] = React.useState<"signup" | "signin">("signup");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [screenname, setScreenname] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<string[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/amberxvid/invite/${encodeURIComponent(rawToken(token))}`);
        const json = (await res.json().catch(() => null)) as
          | { ok?: boolean; error?: string; invite?: InvitePublic }
          | null;
        if (cancelled) return;
        if (res.ok && json?.ok && json.invite) setLoad({ kind: "live", invite: json.invite });
        else setLoad({ kind: "dead", message: json?.error ?? INVITE_DEAD });
      } catch {
        if (!cancelled) {
          // A network failure is NOT a dead invitation, and saying so would
          // send somebody away from a link that is perfectly good.
          setLoad({ kind: "dead", message: "the invitation could not be read — check your connection and reload" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const submit = async (): Promise<void> => {
    if (mode === "signup" && password !== confirm) {
      setError("the two passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/amberxvid/invite/${encodeURIComponent(rawToken(token))}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          username: username.trim(),
          password,
          ...(mode === "signup" && screenname.trim() ? { screenname: screenname.trim() } : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as RedeemReply | null;
      if (!res.ok || !json?.ok || !json.next) {
        setBusy(false);
        setError(json?.error ?? "that did not work");
        return;
      }
      // Deliberately a full navigation rather than a client route: the session
      // cookie has just been set on this response, and the module boots from
      // it. Staying `busy` is correct — the page is leaving.
      setNotes(json.notes ?? []);
      window.location.assign(json.next);
    } catch {
      setBusy(false);
      setError("the studio did not answer");
    }
  };

  const onEnter = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !busy) void submit();
  };

  const card = (children: React.ReactNode): React.ReactElement => (
    <Box
      sx={{
        flex: 1,
        minHeight: 480,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: GX.page,
        p: 3,
      }}
    >
      <Box
        sx={{
          width: "min(460px, 92vw)",
          bgcolor: GX.panel,
          border: `1px solid ${GX.edge}`,
          borderRadius: 2,
          p: 3.5,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {children}
      </Box>
    </Box>
  );

  if (load.kind === "loading") {
    return card(
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <CircularProgress size={18} />
        <Typography sx={{ fontSize: 12.5, color: GX.dim }}>Checking the invitation…</Typography>
      </Box>,
    );
  }

  if (load.kind === "dead") {
    return card(
      <>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <GizmoXMark size={30} glow={false} ring="transparent" />
          <Typography sx={{ fontFamily: GX.mono, fontSize: 13, fontWeight: 700, letterSpacing: "0.18em" }}>
            AMBERX VID
          </Typography>
        </Box>
        <Alert severity="info" variant="outlined" sx={{ fontSize: 12.5 }} data-el-id="amberxvid:invite:dead">
          {load.message}
        </Alert>
        <Typography sx={{ fontSize: 11, color: GX.dim }}>
          Ask whoever sent it for a fresh link, or{" "}
          <Link href="/amberxvid" underline="hover" sx={{ fontSize: 11 }}>
            sign in
          </Link>{" "}
          if you already have an account.
        </Typography>
      </>,
    );
  }

  const { invite } = load;
  return card(
    <>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        <GizmoXMark size={30} glow={false} ring="transparent" />
        <Box>
          <Typography sx={{ fontFamily: GX.mono, fontSize: 13, fontWeight: 700, letterSpacing: "0.18em" }}>
            AMBERX VID
          </Typography>
          <Typography sx={{ fontSize: 11, color: GX.dim }}>You have been invited</Typography>
        </Box>
      </Box>

      <Box data-el-id="amberxvid:invite:headline">
        <Typography sx={{ fontSize: 15, fontWeight: 600, color: GX.ink }}>
          {invite.inviter} invited you to {targetPhrase(invite.target)}
        </Typography>
        {invite.note && (
          <Typography sx={{ fontSize: 12.5, color: GX.dim, mt: 0.75, fontStyle: "italic" }}>
            “{invite.note}”
          </Typography>
        )}
      </Box>

      {invite.buddy && (
        <Chip
          size="small"
          variant="outlined"
          label={`${invite.inviter} will be added to your buddy list`}
          sx={{ alignSelf: "flex-start", fontSize: 11 }}
        />
      )}

      <Divider flexItem sx={{ borderColor: GX.edge }} />

      <Tabs
        value={mode}
        onChange={(_e, v: "signup" | "signin") => {
          setMode(v);
          setError(null);
        }}
        variant="fullWidth"
        sx={{ minHeight: 34, "& .MuiTab-root": { minHeight: 34, fontSize: 12, textTransform: "none" } }}
      >
        <Tab value="signup" label="Create an account" data-el-id="amberxvid:invite:tab-signup" />
        <Tab value="signin" label="I already have one" data-el-id="amberxvid:invite:tab-signin" />
      </Tabs>

      <TextField
        label="Username"
        size="small"
        autoFocus
        fullWidth
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        onKeyDown={onEnter}
        slotProps={{
          htmlInput: {
            "data-el-id": "amberxvid:invite:username",
            autoCapitalize: "none",
            autoCorrect: "off",
          },
        }}
        helperText={mode === "signup" ? "2–32 characters: letters, digits, . _ -" : undefined}
      />
      <TextField
        type="password"
        label="Password"
        size="small"
        fullWidth
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={onEnter}
        slotProps={{ htmlInput: { "data-el-id": "amberxvid:invite:password" } }}
        helperText={mode === "signup" ? "At least 6 characters — your own, chosen now." : undefined}
      />
      {mode === "signup" && (
        <>
          <TextField
            type="password"
            label="Password again"
            size="small"
            fullWidth
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={onEnter}
            slotProps={{ htmlInput: { "data-el-id": "amberxvid:invite:confirm" } }}
          />
          <TextField
            label="Screenname"
            size="small"
            fullWidth
            value={screenname}
            onChange={(e) => setScreenname(e.target.value)}
            onKeyDown={onEnter}
            slotProps={{ htmlInput: { "data-el-id": "amberxvid:invite:screenname" } }}
            helperText="What other members see. Pick it now and you go straight in."
          />
        </>
      )}

      <Button
        variant="contained"
        onClick={() => void submit()}
        disabled={busy || username.trim().length < 2 || !password || (mode === "signup" && !confirm)}
        data-el-id="amberxvid:invite:submit"
      >
        {busy ? <CircularProgress size={18} /> : mode === "signup" ? "Join and go in" : "Sign in and go in"}
      </Button>

      {notes.length > 0 && (
        <Alert severity="success" variant="outlined" sx={{ fontSize: 11.5 }}>
          {notes.join(" ")}
        </Alert>
      )}
      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }} data-el-id="amberxvid:invite:error">
          {error}
        </Alert>
      )}

      <Typography sx={{ fontSize: 10.5, color: GX.dim }}>
        One account opens the whole studio. This link works once and expires on its own.
      </Typography>
    </>,
  );
}

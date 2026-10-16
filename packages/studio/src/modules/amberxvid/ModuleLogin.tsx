"use client";

/**
 * @file **The AmberX Vid front door** — the suite's face on the STUDIO's
 * sign-in, since P1 of `axf-amberxvid-social` (2026-08-14).
 *
 * The card looks the same. What is behind it does not: every credential POST
 * goes to `/api/accounts/session`, the studio's one authentication door. There
 * is no `axv_session`, no module password and no second account — a person
 * signs in once and AmberX Vid is one of the things that session opens.
 *
 * ## Five steps, and the two that are new
 *
 * `signin` · `signup` · `join` · `change` · `screenname`
 *
 * - **`signup`** exists because the suite is a public-facing product and its
 *   old front door could only say "ask an administrator". A studio account is
 *   created through `/api/accounts/users`; the amberxvid grant is default-allow
 *   in the permission matrix, so a fresh account is a member with nothing else
 *   to do. It is offered only when open membership is on.
 * - **`join`** is the state a single cookie could never express: signed in,
 *   real person, *not a member*. One button, one POST to the permission
 *   MATRIX (`request-module`), and the grant lands in `permissions.json` where
 *   the admin suite can see and revoke it like any other. A non-member with
 *   open membership off is told to ask, by name, rather than shown a door that
 *   refuses.
 *
 * Every credential path here is a face, not an implementation: this file holds
 * no hashing, no token, no member list and no policy of its own. It posts to
 * `/api/accounts/session`, `/api/accounts/users` and `/api/accounts/permissions`
 * and renders whatever they say — which is what makes "one identity" true
 * rather than merely claimed.
 *
 * ## The migration notice, and why it is not per-username
 *
 * Passwords did not migrate off the retired module store — the two scrypt
 * ladders differ, and silently weakening auth is worse than saying so. A
 * migrated member therefore has no studio password until an administrator
 * issues one, and their old one simply fails.
 *
 * The notice that explains this is **standing and unconditional**, shown
 * whenever any account is in that state (`pendingResets > 0`). It is
 * deliberately NOT keyed to the typed username: an "this account needs a
 * password reset" response would tell an attacker which names exist, which is
 * a worse bargain than a slightly less targeted message.
 */

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Link from "@mui/material/Link";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { GX } from "./kit/gx";
// PORT NOTE: `GizmoXMark` comes from the shim in `./Splash` (GizmoX's logo kit
// did not port; the branding pack's `mark` glyph stands in).
import { GizmoXMark, useAnimationIntensity } from "./Splash";
import type { AccountMe } from "./lib/types";

type Step = "signin" | "signup" | "join" | "disabled" | "change" | "screenname";

interface Props {
  /** The member record the server reports for this session, or null. */
  me: AccountMe | null;
  /** True when a valid `axs_session` already rides this browser. */
  signedIn: boolean;
  /** Signed in, but without the `amberxvid` grant — the `join` state. */
  notMember?: boolean;
  /** True when a non-member may join themselves (open membership). */
  canJoin?: boolean;
  /** How many accounts await an administrator-issued password. Drives the
   *  migration notice; a count, never a list. */
  pendingResets?: number;
  /** Called with the fresh `me` after every successful server step. */
  onMe: (me: AccountMe) => void;
  /** The flow is complete — enter the suite. */
  onEntered: () => void;
  /** Re-fetch the module snapshot (membership changed under us). */
  onRefresh: () => void;
}

interface SessionReply {
  ok: boolean;
  error?: string;
  me?: AccountMe;
  signedIn?: boolean;
}

/** The studio's authentication door. Every credential step posts here. */
async function postSession(body: Record<string, string>): Promise<SessionReply> {
  try {
    const res = await fetch("/api/accounts/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as SessionReply;
  } catch {
    return { ok: false, error: "the accounts service did not answer" };
  }
}

export default function ModuleLogin({
  me,
  signedIn,
  notMember,
  canJoin,
  pendingResets,
  onMe,
  onEntered,
  onRefresh,
}: Props) {
  const intensity = useAnimationIntensity();
  // The session cookie lands on the `login` response, but the snapshot the
  // parent holds was fetched before it — so a fresh sign-in is remembered here
  // rather than costing a round trip just to learn what we already know.
  const [justSignedIn, setJustSignedIn] = React.useState(false);
  const live = signedIn || justSignedIn;
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [wantSignup, setWantSignup] = React.useState(false);

  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [screenname, setScreenname] = React.useState("");

  // Signed out is a real state rather than an error: the suite is a public
  // door, and the sign-in card is what an anonymous visitor sees.
  const step: Step = notMember
    ? "join"
    : !live || !me
      ? wantSignup
        ? "signup"
        : "signin"
      : me.disabled
        ? "disabled"
        : me.mustChangePassword
          ? "change"
          : !me.screenname
            ? "screenname"
            : "signin"; // complete — the effect below exits before this renders

  const complete = Boolean(
    live && me && !notMember && !me.disabled && !me.mustChangePassword && me.screenname,
  );
  React.useEffect(() => {
    if (complete) onEntered();
  }, [complete, onEntered]);
  if (complete) return null; // the parent swaps to the suite on the effect

  const run = async (body: Record<string, string>, after?: (meNext: AccountMe) => void) => {
    setBusy(true);
    setError(null);
    const res = await postSession(body);
    setBusy(false);
    if (!res.ok || !res.me) {
      setError(res.error ?? "something went wrong");
      return;
    }
    onMe(res.me);
    after?.(res.me);
  };

  const signIn = () =>
    run({ action: "login", username: username.trim(), password }, () => setJustSignedIn(true));

  /**
   * Sign up: create the studio account, then sign straight into it.
   *
   * Two calls rather than one because `/api/accounts/users` mints the account
   * and `/api/accounts/session` mints the session — and folding them into a
   * single "register" endpoint would put account creation on an unauthenticated
   * door, which is a decision the accounts module gets to make, not this one.
   */
  const signUp = async () => {
    if (newPassword !== confirm) {
      setError("the two passwords do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add-user",
          username: username.trim(),
          tempPassword: newPassword,
          role: "member",
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setBusy(false);
        setError(json.error ?? "could not create that account");
        return;
      }
    } catch {
      setBusy(false);
      setError("the accounts service did not answer");
      return;
    }
    setBusy(false);
    // A fresh account carries `mustChangePassword`, so signing in lands on the
    // `change` step — the same forced flow an admin-issued account gets. That
    // is deliberate: it is one code path, and it is already proven.
    setPassword(newPassword);
    await run({ action: "login", username: username.trim(), password: newPassword }, () =>
      setJustSignedIn(true),
    );
  };

  /**
   * Self-serve membership — the module's policy gate, the MATRIX's grant.
   *
   * The button is offered by amberxvid's own policy (`canJoin`, i.e. open
   * membership), but the write is `request-module` on
   * `/api/accounts/permissions` — the accounts matrix's one non-admin mutation.
   * That is the whole point: a self-serve join lands in `permissions.json` as
   * an ordinary module grant on the caller's own row, so the admin suite lists
   * it beside administrator-issued ones and revokes it the same way. A
   * module-local "members" list would have been invisible there, and an
   * administrator who had explicitly revoked amberxvid would have been silently
   * overruled — `requestModuleGrant` refuses that case with a 403, which
   * arrives here as the server's own text rather than a guess made in the UI.
   */
  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request-module", moduleId: "amberxvid" }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      setBusy(false);
      if (!res.ok || !json.ok) {
        setError(json.error ?? "could not join");
        return;
      }
      onRefresh();
    } catch {
      setBusy(false);
      setError("the accounts service did not answer");
    }
  };

  const change = () => {
    if (newPassword !== confirm) {
      setError("the two new passwords do not match");
      return;
    }
    void run({ action: "change-password", currentPassword: password, newPassword });
  };
  const pickName = () => run({ action: "set-screenname", screenname });

  const onEnter =
    (fn: () => void) =>
    (e: React.KeyboardEvent): void => {
      if (e.key === "Enter" && !busy) fn();
    };

  const animMs = intensity === "off" ? 0 : intensity === "subtle" ? 160 : 280;
  const showMigrationNotice = step === "signin" && (pendingResets ?? 0) > 0;

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: GX.page,
        p: 3,
      }}
    >
      <Box
        key={step}
        sx={{
          width: "min(420px, 92vw)",
          bgcolor: GX.panel,
          border: `1px solid ${GX.edge}`,
          borderRadius: 2,
          p: 3.5,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          "@keyframes axvStepIn": {
            from: { opacity: 0, transform: "translateY(10px)" },
            to: { opacity: 1, transform: "translateY(0)" },
          },
          ...(animMs > 0 ? { animation: `axvStepIn ${animMs}ms ease-out` } : {}),
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <GizmoXMark size={30} glow={false} ring="transparent" />
          <Box>
            <Typography sx={{ fontFamily: GX.mono, fontSize: 13, fontWeight: 700, letterSpacing: "0.18em" }}>
              AMBERX VID
            </Typography>
            <Typography sx={{ fontSize: 11, color: GX.dim }}>
              {step === "signin"
                ? "Sign in"
                : step === "signup"
                  ? "Create an account"
                  : step === "join"
                    ? "Join AmberX Vid"
                    : (me?.screenname ?? me?.username ?? "Sign in")}
            </Typography>
          </Box>
        </Box>

        {step === "signin" && (
          <>
            <Typography sx={{ fontSize: 12.5, color: GX.dim }}>
              Sign in with your studio account. AmberX Vid shares one sign-in with the rest of the
              studio — there is no separate AmberX Vid password any more.
            </Typography>
            <TextField
              label="Username"
              size="small"
              autoFocus
              fullWidth
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={onEnter(signIn)}
              slotProps={{ htmlInput: { "data-el-id": "amberxvid:login:username", autoCapitalize: "none", autoCorrect: "off" } }}
            />
            <TextField
              type="password"
              label="Password"
              size="small"
              fullWidth
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={onEnter(signIn)}
              slotProps={{ htmlInput: { "data-el-id": "amberxvid:login:password" } }}
            />
            <Button
              variant="contained"
              onClick={signIn}
              disabled={busy || !username.trim() || !password}
              data-el-id="amberxvid:login:submit"
            >
              {busy ? <CircularProgress size={18} /> : "Sign in"}
            </Button>

            {showMigrationNotice && (
              <Alert severity="info" variant="outlined" sx={{ fontSize: 11.5 }}>
                <strong>Moved from an older AmberX Vid account?</strong> Your membership came across,
                but your password did not — the two systems hash differently, and we would rather say
                so than quietly weaken it. Ask an administrator for a temp password; you will choose
                your own on the next sign-in.
              </Alert>
            )}

            <Typography sx={{ fontSize: 11, color: GX.dim }}>
              No account?{" "}
              <Link
                component="button"
                type="button"
                underline="hover"
                onClick={() => {
                  setWantSignup(true);
                  setError(null);
                }}
                data-el-id="amberxvid:login:go-signup"
                sx={{ fontSize: 11 }}
              >
                Create one
              </Link>
              , or ask an administrator to make you one.
            </Typography>
          </>
        )}

        {step === "signup" && (
          <>
            <Typography sx={{ fontSize: 12.5, color: GX.dim }}>
              One account for the whole studio — AmberX Vid is one of the things it opens.
            </Typography>
            <TextField
              label="Username"
              size="small"
              autoFocus
              fullWidth
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              slotProps={{ htmlInput: { "data-el-id": "amberxvid:signup:username", autoCapitalize: "none", autoCorrect: "off" } }}
              helperText="2–32 characters: letters, digits, . _ -"
            />
            <TextField
              type="password"
              label="Password"
              size="small"
              fullWidth
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              slotProps={{ htmlInput: { "data-el-id": "amberxvid:signup:password" } }}
              helperText="At least 6 characters."
            />
            <TextField
              type="password"
              label="Password again"
              size="small"
              fullWidth
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={onEnter(() => void signUp())}
              slotProps={{ htmlInput: { "data-el-id": "amberxvid:signup:confirm" } }}
            />
            <Button
              variant="contained"
              onClick={() => void signUp()}
              disabled={busy || username.trim().length < 2 || !newPassword || !confirm}
              data-el-id="amberxvid:signup:submit"
            >
              {busy ? <CircularProgress size={18} /> : "Create account"}
            </Button>
            <Typography sx={{ fontSize: 11, color: GX.dim }}>
              Already have one?{" "}
              <Link
                component="button"
                type="button"
                underline="hover"
                onClick={() => {
                  setWantSignup(false);
                  setError(null);
                }}
                sx={{ fontSize: 11 }}
              >
                Sign in
              </Link>
            </Typography>
          </>
        )}

        {step === "join" && (
          <>
            {canJoin ? (
              <>
                <Typography sx={{ fontSize: 12.5, color: GX.dim }}>
                  You are signed in to the studio, but you are not an AmberX Vid member yet. Joining
                  takes one click and an administrator can see it — and undo it — like any other
                  permission.
                </Typography>
                <Button
                  variant="contained"
                  onClick={() => void join()}
                  disabled={busy}
                  data-el-id="amberxvid:join:submit"
                >
                  {busy ? <CircularProgress size={18} /> : "Join AmberX Vid"}
                </Button>
              </>
            ) : (
              <Alert severity="info" variant="outlined" sx={{ fontSize: 12 }}>
                You are signed in, but this account is not an AmberX Vid member and membership is by
                invitation. Ask an administrator to grant you the module.
              </Alert>
            )}
          </>
        )}

        {step === "disabled" && (
          <Alert severity="warning" variant="outlined" sx={{ fontSize: 12 }}>
            This account is disabled. Ask the administrator to re-enable it.
          </Alert>
        )}

        {step === "change" && (
          <>
            <Alert severity="info" variant="outlined" sx={{ fontSize: 12 }}>
              A temp password is in force — choose your own before entering.
            </Alert>
            <TextField
              type="password"
              label="Temp password"
              size="small"
              fullWidth
              slotProps={{ htmlInput: { "data-el-id": "amberxvid:login:temp-password" } }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <TextField
              type="password"
              label="New password"
              size="small"
              autoFocus
              fullWidth
              slotProps={{ htmlInput: { "data-el-id": "amberxvid:login:new-password" } }}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              helperText="At least 6 characters."
            />
            <TextField
              type="password"
              label="New password again"
              size="small"
              fullWidth
              slotProps={{ htmlInput: { "data-el-id": "amberxvid:login:confirm-password" } }}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={onEnter(change)}
            />
            <Button variant="contained" onClick={change} disabled={busy || !password || !newPassword || !confirm}>
              {busy ? <CircularProgress size={18} /> : "Change password"}
            </Button>
          </>
        )}

        {step === "screenname" && (
          <>
            <Typography sx={{ fontSize: 12.5, color: GX.dim }}>
              Pick the screenname other AmberX Vid users will see — buddy list, chats and your profile.
            </Typography>
            <TextField
              label="Screenname"
              size="small"
              autoFocus
              fullWidth
              slotProps={{ htmlInput: { "data-el-id": "amberxvid:login:screenname" } }}
              value={screenname}
              onChange={(e) => setScreenname(e.target.value)}
              onKeyDown={onEnter(pickName)}
              helperText="3–24 characters: letters, digits, spaces, . _ ' -"
            />
            <Button variant="contained" onClick={pickName} disabled={busy || screenname.trim().length < 3}>
              {busy ? <CircularProgress size={18} /> : "Enter AmberX Vid"}
            </Button>
          </>
        )}

        {error && (
          <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
            {error}
          </Alert>
        )}
      </Box>
    </Box>
  );
}

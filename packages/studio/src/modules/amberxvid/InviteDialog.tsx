"use client";

/**
 * @file **Invitations, from the inviter's side** — compose one, hand it over,
 * and revoke the ones that have not been used yet (P7).
 *
 * ## Delivery says what actually happened
 *
 * The one thing this screen is careful about. When no `AMBERXVID_SMTP_URL` is
 * configured, an email invitation is **composed**, not sent: the server hands
 * back a `mailto:` URI and this dialog opens it. Saying "sent" there would be
 * the exact false-green `.claude/rules/autonomy-and-verification.md` is about
 * — a green check nobody can distinguish from the real thing — so the server
 * answers with a tagged {@link InviteDelivery} and the dialog renders the tag
 * rather than a hopeful sentence of its own. `sent` and `handed-over` look
 * different on screen, permanently.
 *
 * ## Targets come from what is actually live
 *
 * The target picker offers the stream the member is hosting RIGHT NOW and the
 * group chats they are actually in — nothing typed, nothing remembered. A
 * target that has ended between opening the dialog and pressing the button is
 * refused by the server with its own sentence, which is the only place that
 * check can be correct.
 *
 * The list below is the reason invitations are stored records rather than
 * bare signatures: a link that has gone somewhere you regret is revocable,
 * and a spent one shows who used it and when.
 */

import * as React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Close as CloseIcon, ContentCopy as CopyIcon, LinkOff as RevokeIcon } from "./kit/icons";
import { GX } from "./kit/gx";
import { useToast } from "./kit/Toast";
import { inviteUrl, targetPhrase, type InviteChannel, type InviteRow } from "./lib/inviteContract";

/** Mirrors `InviteDelivery` in `lib/invites.ts` — the tagged outcome. */
type Delivery =
  | { kind: "none" }
  | { kind: "dm"; to: string }
  | { kind: "sent"; to: string }
  | { kind: "handed-over"; uri: string; why: string };

interface Snapshot {
  invites: InviteRow[];
  delivery: { smtp: boolean; why: string };
  canInvite: boolean;
  why: string | null;
}

export interface InviteChatOption {
  id: string;
  label: string;
}

export interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  /** The room I am hosting right now, if any — the only stream I may invite to. */
  myStream: { id: string; title: string } | null;
  /** Group chats I am in. DMs are excluded: a pair cannot take a third member. */
  groupChats: InviteChatOption[];
}

const CHANNELS: { value: InviteChannel; label: string; hint: string }[] = [
  { value: "link", label: "Copy a link", hint: "Composed here for you to paste anywhere." },
  { value: "internal", label: "Message a member", hint: "Sent as a direct message inside the studio." },
  { value: "email", label: "Email", hint: "Opens in your mail app, or is sent by the server when one is configured." },
  { value: "sms", label: "Text", hint: "Opens in your messaging app — no SMS gateway is invented here." },
];

export default function InviteDialog({ open, onClose, myStream, groupChats }: InviteDialogProps) {
  const toast = useToast();
  const [snap, setSnap] = React.useState<Snapshot | null>(null);
  const [tab, setTab] = React.useState<"compose" | "sent">("compose");
  const [channel, setChannel] = React.useState<InviteChannel>("link");
  const [handle, setHandle] = React.useState("");
  const [target, setTarget] = React.useState("none");
  const [buddy, setBuddy] = React.useState(true);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [made, setMade] = React.useState<{ url: string; delivery: Delivery } | null>(null);

  const load = React.useCallback(async (): Promise<void> => {
    try {
      const res = await fetch("/api/amberxvid/invites");
      const json = (await res.json().catch(() => null)) as (Snapshot & { ok?: boolean }) | null;
      if (res.ok && json?.ok) {
        setSnap({ invites: json.invites, delivery: json.delivery, canInvite: json.canInvite, why: json.why });
      }
    } catch {
      /* the dialog degrades to "no invitations yet" rather than an error wall */
    }
  }, []);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  /* The target options, built from what is live. `none` is first and default:
   * a plain "join AmberX Vid" invitation is the common one. */
  const targetOptions = React.useMemo(() => {
    const options = [{ value: "none", label: "Just AmberX Vid" }];
    if (myStream) options.push({ value: `stream:${myStream.id}`, label: `My live stream — ${myStream.title}` });
    options.push({ value: "call:", label: "A video call with me" });
    for (const chat of groupChats) options.push({ value: `chat:${chat.id}`, label: `Group chat — ${chat.label}` });
    return options;
  }, [myStream, groupChats]);

  // A target that disappears (the stream ends while the dialog is open) must
  // not leave the select pointing at a value it no longer offers — MUI renders
  // that as an empty box and the member cannot tell what they are inviting to.
  React.useEffect(() => {
    if (!targetOptions.some((o) => o.value === target)) setTarget("none");
  }, [targetOptions, target]);

  const create = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setMade(null);
    const cut = target.indexOf(":");
    try {
      const res = await fetch("/api/amberxvid/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          channel,
          handle: handle.trim() || null,
          targetKind: cut < 0 ? target : target.slice(0, cut),
          targetId: cut < 0 ? "" : target.slice(cut + 1),
          buddy,
          note: note.trim() || null,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; url?: string; delivery?: Delivery; invites?: InviteRow[] }
        | null;
      setBusy(false);
      if (!res.ok || !json?.ok || !json.url) {
        setError(json?.error ?? "the invitation could not be created");
        return;
      }
      if (json.invites && snap) setSnap({ ...snap, invites: json.invites });
      const delivery: Delivery = json.delivery ?? { kind: "none" };
      setMade({ url: json.url, delivery });
      handOver(json.url, delivery);
      setNote("");
      setHandle("");
    } catch {
      setBusy(false);
      setError("the studio did not answer");
    }
  };

  /** Do the thing the delivery tag says was left to do — and nothing more. */
  const handOver = (url: string, delivery: Delivery): void => {
    if (delivery.kind === "dm") {
      toast(`Invitation sent to ${delivery.to}`);
      return;
    }
    if (delivery.kind === "sent") {
      toast(`Invitation emailed to ${delivery.to}`);
      return;
    }
    if (delivery.kind === "handed-over" && delivery.uri.startsWith("http")) {
      void copy(url);
      return;
    }
    if (delivery.kind === "handed-over") {
      window.location.href = delivery.uri;
      toast("Opening your own app to send it");
      return;
    }
    void copy(url);
  };

  const copy = async (url: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      toast("Invitation link copied");
    } catch {
      toast("Could not reach the clipboard — the link is on screen, copy it by hand");
    }
  };

  const revoke = async (id: string): Promise<void> => {
    try {
      const res = await fetch("/api/amberxvid/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", id }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; invites?: InviteRow[] }
        | null;
      if (!res.ok || !json?.ok) {
        toast(json?.error ?? "could not revoke that invitation");
        return;
      }
      if (json.invites && snap) setSnap({ ...snap, invites: json.invites });
      toast("Invitation revoked — that link is dead");
    } catch {
      toast("the studio did not answer");
    }
  };

  const needsHandle = channel === "internal" || channel === "email" || channel === "sms";
  const blocked = snap !== null && !snap.canInvite;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
        <Typography sx={{ flex: 1, fontFamily: GX.mono, fontSize: 13, letterSpacing: "0.14em" }}>
          INVITE
        </Typography>
        <IconButton size="small" onClick={onClose} data-el-id="amberxvid:invite:close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
        <Tabs
          value={tab}
          onChange={(_e, v: "compose" | "sent") => setTab(v)}
          variant="fullWidth"
          sx={{ minHeight: 34, "& .MuiTab-root": { minHeight: 34, fontSize: 12, textTransform: "none" } }}
        >
          <Tab value="compose" label="New invitation" data-el-id="amberxvid:invite:tab-compose" />
          <Tab value="sent" label={`Sent (${snap?.invites.length ?? 0})`} data-el-id="amberxvid:invite:tab-sent" />
        </Tabs>

        {blocked && (
          <Alert severity="warning" variant="outlined" sx={{ fontSize: 12 }}>
            {snap?.why}
          </Alert>
        )}

        {tab === "compose" && (
          <>
            <TextField
              select
              size="small"
              label="Send it"
              value={channel}
              onChange={(e) => setChannel(e.target.value as InviteChannel)}
              helperText={CHANNELS.find((c) => c.value === channel)?.hint}
              slotProps={{ htmlInput: { "data-el-id": "amberxvid:invite:channel" } }}
            >
              {CHANNELS.map((c) => (
                <MenuItem key={c.value} value={c.value}>
                  {c.label}
                </MenuItem>
              ))}
            </TextField>

            {needsHandle && (
              <TextField
                size="small"
                label={channel === "internal" ? "Member" : channel === "email" ? "Email address" : "Phone number"}
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                slotProps={{
                  htmlInput: { "data-el-id": "amberxvid:invite:handle", autoCapitalize: "none", autoCorrect: "off" },
                }}
              />
            )}

            <TextField
              select
              size="small"
              label="Land them in"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              helperText="A stream, a group chat or a call with you — they go straight there."
              slotProps={{ htmlInput: { "data-el-id": "amberxvid:invite:target" } }}
            >
              {targetOptions.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              size="small"
              label="A note (optional)"
              value={note}
              multiline
              minRows={2}
              onChange={(e) => setNote(e.target.value)}
              slotProps={{ htmlInput: { "data-el-id": "amberxvid:invite:note", maxLength: 280 } }}
            />

            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={buddy}
                  onChange={(e) => setBuddy(e.target.checked)}
                  data-el-id="amberxvid:invite:buddy"
                />
              }
              label={
                <Typography sx={{ fontSize: 12 }}>
                  Add them to my buddy list when they accept
                </Typography>
              }
            />

            <Button
              variant="contained"
              onClick={() => void create()}
              disabled={busy || blocked || (needsHandle && !handle.trim())}
              data-el-id="amberxvid:invite:create"
            >
              {busy ? <CircularProgress size={18} /> : "Create the invitation"}
            </Button>

            {made && (
              <Alert
                severity={made.delivery.kind === "handed-over" ? "info" : "success"}
                variant="outlined"
                sx={{ fontSize: 11.5 }}
                data-el-id="amberxvid:invite:result"
              >
                <Typography sx={{ fontSize: 11.5, fontWeight: 600 }}>
                  {made.delivery.kind === "dm"
                    ? `Sent as a message to ${made.delivery.to}.`
                    : made.delivery.kind === "sent"
                      ? `Emailed to ${made.delivery.to} from the server.`
                      : made.delivery.kind === "handed-over"
                        ? "Not sent from here — handed to your own app."
                        : "Link ready and copied."}
                </Typography>
                {made.delivery.kind === "handed-over" && (
                  <Typography sx={{ fontSize: 11, color: GX.dim, mt: 0.5 }}>{made.delivery.why}</Typography>
                )}
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1 }}>
                  <Typography
                    sx={{ fontFamily: GX.mono, fontSize: 10.5, wordBreak: "break-all", flex: 1, color: GX.dim }}
                  >
                    {made.url}
                  </Typography>
                  <Tooltip title="Copy the link">
                    <IconButton size="small" onClick={() => void copy(made.url)}>
                      <CopyIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Alert>
            )}

            {snap && (
              <Typography sx={{ fontSize: 10.5, color: GX.dim }}>{snap.delivery.why}</Typography>
            )}
            {error && (
              <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
                {error}
              </Alert>
            )}
          </>
        )}

        {tab === "sent" && (
          <Stack spacing={1}>
            {(snap?.invites.length ?? 0) === 0 && (
              <Typography sx={{ fontSize: 12, color: GX.dim }}>
                You have not invited anybody yet. Nothing here is a placeholder — this list is the
                real store.
              </Typography>
            )}
            {snap?.invites.map((row) => (
              <Box
                key={row.id}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  p: 1,
                  border: `1px solid ${GX.edge}`,
                  borderRadius: 1,
                  bgcolor: GX.panel2,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: 12, color: GX.ink }}>
                    {row.handle ?? "a link"} · {targetPhrase(row.target)}
                  </Typography>
                  <Typography sx={{ fontSize: 10.5, color: GX.dim }}>
                    {row.state === "spent"
                      ? `Used by ${row.redeemedBy} on ${new Date(row.redeemedAt ?? "").toLocaleString()}`
                      : row.state === "revoked"
                        ? "Revoked"
                        : row.state === "expired"
                          ? "Expired"
                          : `Expires ${new Date(row.expiresAt).toLocaleString()}`}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  variant="outlined"
                  label={row.state}
                  sx={{
                    fontSize: 10,
                    color: row.state === "open" ? GX.ok : GX.dim,
                    borderColor: row.state === "open" ? GX.ok : GX.edge,
                  }}
                />
                {row.state === "open" && (
                  <>
                    <Tooltip title="Copy the link again">
                      <IconButton
                        size="small"
                        onClick={() => void copy(inviteUrl(window.location.origin, row.token))}
                      >
                        <CopyIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Revoke — the link stops working">
                      <IconButton
                        size="small"
                        onClick={() => void revoke(row.id)}
                        data-el-id={`amberxvid:invite:revoke:${row.id}`}
                      >
                        <RevokeIcon />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
              </Box>
            ))}
            <Divider flexItem sx={{ borderColor: GX.edge }} />
            <Typography sx={{ fontSize: 10.5, color: GX.dim }}>
              An invitation is single-use. Revoking one that has already been used is refused — it
              did what it did, and the history says so.
            </Typography>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

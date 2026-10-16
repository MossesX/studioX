/**
 * @file The report composer — the member's end of the moderation queue (P17).
 *
 * Opened by the platform's `report(subject)` (`ctxBridge.ts`), which every
 * declared *Report to moderators* row calls. It exists because a report needs
 * a REASON and the reason has to be the reporter's own words: the queue's rows
 * are read by a person deciding what to do about somebody, and a reason the
 * client composed would be a report nobody actually made.
 *
 * What it shows back is deliberately small: an acknowledgement, never a
 * verdict. A reporter is not told what was decided — the wing tells the SUBJECT
 * when something is removed, and telling the reporter too would turn a
 * moderation queue into a scoreboard.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import type { ReportSubject } from "./lib/types";

/** Human names for the five subject kinds — the queue's vocabulary is
 *  `album-item`, a person's is "photo". */
const KIND_LABEL: Record<ReportSubject["kind"], string> = {
  post: "post",
  comment: "comment",
  "album-item": "photo",
  stream: "live stream",
  profile: "profile",
};

export default function ReportDialog({
  subject,
  onClose,
  onSaid,
}: {
  /** Null when nothing is being reported — the dialog is not mounted then. */
  subject: ReportSubject;
  onClose: () => void;
  /** The module's own toast, so an acknowledgement lands where every other
   *  confirmation in this suite does. */
  onSaid: (message: string) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/amberxvid/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject, reason: reason.trim() }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !body.ok) {
        setError(body.error ?? `that report did not send (HTTP ${res.status})`);
        return;
      }
      onSaid("Reported — a moderator will look at it");
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const what = KIND_LABEL[subject.kind];

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>Report this {what}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 1.75, pt: 0.5 }}>
          <Typography sx={{ fontSize: 12, color: token("dim") }}>
            {subject.owner}&apos;s {what}. Moderators see what you write here, what you were
            looking at, and your name.
          </Typography>
          {subject.excerpt && (
            <Typography
              sx={{
                fontSize: 12,
                color: token("dim"),
                borderLeft: `2px solid ${token("edge")}`,
                pl: 1,
                maxHeight: 120,
                overflow: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {subject.excerpt}
            </Typography>
          )}
          <TextField
            label="What is wrong with it?"
            size="small"
            autoFocus
            multiline
            minRows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          {error && (
            <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
              {error}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: token("dim") }}>
          Cancel
        </Button>
        <Button variant="contained" disabled={busy || !reason.trim()} onClick={() => void send()}>
          {busy ? <CircularProgress size={16} /> : "Report"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

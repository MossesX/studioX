/**
 * @file **The AmberX Vid moderation wing** — contributed INTO the accounts
 * admin suite through `accounts.admin-tab`, never mounted as a console of its
 * own (P17 of `axf-amberxvid-social`, 2026-08-15).
 *
 * ## Where this renders, and why that is the whole design
 *
 * Inside `/accounts` → Admin → *AmberX Vid*. It has no route, no nav entry and
 * no gate of its own: the suite renders it only for an administrator, and every
 * action it fires goes to `/api/amberxvid/moderation`, which re-checks the role
 * and the module grant per request. A screen is not a security boundary — the
 * route is — and a wing that carried its own admin check would be a second
 * answer to a question the suite has already answered.
 *
 * ## What is NOT here, deliberately
 *
 * **User management, policy editing and file browsing.** The suite already owns
 * all three, one tab to the left: accounts, roles and the permission matrix are
 * the Overview tab's; storage and the remove-data cascade are its admin route's;
 * and the *Audit* history of everything below is the accounts journal, which
 * every action here writes to (`lib/moderation.ts`). That last one is the point
 * of living inside the suite rather than beside it: moderation history needed
 * no viewer of its own, because the suite already had one.
 *
 * ## The five tabs
 *
 * - **Reports** — the queue. Each row previews IN PLACE (the subject resolved
 *   live, falling back to the reporter's stored excerpt when the author has
 *   already deleted it), and the same panel carries the act: remove the subject,
 *   or close the report as actioned or dismissed.
 * - **Live** — what is broadcasting right now, with force-end. It closes the
 *   room server-side through the host's own verb, so the watchers are signalled
 *   and the history rows are written exactly as they are on a normal close.
 * - **Recordings** — the whole library (the one place a role sees past the
 *   per-owner rule), with purge. The bytes are credited back to the owner's
 *   quota by the store, not by this screen.
 * - **Content** — one member's wall as a moderator sees it, for the removal
 *   somebody was pointed at out of band rather than through a report.
 * - **Maintenance** — the vault integrity scan, its fix pass, and the orphan
 *   sweep for rooms and conversations whose owners were deleted.
 *
 * **Every acting button opens the reason dialog.** Not politeness: the audit
 * line carries actor, subject and reason, and the API refuses an act without
 * one. A reason box that could be skipped would fill the log with a sentence
 * nobody chose.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { AdminTools, useAdminTools } from "./PointSlots";
import { wallMediaUrl } from "./lib/wallClient";
import type {
  ModerationPreview,
  ModerationSnapshot,
  RecordingManifest,
  ReportEntry,
  ReportState,
  ReportSubject,
  StreamInfo,
  VaultFinding,
  VaultScan,
  WallPost,
} from "./lib/types";

/* ---------------------------------- plumbing ----------------------------------- */

const API = "/api/amberxvid/moderation";

interface Envelope {
  ok?: boolean;
  error?: string;
  snapshot?: ModerationSnapshot;
  preview?: ModerationPreview;
  scan?: VaultScan;
  page?: { posts: WallPost[]; nextCursor: string | null; owners: Record<string, string> };
}

/** One POST, one envelope. Every caller reads `error` — the wing never fails
 *  silently, because a moderation act that quietly did nothing is worse than
 *  one that says it could not. */
async function post(body: Record<string, unknown>): Promise<Envelope> {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Envelope;
    return json.ok ? json : { ok: false, error: json.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

const fmtBytes = (n: number): string =>
  n < 1024
    ? `${n} B`
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : n < 1024 * 1024 * 1024
        ? `${(n / (1024 * 1024)).toFixed(1)} MB`
        : `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;

const fmtWhen = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString() : "—";

const mono = { fontFamily: token("mono"), fontSize: 11.5 } as const;

/* -------------------------------- reason dialog --------------------------------- */

interface Pending {
  title: string;
  /** What the reason will be recorded against, shown so it cannot be mistyped. */
  subject: string;
  /** Red button when the act destroys something. */
  destructive?: boolean;
  confirmLabel: string;
  run: (reason: string) => Promise<Envelope>;
}

/**
 * The one confirm in the wing, and the only place a reason is typed.
 *
 * The button stays dead until a reason exists — the API would refuse anyway,
 * and a client that let the click through only to render the refusal would be
 * teaching the operator that the field is optional.
 */
function ReasonDialog({
  pending,
  onClose,
  onDone,
}: {
  pending: Pending;
  onClose: () => void;
  onDone: (env: Envelope) => void;
}) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const go = async () => {
    setBusy(true);
    setError(null);
    const env = await pending.run(reason.trim());
    setBusy(false);
    if (!env.ok) {
      setError(env.error ?? "that did not go through");
      return;
    }
    onDone(env);
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>{pending.title}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, pt: 0.5 }}>
          <Typography sx={{ ...mono, color: token("dim") }}>{pending.subject}</Typography>
          <TextField
            label="Reason (recorded in the audit log)"
            size="small"
            autoFocus
            multiline
            minRows={2}
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
        <Button
          variant="contained"
          color={pending.destructive ? "error" : "primary"}
          disabled={busy || !reason.trim()}
          onClick={() => void go()}
        >
          {busy ? <CircularProgress size={16} /> : pending.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/* ------------------------------------ reports ----------------------------------- */

const STATE_COLOR: Record<ReportState, string> = {
  open: token("warn"),
  actioned: token("ok"),
  dismissed: token("dim"),
};

const subjectLine = (s: ReportSubject): string =>
  `${s.kind} · ${s.owner}${s.parent ? ` · ${s.parent}` : ""}${s.id ? ` · ${s.id}` : ""}`;

/** The queue's detail panel: what was reported, as it is right now. */
function ReportDetail({
  report,
  onAct,
}: {
  report: ReportEntry;
  onAct: (pending: Pending) => void;
}) {
  const [preview, setPreview] = React.useState<ModerationPreview | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    void post({ action: "preview", subject: report.subject }).then((env) => {
      if (!live) return;
      setPreview(env.preview ?? null);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [report.id, report.subject]);

  const s = report.subject;
  const removable = s.kind === "post" || s.kind === "comment";

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.75, background: token("panel"), borderColor: token("edge") }}
    >
      <Stack sx={{ gap: 1.25 }}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Chip
            size="small"
            label={report.state}
            variant="outlined"
            sx={{ height: 20, fontSize: 11, color: STATE_COLOR[report.state], borderColor: STATE_COLOR[report.state] }}
          />
          <Typography sx={{ ...mono }}>{subjectLine(s)}</Typography>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
            filed by {report.reporter} · {fmtWhen(report.createdAt)}
          </Typography>
        </Stack>

        <Typography sx={{ fontSize: 12.5 }}>
          <strong>Reason given:</strong> {report.reason}
        </Typography>

        <Divider />

        {loading ? (
          <CircularProgress size={18} />
        ) : preview?.found ? (
          <Stack sx={{ gap: 0.75 }}>
            <Typography sx={{ fontSize: 12, color: token("dim") }}>
              {preview.title} · {preview.author ?? "unknown"} · {fmtWhen(preview.at)}
              {preview.visibility ? ` · ${preview.visibility}` : ""}
            </Typography>
            <Typography sx={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>
              {preview.body || <em>(no text)</em>}
            </Typography>
            {(preview.media ?? []).length > 0 && (
              <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
                {(preview.media ?? []).map((id) => (
                  <Box
                    key={id}
                    component="img"
                    src={wallMediaUrl(s.owner, id)}
                    alt=""
                    // A private post's bytes are not served to a member-facing
                    // media route, admin or not. The image is a bonus, never
                    // the evidence — the text and the excerpt are.
                    onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                      e.currentTarget.style.display = "none";
                    }}
                    sx={{ width: 120, height: 90, objectFit: "cover", borderRadius: token("radius") }}
                  />
                ))}
              </Stack>
            )}
          </Stack>
        ) : (
          <Stack sx={{ gap: 0.75 }}>
            <Alert severity="info" variant="outlined" sx={{ fontSize: 12 }}>
              The reported {s.kind} is gone — deleted between the report and now. What the reporter
              saw is below.
            </Alert>
            <Typography sx={{ fontSize: 12.5, whiteSpace: "pre-wrap", color: token("dim") }}>
              {s.excerpt || <em>(the reporter's client captured nothing)</em>}
            </Typography>
          </Stack>
        )}

        {report.state === "open" ? (
          <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", pt: 0.5 }}>
            {removable && preview?.found && (
              <Button
                size="small"
                variant="contained"
                color="error"
                onClick={() =>
                  onAct({
                    title: s.kind === "post" ? "Remove this post" : "Remove this comment",
                    subject: subjectLine(s),
                    destructive: true,
                    confirmLabel: "Remove",
                    run: (reason) =>
                      post(
                        s.kind === "post"
                          ? { action: "remove-post", owner: s.owner, postId: s.id, reason }
                          : {
                              action: "remove-comment",
                              owner: s.owner,
                              postId: s.parent ?? "",
                              commentId: s.id,
                              reason,
                            },
                      ),
                  })
                }
              >
                Remove the {s.kind}
              </Button>
            )}
            {s.kind === "stream" && preview?.found && (
              <Button
                size="small"
                variant="contained"
                color="error"
                onClick={() =>
                  onAct({
                    title: "End this stream",
                    subject: subjectLine(s),
                    destructive: true,
                    confirmLabel: "End it",
                    run: (reason) => post({ action: "end-stream", streamId: s.id, reason }),
                  })
                }
              >
                End the stream
              </Button>
            )}
            <Button
              size="small"
              variant="outlined"
              onClick={() =>
                onAct({
                  title: "Close as actioned",
                  subject: subjectLine(s),
                  confirmLabel: "Actioned",
                  run: (reason) =>
                    post({ action: "act-report", id: report.id, state: "actioned", reason }),
                })
              }
            >
              Actioned
            </Button>
            <Button
              size="small"
              sx={{ color: token("dim") }}
              onClick={() =>
                onAct({
                  title: "Dismiss this report",
                  subject: subjectLine(s),
                  confirmLabel: "Dismiss",
                  run: (reason) =>
                    post({ action: "act-report", id: report.id, state: "dismissed", reason }),
                })
              }
            >
              Dismiss
            </Button>
          </Stack>
        ) : (
          <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
            {report.state} by {report.resolvedBy} · {fmtWhen(report.resolvedAt)}
            {report.resolution ? ` — ${report.resolution}` : ""}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}

function ReportsTab({
  snapshot,
  onAct,
}: {
  snapshot: ModerationSnapshot;
  onAct: (pending: Pending) => void;
}) {
  const [filter, setFilter] = React.useState<ReportState | "all">("open");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const rows = snapshot.reports.filter((r) => filter === "all" || r.state === filter);

  return (
    <Stack sx={{ gap: 1.25 }}>
      <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
        {(["open", "actioned", "dismissed", "all"] as const).map((f) => (
          <Chip
            key={f}
            size="small"
            label={
              f === "all"
                ? `all ${snapshot.reports.length}`
                : `${f} ${snapshot.counts[f as ReportState]}`
            }
            variant={filter === f ? "filled" : "outlined"}
            onClick={() => setFilter(f)}
            sx={{ height: 22, fontSize: 11.5 }}
          />
        ))}
      </Stack>

      {rows.length === 0 ? (
        <Typography sx={{ fontSize: 12.5, color: token("dim") }}>
          Nothing {filter === "all" ? "in the queue" : `is ${filter}`}. Members file reports from
          the right-click <em>Report to moderators</em> row.
        </Typography>
      ) : (
        <Stack sx={{ gap: 0.75 }}>
          {rows.map((r) => (
            <Box key={r.id}>
              <Paper
                variant="outlined"
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
                sx={{
                  p: 1,
                  cursor: "pointer",
                  borderColor: openId === r.id ? token("accent") : token("edge"),
                  background: "transparent",
                }}
              >
                <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Chip
                    size="small"
                    label={r.subject.kind}
                    variant="outlined"
                    sx={{ height: 19, fontSize: 10.5 }}
                  />
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{r.subject.owner}</Typography>
                  <Typography
                    sx={{
                      fontSize: 12,
                      color: token("dim"),
                      flex: 1,
                      minWidth: 120,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.reason}
                  </Typography>
                  <Typography sx={{ ...mono, color: STATE_COLOR[r.state] }}>{r.state}</Typography>
                  <Typography sx={{ fontSize: 11, color: token("dim") }}>
                    {fmtWhen(r.createdAt)}
                  </Typography>
                </Stack>
              </Paper>
              {openId === r.id && (
                <Box sx={{ pt: 0.75 }}>
                  <ReportDetail report={r} onAct={onAct} />
                </Box>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/* ------------------------------------ streams ----------------------------------- */

function StreamsTab({
  streams,
  onAct,
}: {
  streams: StreamInfo[];
  onAct: (pending: Pending) => void;
}) {
  if (streams.length === 0) {
    return (
      <Typography sx={{ fontSize: 12.5, color: token("dim") }}>
        Nobody is live right now.
      </Typography>
    );
  }
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          {["Host", "Title", "Viewers", "Peak", "Started", ""].map((h) => (
            <TableCell key={h} sx={{ fontSize: 11.5, color: token("dim") }}>
              {h}
            </TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {streams.map((s) => (
          <TableRow key={s.id} hover>
            <TableCell sx={{ fontSize: 12.5, fontWeight: 600 }}>{s.host}</TableCell>
            <TableCell sx={{ fontSize: 12 }}>{s.title || <em>(untitled)</em>}</TableCell>
            <TableCell sx={mono}>{s.viewers.length}</TableCell>
            <TableCell sx={mono}>{s.peakViewers}</TableCell>
            <TableCell sx={{ fontSize: 11.5, color: token("dim") }}>{fmtWhen(s.startedAt)}</TableCell>
            <TableCell align="right">
              <Button
                size="small"
                color="error"
                onClick={() =>
                  onAct({
                    title: `Force-end ${s.host}'s stream`,
                    subject: `stream/${s.host}/${s.id}`,
                    destructive: true,
                    confirmLabel: "End it now",
                    run: (reason) => post({ action: "end-stream", streamId: s.id, reason }),
                  })
                }
              >
                Force-end
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/* ---------------------------------- recordings ---------------------------------- */

function RecordingsTab({
  snapshot,
  onAct,
}: {
  snapshot: ModerationSnapshot;
  onAct: (pending: Pending) => void;
}) {
  const [owner, setOwner] = React.useState("");
  const rows: RecordingManifest[] = snapshot.recordings.filter(
    (r) => !owner || r.owner.toLowerCase() === owner.toLowerCase(),
  );
  const bytes = rows.reduce((n, r) => n + r.sizeBytes, 0);

  return (
    <Stack sx={{ gap: 1.25 }}>
      <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          select
          size="small"
          label="Owner"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">every member</MenuItem>
          {snapshot.members.map((m) => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </TextField>
        <Typography sx={{ fontSize: 12, color: token("dim") }}>
          {rows.length} recording(s) · {fmtBytes(bytes)}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          color="error"
          variant="outlined"
          disabled={rows.length === 0}
          onClick={() =>
            onAct({
              title: owner ? `Purge ${owner}'s library` : "Purge every recording",
              subject: `recordings/${owner || "*"} · ${rows.length} capture(s), ${fmtBytes(bytes)}`,
              destructive: true,
              confirmLabel: "Purge",
              run: (reason) => post({ action: "purge-recordings", username: owner, reason }),
            })
          }
        >
          Purge {owner ? "this library" : "everything"}
        </Button>
      </Stack>

      <Table size="small">
        <TableHead>
          <TableRow>
            {["Owner", "Title", "Engine", "Length", "Size", "Started", ""].map((h) => (
              <TableCell key={h} sx={{ fontSize: 11.5, color: token("dim") }}>
                {h}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} hover>
              <TableCell sx={{ fontSize: 12.5 }}>{r.owner}</TableCell>
              <TableCell sx={{ fontSize: 12 }}>
                {r.title}
                {r.endedAt === null && (
                  <Chip
                    size="small"
                    label="capturing"
                    variant="outlined"
                    sx={{ ml: 0.75, height: 18, fontSize: 10, color: token("warn"), borderColor: token("warn") }}
                  />
                )}
              </TableCell>
              <TableCell sx={mono}>{r.engine}</TableCell>
              <TableCell sx={mono}>{r.durationS ? `${r.durationS}s` : "—"}</TableCell>
              <TableCell sx={mono}>{fmtBytes(r.sizeBytes)}</TableCell>
              <TableCell sx={{ fontSize: 11.5, color: token("dim") }}>{fmtWhen(r.startedAt)}</TableCell>
              <TableCell align="right">
                <Tooltip title={r.endedAt === null ? "An open capture is its engine's" : "Purge"}>
                  <span>
                    <IconButton
                      size="small"
                      disabled={r.endedAt === null}
                      onClick={() =>
                        onAct({
                          title: `Purge “${r.title}”`,
                          subject: `recording/${r.owner}/${r.id} · ${fmtBytes(r.sizeBytes)}`,
                          destructive: true,
                          confirmLabel: "Purge",
                          run: (reason) => post({ action: "purge-recording", id: r.id, reason }),
                        })
                      }
                    >
                      <Glyph id="icon-trash" size={13} />
                    </IconButton>
                  </span>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
}

/* ----------------------------------- content ------------------------------------ */

function ContentTab({
  snapshot,
  onAct,
  nonce,
}: {
  snapshot: ModerationSnapshot;
  onAct: (pending: Pending) => void;
  /** Bumped by the parent after every act, so the wall re-reads. */
  nonce: number;
}) {
  const [owner, setOwner] = React.useState("");
  const [posts, setPosts] = React.useState<WallPost[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!owner) {
      setPosts([]);
      return;
    }
    let live = true;
    setLoading(true);
    void post({ action: "wall", owner }).then((env) => {
      if (!live) return;
      setPosts(env.page?.posts ?? []);
      setError(env.ok ? null : (env.error ?? null));
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [owner, nonce]);

  return (
    <Stack sx={{ gap: 1.25 }}>
      <Stack direction="row" sx={{ gap: 1, alignItems: "center" }}>
        <TextField
          select
          size="small"
          label="Member"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">choose a member</MenuItem>
          {snapshot.members.map((m) => (
            <MenuItem key={m} value={m}>
              {m}
            </MenuItem>
          ))}
        </TextField>
        <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
          Their wall as a moderator sees it — every post, whatever its visibility.
        </Typography>
      </Stack>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
          {error}
        </Alert>
      )}
      {loading && <CircularProgress size={18} />}
      {!loading && owner && posts.length === 0 && !error && (
        <Typography sx={{ fontSize: 12.5, color: token("dim") }}>
          {owner} has posted nothing.
        </Typography>
      )}

      <Stack sx={{ gap: 1 }}>
        {posts.map((p) => (
          <Paper key={p.id} variant="outlined" sx={{ p: 1.25, background: "transparent" }}>
            <Stack sx={{ gap: 0.75 }}>
              <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{p.author}</Typography>
                <Chip size="small" label={p.visibility} variant="outlined" sx={{ height: 18, fontSize: 10 }} />
                <Typography sx={{ fontSize: 11, color: token("dim") }}>{fmtWhen(p.createdAt)}</Typography>
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  color="error"
                  onClick={() =>
                    onAct({
                      title: "Remove this post",
                      subject: `post/${owner}/${p.id}`,
                      destructive: true,
                      confirmLabel: "Remove",
                      run: (reason) =>
                        post({ action: "remove-post", owner, postId: p.id, reason }),
                    })
                  }
                >
                  Remove post
                </Button>
              </Stack>
              <Typography sx={{ fontSize: 12.5, whiteSpace: "pre-wrap" }}>
                {p.text || <em>(no text)</em>}
              </Typography>
              {p.comments.length > 0 && (
                <Stack sx={{ gap: 0.5, pl: 1.5, borderLeft: `2px solid ${token("edge")}` }}>
                  {p.comments.map((c) => (
                    <Stack key={c.id} direction="row" sx={{ alignItems: "center", gap: 1 }}>
                      <Typography sx={{ fontSize: 12 }}>
                        <strong>{c.author}</strong> {c.text}
                      </Typography>
                      <Box sx={{ flex: 1 }} />
                      <Button
                        size="small"
                        sx={{ color: token("err"), fontSize: 11 }}
                        onClick={() =>
                          onAct({
                            title: "Remove this comment",
                            subject: `comment/${owner}/${p.id}/${c.id}`,
                            destructive: true,
                            confirmLabel: "Remove",
                            run: (reason) =>
                              post({
                                action: "remove-comment",
                                owner,
                                postId: p.id,
                                commentId: c.id,
                                reason,
                              }),
                          })
                        }
                      >
                        Remove
                      </Button>
                    </Stack>
                  ))}
                </Stack>
              )}
            </Stack>
          </Paper>
        ))}
      </Stack>
    </Stack>
  );
}

/* --------------------------------- maintenance ---------------------------------- */

const FINDING_COLOR: Record<VaultFinding["kind"], string> = {
  "orphan-file": token("warn"),
  "missing-file": token("err"),
  "dangling-media": token("err"),
  "stale-index-row": token("dim"),
  "orphan-room": token("warn"),
  "orphan-thread": token("warn"),
  "orphan-vault": token("info"),
};

function MaintenanceTab({ onAct }: { onAct: (pending: Pending) => void }) {
  const [scan, setScan] = React.useState<VaultScan | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const run = async (action: "scan") => {
    setBusy(true);
    setError(null);
    const env = await post({ action });
    setBusy(false);
    if (!env.ok) {
      setError(env.error ?? "the scan did not run");
      return;
    }
    setScan(env.scan ?? null);
  };

  const fixable = (scan?.findings ?? []).filter((f) => f.fixable).length;

  return (
    <Stack sx={{ gap: 1.25 }}>
      <Typography sx={{ fontSize: 12, color: token("dim") }}>
        The scan reads; nothing is written until you run the fix pass — which re-scans first,
        because the numbers below age the moment they are printed.
      </Typography>

      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        <Button size="small" variant="outlined" disabled={busy} onClick={() => void run("scan")}>
          {busy ? <CircularProgress size={15} /> : "Scan vaults"}
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={busy || !scan || fixable === 0}
          onClick={() =>
            onAct({
              title: "Run the fix pass",
              subject: `${fixable} fixable finding(s) — orphan files deleted, dangling references dropped, quota credited back`,
              confirmLabel: "Fix",
              run: (reason) => post({ action: "repair", reason }),
            })
          }
        >
          Fix pass
        </Button>
        <Button
          size="small"
          color="error"
          variant="outlined"
          disabled={busy}
          onClick={() =>
            onAct({
              title: "Sweep orphaned rooms and conversations",
              subject: "rooms whose host has no account · conversations none of whose members remain",
              destructive: true,
              confirmLabel: "Sweep",
              run: (reason) => post({ action: "sweep-orphans", reason }),
            })
          }
        >
          Sweep orphans
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
          {error}
        </Alert>
      )}

      {scan && (
        <>
          <Typography sx={{ fontSize: 12 }}>
            {scan.findings.length} finding(s) across {scan.vaults} vault(s), {scan.rooms} room(s)
            and {scan.threads} conversation(s) · {fmtBytes(scan.bytes)}
            {scan.repaired ? " reclaimed" : " recoverable"} · {fmtWhen(scan.generatedAt)}
          </Typography>
          {scan.findings.length === 0 ? (
            <Alert severity="success" variant="outlined" sx={{ fontSize: 12 }}>
              Every document and every byte agree.
            </Alert>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  {["Member", "Kind", "Subject", "What", "Bytes", ""].map((h) => (
                    <TableCell key={h} sx={{ fontSize: 11.5, color: token("dim") }}>
                      {h}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {scan.findings.map((f, i) => (
                  <TableRow key={`${f.subject}-${i}`} hover>
                    <TableCell sx={{ fontSize: 12 }}>{f.owner}</TableCell>
                    <TableCell sx={{ ...mono, color: FINDING_COLOR[f.kind] }}>{f.kind}</TableCell>
                    <TableCell sx={mono}>{f.subject}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{f.detail}</TableCell>
                    <TableCell sx={mono}>{f.bytes ? fmtBytes(f.bytes) : "—"}</TableCell>
                    <TableCell sx={{ fontSize: 11.5, color: token("dim") }}>
                      {f.fixed === true
                        ? "fixed"
                        : f.fixed === false
                          ? "fix failed"
                          : f.fixable
                            ? "fixable"
                            : "by hand"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </>
      )}
    </Stack>
  );
}

/* ------------------------------------ the wing ---------------------------------- */

/**
 * `tools` (P19) is the only one of these that may not exist: it is the
 * `amberxvid.admin-tool` slot, and it is absent when nothing is contributed —
 * which is the state on a tree with no moderation plugins installed, i.e. this
 * one. A tab that is always there and usually empty is chrome that teaches a
 * moderator to ignore a tab.
 */
type WingTab = "reports" | "live" | "recordings" | "content" | "maintenance" | "tools";

export default function AdminWing() {
  const [snapshot, setSnapshot] = React.useState<ModerationSnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<WingTab>("reports");
  const [pending, setPending] = React.useState<Pending | null>(null);
  const [said, setSaid] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);
  /** Contributed moderation tools (P19). Read here rather than only inside the
   *  slot so the TAB's presence and the slot's contents come from one list and
   *  cannot disagree — a tab that opens onto nothing is the failure this
   *  avoids. */
  const tools = useAdminTools();

  const load = React.useCallback(async () => {
    try {
      const res = await fetch(API);
      const body = (await res.json()) as Envelope;
      if (!body.ok || !body.snapshot) {
        setError(body.error ?? `the wing could not load (HTTP ${res.status})`);
        return;
      }
      setSnapshot(body.snapshot);
      setError(null);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  /** Every act returns the fresh snapshot, so the screen never renders a state
   *  it inferred from its own optimism. */
  const onDone = (env: Envelope) => {
    setPending(null);
    setSaid("Done — the act is in the accounts audit log.");
    setNonce((n) => n + 1);
    if (env.snapshot) setSnapshot(env.snapshot);
    else void load();
  };

  if (error && !snapshot) {
    return (
      <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
        {error}
      </Alert>
    );
  }
  if (!snapshot) return <CircularProgress size={22} />;

  return (
    <Stack sx={{ gap: 1.25, minHeight: 0 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Glyph id="icon-play" size={16} />
        <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>AmberX Vid moderation</Typography>
        {snapshot.counts.open > 0 && (
          <Chip
            size="small"
            label={`${snapshot.counts.open} open`}
            sx={{ height: 20, fontSize: 11, color: token("warn"), borderColor: token("warn") }}
            variant="outlined"
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 11, color: token("dim") }}>
          Members, roles and storage are the suite's own tabs · every act here lands in its audit
          log
        </Typography>
        <Tooltip title="Reload">
          <IconButton size="small" onClick={() => void load()}>
            <Glyph id="icon-sync" size={14} />
          </IconButton>
        </Tooltip>
      </Stack>

      {said && (
        <Alert severity="success" variant="outlined" sx={{ fontSize: 12 }} onClose={() => setSaid(null)}>
          {said}
        </Alert>
      )}
      {error && (
        <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
          {error}
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(_, v: WingTab) => setTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        slotProps={{ indicator: { sx: { background: token("accent") } } }}
        sx={{ minHeight: 34, "& .MuiTab-root": { minHeight: 34, py: 0, fontSize: 12, textTransform: "none" } }}
      >
        <Tab value="reports" label={`Reports (${snapshot.counts.open})`} />
        <Tab value="live" label={`Live (${snapshot.streams.length})`} />
        <Tab value="recordings" label={`Recordings (${snapshot.recordings.length})`} />
        <Tab value="content" label="Content" />
        <Tab value="maintenance" label="Maintenance" />
        {/* P19 — present only while something is contributed. The five above
            are the wing's own and did not move onto the point: each reads a
            slice of the ONE snapshot and hands its acts to the ONE ReasonDialog
            that makes a moderator type a reason, and neither of those could be
            given to a contribution without giving away what a reason is. */}
        {tools.length > 0 && <Tab value="tools" label={`Tools (${tools.length})`} />}
      </Tabs>

      <Box sx={{ pt: 0.5 }}>
        {tab === "reports" && <ReportsTab snapshot={snapshot} onAct={setPending} />}
        {tab === "live" && <StreamsTab streams={snapshot.streams} onAct={setPending} />}
        {tab === "recordings" && <RecordingsTab snapshot={snapshot} onAct={setPending} />}
        {tab === "content" && <ContentTab snapshot={snapshot} onAct={setPending} nonce={nonce} />}
        {tab === "maintenance" && <MaintenanceTab onAct={setPending} />}
        {tab === "tools" && (
          <AdminTools
            host={{
              notify: (message) => setSaid(message),
              // A tool acts through the module's own API and then asks for the
              // truth back. It is never handed the snapshot: a tool acting on a
              // state it was given cannot know that state is still true.
              reload: () => void load(),
            }}
          />
        )}
      </Box>

      {pending && (
        <ReasonDialog pending={pending} onClose={() => setPending(null)} onDone={onDone} />
      )}
    </Stack>
  );
}

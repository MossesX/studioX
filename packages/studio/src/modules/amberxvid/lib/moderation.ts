/**
 * @file **The moderator's verbs, and the one audit line every one of them
 * writes** (P17 of `axf-amberxvid-social`, 2026-08-15).
 *
 * `./reports` is the QUEUE — what a report is, and nothing about what may be
 * done with one. This file is the other half: acting on a report, force-ending
 * a stream, purging a recording, removing a post or a comment — each composed
 * out of the store verb that already exists, so a moderator's delete and a
 * member's delete are the SAME code path with a different actor.
 *
 * ## The audit line is the point of the whole wing
 *
 * Every verb here ends in {@link auditModeration}, which writes to the
 * **accounts** journal (`accounts/lib/fsCore`), not this module's. That is the
 * one deliberate cross-module write in the file, and it is what buys the
 * property the wing exists for: moderation history shows up wherever accounts
 * shows its audit trail, with no code in this module and no second viewer. A
 * wing that kept its own log would be a second console with extra steps — the
 * exact thing "administration lives in ONE place" was ruling out.
 *
 * The line carries **actor, subject and reason**, always all three. A
 * moderation record without a reason is a record of a mood; without a subject
 * it is unauditable; without an actor it is anonymous power. The store verbs
 * underneath still write their own module-journal lines about the BYTES they
 * moved — those are bookkeeping, this is accountability, and they answer
 * different questions.
 *
 * ## What is deliberately NOT here
 *
 * User management, policy editing, storage browsing. The accounts admin suite
 * already owns all three, and the wing's own docblock (`../AdminWing.tsx`) says
 * so at the place someone would look first. A moderation verb that disabled an
 * account would be a second, unaudited half of a control the suite already has.
 *
 * Server-only.
 */

import { appendJournal as auditJournal } from "@axs/modules/accounts/lib/fsCore";
import { findAccount } from "@axs/modules/accounts/lib/accounts";
import { isOnline as accountOnline } from "@axs/modules/accounts/lib/presence";
import { sendMessage } from "@axs/modules/accounts/lib/messages";

import { notifyUsers, presenceSnapshot, broadcastAll } from "./presence";
import { archiveClosure, closeStream, listStreams } from "./streams";
import { deleteRecording, getRecording, purgeRecordings } from "./recordings";
import type { PurgeResult } from "./recordings";
import { deleteComment, deletePost, readPost } from "./wall";
import { resolveReport, resolveReportsAbout } from "./reports";
import type {
  RecordingManifest,
  ReportEntry,
  ReportState,
  ReportSubject,
  StreamInfo,
  StreamSignal,
  WallPost,
} from "./types";

/* ---------------------------------- results ------------------------------------ */

export type ModerationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

const fail = (status: number, error: string): { ok: false; error: string; status: number } => ({
  ok: false,
  error,
  status,
});

const norm = (u: string): string => u.trim().toLowerCase();

/* ----------------------------------- the audit ---------------------------------- */

/**
 * What was done. A closed union rather than a free string: the audit is read by
 * eye and by grep, and an action spelled two ways is an action that is missed
 * one of the two times somebody looks for it.
 */
export type ModerationAct =
  | "report-actioned"
  | "report-dismissed"
  | "stream-force-ended"
  | "recording-purged"
  | "recordings-purged"
  | "post-removed"
  | "comment-removed"
  | "vault-scanned"
  | "vault-repaired"
  | "orphans-swept";

export interface ModerationAudit {
  actor: string;
  act: ModerationAct;
  /** What was acted on, addressed so it can be found again. */
  subject: string;
  /** Why. Never optional — see the header. */
  reason: string;
  /** Numbers worth keeping: bytes freed, rows closed, viewers dropped. */
  detail?: string;
}

/** Removals are `delete`; everything else changed a state rather than a file. */
const OP_OF: Record<ModerationAct, "edit" | "delete"> = {
  "report-actioned": "edit",
  "report-dismissed": "edit",
  "stream-force-ended": "edit",
  "recording-purged": "delete",
  "recordings-purged": "delete",
  "post-removed": "delete",
  "comment-removed": "delete",
  "vault-scanned": "edit",
  "vault-repaired": "edit",
  "orphans-swept": "delete",
};

/**
 * Write one line to the ACCOUNTS audit log.
 *
 * The `path` is a subject ADDRESS (`amberxvid:post/gizmox/wp-…`) rather than a
 * filesystem path, because the thing acted on is often already gone by the time
 * the line is written — a path to a deleted file is a dead link, an address is
 * still an identity. The journal's `summary` is what a person reads, and it
 * always names actor, act, subject and reason in that order.
 *
 * Cannot throw: `appendJournal` swallows its own faults, and this adds nothing
 * that could. An audit that failed a moderation action would make the safest
 * possible failure mode "do nothing about the abuse".
 */
export async function auditModeration(entry: ModerationAudit): Promise<void> {
  const reason = entry.reason.trim() || "(no reason given)";
  await auditJournal(OP_OF[entry.act], `amberxvid:${entry.subject}`, {
    summary:
      `AmberX Vid moderation · ${entry.act} · by ${norm(entry.actor)} · ${entry.subject} · ` +
      `reason: ${reason}${entry.detail ? ` · ${entry.detail}` : ""}`,
  });
}

/** The address form used in every audit line and by the wing's links. */
export function subjectAddress(subject: ReportSubject): string {
  const parent = subject.parent ? `${subject.parent}/` : "";
  return `${subject.kind}/${subject.owner}/${parent}${subject.id || "-"}`;
}

/* ------------------------------- telling the subject ----------------------------- */

/**
 * Tell a member a moderator removed something of theirs, over the platform's
 * own DMs — the same channel everything else in this product speaks through.
 *
 * BEST EFFORT, on purpose. The notice rides `sendMessage`, which honours the
 * accounts interaction guard, so a member who has blocked this administrator
 * will not receive it. The alternative — a channel that bypasses the guard —
 * would be a way to reach anybody from any account that can borrow the word
 * "moderator". The removal is audited either way, and the audit is the record;
 * the notice is a courtesy that is allowed to fail.
 */
async function tellSubject(actor: string, subject: string, what: string, reason: string): Promise<boolean> {
  const target = norm(subject);
  if (!target || target === norm(actor)) return false;
  const account = await findAccount(target);
  if (!account || account.disabled === true) return false;
  const text =
    `⚠ ${what} was removed by a moderator.\n` +
    `Reason: ${reason.trim() || "(no reason given)"}`;
  const res = await sendMessage(actor, target, text, accountOnline(target));
  return res.ok === true;
}

/* --------------------------------- report verbs ---------------------------------- */

/**
 * Close one report. `actioned` when something was done about the subject,
 * `dismissed` when nothing needed doing — and both are audited, because "we
 * looked and decided no" is exactly the decision a second complaint about the
 * same person needs to be able to find.
 */
export async function actOnReport(
  actor: string,
  id: string,
  state: ReportState,
  reason: string,
): Promise<ModerationResult<ReportEntry>> {
  const res = await resolveReport(actor, id, state, reason);
  if (!res.ok) return fail(res.status, res.error);
  await auditModeration({
    actor,
    act: state === "actioned" ? "report-actioned" : "report-dismissed",
    subject: subjectAddress(res.report.subject),
    reason,
    detail: `report ${res.report.id} filed by ${res.report.reporter}`,
  });
  return { ok: true, value: res.report };
}

/* --------------------------------- stream verbs ---------------------------------- */

export interface ForcedEnd {
  stream: StreamInfo;
  /** Members who were watching when it was cut. */
  attached: string[];
}

/**
 * End a live stream from the outside — the wing's one lever over something
 * that is happening RIGHT NOW rather than something already stored.
 *
 * It goes through `closeStream(actor, id, isAdmin: true)`, the host's own verb,
 * so the room closes server-side exactly as it does when the host stops it: the
 * seats are cleared, the watchers are signalled, the history rows are written.
 * A separate admin path would be a second way for a room to end, and the second
 * one is where the ghost rooms come from.
 */
export async function forceEndStream(
  actor: string,
  streamId: string,
  reason: string,
): Promise<ModerationResult<ForcedEnd>> {
  const result = closeStream(actor, streamId, true);
  if (!result.ok) return fail(result.status, result.error);

  const ended: StreamSignal = { kind: "ended", streamId, from: actor };
  notifyUsers(result.value.attached, { type: "stream-signal", signal: ended });
  broadcastAll({ type: "streams", streams: listStreams() });
  broadcastAll({ type: "roster", roster: await presenceSnapshot() });
  await archiveClosure(result.value.closure);

  await auditModeration({
    actor,
    act: "stream-force-ended",
    subject: `stream/${result.value.info.host}/${streamId}`,
    reason,
    detail: `"${result.value.info.title}" · ${result.value.attached.length} viewer(s) dropped`,
  });
  await tellSubject(actor, result.value.info.host, "Your live stream", reason);
  return { ok: true, value: { stream: result.value.info, attached: result.value.attached } };
}

/* -------------------------------- recording verbs -------------------------------- */

/**
 * Purge one recording. The bytes are credited back to the OWNER's quota by
 * `deleteRecording` itself (`chargeVault(owner, "recordings", -freed)`) — the
 * wing does not do its own accounting, which is what keeps the ledger's one
 * arithmetic in one place.
 */
export async function purgeRecording(
  actor: string,
  id: string,
  reason: string,
): Promise<ModerationResult<RecordingManifest>> {
  const before = await getRecording(id);
  const res = await deleteRecording(actor, id, { admin: true });
  if (!res.ok) return fail(res.status, res.error);
  await auditModeration({
    actor,
    act: "recording-purged",
    subject: `recording/${res.manifest.owner}/${id}`,
    reason,
    detail:
      `"${res.manifest.title}" · ${(res.manifest.sizeBytes / 1024 / 1024).toFixed(1)} MB credited back` +
      (before?.engine ? ` · ${before.engine} capture` : ""),
  });
  await tellSubject(actor, res.manifest.owner, `Your recording “${res.manifest.title}”`, reason);
  return { ok: true, value: res.manifest };
}

/** The bulk purge — one member's library, or the whole store when `owner` is
 *  omitted. Open captures are skipped by the store, never yanked. */
export async function purgeLibrary(
  actor: string,
  owner: string | null,
  reason: string,
): Promise<ModerationResult<PurgeResult>> {
  const result = await purgeRecordings(actor, owner);
  await auditModeration({
    actor,
    act: "recordings-purged",
    subject: `recordings/${owner ?? "*"}/-`,
    reason,
    detail:
      `${result.deleted} deleted · ${(result.bytes / 1024 / 1024).toFixed(1)} MB · ` +
      `${result.skippedOpen} open capture(s) skipped`,
  });
  if (owner) await tellSubject(actor, owner, `${result.deleted} of your recordings`, reason);
  return { ok: true, value: result };
}

/* ----------------------------------- wall verbs ---------------------------------- */

/**
 * Remove a wall post as a moderator, tell its author why, and close every open
 * report about it in the same act.
 *
 * `deletePost` already answers to "the author, or a moderator" and does the
 * whole cascade (attachments deleted, both quota lines credited, the index
 * rewritten). Duplicating any of that here would be the second delete path this
 * file exists not to create.
 */
export async function removePost(
  actor: string,
  owner: string,
  postId: string,
  reason: string,
): Promise<ModerationResult<WallPost>> {
  const res = await deletePost(actor, owner, postId);
  if (!res.ok) return fail(res.status, res.error);
  const subject: ReportSubject = { kind: "post", owner: norm(owner), id: postId };
  const closed = await resolveReportsAbout(actor, subject, reason);
  await auditModeration({
    actor,
    act: "post-removed",
    subject: subjectAddress(subject),
    reason,
    detail:
      `author ${res.post.author} · ${res.post.media.length} attachment(s) · ` +
      `${closed.length} report(s) closed`,
  });
  await tellSubject(actor, res.post.author, "Your wall post", reason);
  return { ok: true, value: res.post };
}

/** Remove one comment, same shape: the store's own verb, the author told, the
 *  reports about that comment closed, the act audited. */
export async function removeComment(
  actor: string,
  owner: string,
  postId: string,
  commentId: string,
  reason: string,
): Promise<ModerationResult<WallPost>> {
  // Read the author BEFORE the delete — afterwards the comment is gone and
  // there is nobody left to name in the notice or the audit line. The read is
  // made AS THE OWNER, which is the moderator-visible view of a wall this
  // module already grants (`readPost`'s viewer tier), never a bypass.
  const author =
    readPost(owner, owner, postId)?.comments.find((c) => c.id === commentId)?.author ?? null;
  const res = await deleteComment(actor, owner, postId, commentId);
  if (!res.ok) return fail(res.status, res.error);
  const subject: ReportSubject = {
    kind: "comment",
    owner: norm(owner),
    id: commentId,
    parent: postId,
  };
  const closed = await resolveReportsAbout(actor, subject, reason);
  await auditModeration({
    actor,
    act: "comment-removed",
    subject: subjectAddress(subject),
    reason,
    detail: `author ${author ?? "unknown"} · ${closed.length} report(s) closed`,
  });
  if (author) await tellSubject(actor, author, "Your comment", reason);
  return { ok: true, value: res.post };
}


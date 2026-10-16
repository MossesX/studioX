/**
 * @file **The moderation queue** — what a *Report* row files into (P17 of
 * `axf-amberxvid-social`, 2026-08-15).
 *
 * ```
 * <root>/reports.json     { version: 1, reports: ReportEntry[] }
 * ```
 *
 * Until this phase, reporting was a DM to every administrator, and both the
 * decl and `ctxBridge.ts` said why in as many words: *"a Report row that filed
 * into a table nobody has built yet reports into nothing"*. This is that table.
 * The DM path is retired rather than kept alongside — two places a report can
 * land is two places a moderator has to look, and the one they do not look at
 * is where the report will be.
 *
 * ## Three decisions worth reading before changing anything here
 *
 * **1. A report is a REFERENCE plus an excerpt, never a copy.** The subject is
 * `{kind, owner, id, parent?}` — enough for the wing to resolve the live thing
 * and act on it — plus a capped `excerpt` of what the reporter was looking at.
 * The excerpt exists because the queue must survive its own subject: the most
 * common thing that happens between a report and a moderator opening it is that
 * the author deleted the post. A pure reference would leave the moderator with
 * an id and no way to judge; a full copy would make this store a second,
 * unmoderated copy of everything anybody ever objected to.
 *
 * **2. A duplicate report is not a second row.** The same reporter filing
 * against the same subject while their first report is still open gets that
 * first report back, untouched. Otherwise one annoyed member can bury a queue,
 * and a moderator's count stops meaning "things to look at". Two DIFFERENT
 * reporters against one subject are two rows on purpose — that is signal, and
 * collapsing it would hide the case a queue exists to surface.
 *
 * **3. Resolution is a state change, never a delete.** `actioned` and
 * `dismissed` both keep the row, its reason and the moderator who decided,
 * because "was this already looked at, and what did we decide" is the question
 * the SECOND report about the same person asks. Only the cap ever removes a
 * row, oldest first, and it prefers to drop resolved ones — see {@link cap}.
 *
 * House posture: degrade never crash (a junk file reads as an empty queue and
 * is re-seeded on the next write), ONE cross-process lock around each whole
 * read-modify-write (`withStoreLock`, per `.claude/rules/concurrent-builds.md`),
 * atomic writes, every mutation journaled by a journal that cannot fail a save.
 *
 * The MODERATOR-facing half — acting on a row, and the accounts audit line that
 * every act writes — is `./moderation`. This file is the store and nothing
 * else: it knows what a report is, not what may be done about one. Server-only.
 */

import { appendJournal, readJson, withStoreLock, writeJsonAtomic } from "./fsCore";
import { isValidUsername } from "./accounts";
import { reportsFile } from "./paths";
import type {
  ReportCounts,
  ReportEntry,
  ReportState,
  ReportSubject,
  ReportSubjectKind,
} from "./types";

/* ---------------------------------- limits ------------------------------------ */

/** A reason has to be a sentence, not an essay — the wing renders it inline. */
export const REPORT_REASON_MAX = 600;
/** What is kept of the subject. Long enough to judge a post by, short enough
 *  that this store never becomes a mirror of the wall. */
export const REPORT_EXCERPT_MAX = 800;
/** A moderator's closing note. */
export const REPORT_RESOLUTION_MAX = 600;
/** Rows kept. Resolved ones are dropped before open ones (see {@link cap}). */
export const REPORTS_KEEP = 2000;

/* --------------------------------- results ------------------------------------ */

export type ReportResult =
  | { ok: true; report: ReportEntry }
  | { ok: false; error: string; status: number };

const fail = (status: number, error: string): ReportResult => ({ ok: false, error, status });

/* --------------------------------- plumbing ----------------------------------- */

const norm = (u: unknown): string => (typeof u === "string" ? u.trim().toLowerCase() : "");

const clip = (v: unknown, max: number): string =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

const REPORT_ID_RE = /^rep-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}$/;

export const isReportId = (id: string): boolean => REPORT_ID_RE.test(id);

/** The house id shape — same stamp+entropy every other store in this module
 *  mints, so a report id sorts chronologically like everything else. */
function newReportId(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = Array.from(
    { length: 6 },
    () => "0123456789abcdef"[Math.floor(Math.random() * 16)],
  ).join("");
  return `rep-${stamp}-${rand}`;
}

async function journal(op: "create" | "edit", summary: string): Promise<void> {
  if (process.env.AMBERXVID_SILENT_JOURNAL === "1") return;
  try {
    await appendJournal(op, "data/amberxvid/reports.json", { summary });
  } catch {
    /* ignore — accounting must never fail a save */
  }
}

/* --------------------------------- the document -------------------------------- */

interface ReportsDoc {
  version: 1;
  reports: ReportEntry[];
}

const SUBJECT_KINDS: readonly ReportSubjectKind[] = [
  "post",
  "comment",
  "album-item",
  "stream",
  "profile",
];

const STATES: readonly ReportState[] = ["open", "actioned", "dismissed"];

const isKind = (v: unknown): v is ReportSubjectKind =>
  typeof v === "string" && (SUBJECT_KINDS as readonly string[]).includes(v);

export const isReportState = (v: unknown): v is ReportState =>
  typeof v === "string" && (STATES as readonly string[]).includes(v);

/** Normalize one stored subject, or reject it. */
function normalizeSubject(raw: unknown): ReportSubject | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isKind(r.kind)) return null;
  const owner = norm(r.owner);
  if (!owner) return null;
  const id = typeof r.id === "string" ? r.id.trim().slice(0, 120) : "";
  // Everything but a profile IS an id — a subject without one names nothing.
  if (r.kind !== "profile" && !id) return null;
  const parent = typeof r.parent === "string" ? r.parent.trim().slice(0, 120) : "";
  const excerpt = clip(r.excerpt, REPORT_EXCERPT_MAX);
  return {
    kind: r.kind,
    owner,
    id,
    ...(parent ? { parent } : {}),
    ...(excerpt ? { excerpt } : {}),
  };
}

/**
 * Normalize one stored row, or drop it. A junk row is dropped rather than
 * trusted — the same posture the wall index takes, for the same reason: a
 * queue that 500s on one bad row is a queue nobody can clear.
 */
function normalizeEntry(raw: unknown): ReportEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !isReportId(r.id)) return null;
  const subject = normalizeSubject(r.subject);
  if (!subject) return null;
  const reporter = norm(r.reporter);
  if (!reporter) return null;
  const state = isReportState(r.state) ? r.state : "open";
  const resolved = state !== "open";
  return {
    version: 1,
    id: r.id,
    subject,
    reporter,
    reason: clip(r.reason, REPORT_REASON_MAX),
    state,
    createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date(0).toISOString(),
    // A resolved row without a stamp is repaired to a stamp rather than left
    // half-resolved: the wing sorts and filters on these three together.
    resolvedAt: resolved
      ? typeof r.resolvedAt === "string"
        ? r.resolvedAt
        : new Date(0).toISOString()
      : null,
    resolvedBy: resolved ? norm(r.resolvedBy) || "unknown" : null,
    resolution: resolved ? clip(r.resolution, REPORT_RESOLUTION_MAX) : "",
  };
}

const byNewest = (a: ReportEntry, b: ReportEntry): number =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

/** Read the whole queue, normalized and newest first. No lock — a junk or
 *  absent file reads as empty and the next write re-seeds it. */
function readAll(): ReportEntry[] {
  const doc = readJson<Partial<ReportsDoc> | null>(reportsFile(), null);
  if (!doc || !Array.isArray(doc.reports)) return [];
  const rows = doc.reports.map(normalizeEntry).filter((e): e is ReportEntry => e !== null);
  // Last row for an id wins — a hand-edited file must not double a report.
  return [...new Map(rows.map((e) => [e.id, e])).values()].sort(byNewest);
}

/**
 * Trim to {@link REPORTS_KEEP}, dropping RESOLVED rows before open ones.
 *
 * A plain `slice(-KEEP)` would evict by age alone, and the oldest rows in a
 * busy queue are exactly the ones nobody has got to yet — the cap would quietly
 * delete the backlog it exists to bound. Open rows are only dropped when the
 * queue is entirely open and over the cap, which is a real operational fact and
 * one the caller's journal line states.
 */
function cap(rows: ReportEntry[]): ReportEntry[] {
  if (rows.length <= REPORTS_KEEP) return rows;
  const open = rows.filter((r) => r.state === "open");
  if (open.length >= REPORTS_KEEP) return open.slice(0, REPORTS_KEEP);
  const resolved = rows.filter((r) => r.state !== "open").slice(0, REPORTS_KEEP - open.length);
  return [...open, ...resolved].sort(byNewest);
}

function saveLocked(rows: ReportEntry[]): void {
  const doc: ReportsDoc = { version: 1, reports: cap([...rows].sort(byNewest)) };
  writeJsonAtomic(reportsFile(), doc);
}

/* ------------------------------------ reads ------------------------------------ */

export interface ReportFilter {
  state?: ReportState;
  /** Only reports about this member's material. */
  owner?: string;
  /** Only reports filed by this member. */
  reporter?: string;
}

/** The queue, newest first, optionally narrowed. */
export function listReports(filter: ReportFilter = {}): ReportEntry[] {
  const owner = norm(filter.owner);
  const reporter = norm(filter.reporter);
  return readAll().filter(
    (r) =>
      (filter.state === undefined || r.state === filter.state) &&
      (!owner || r.subject.owner === owner) &&
      (!reporter || r.reporter === reporter),
  );
}

export function getReport(id: string): ReportEntry | null {
  if (!isReportId(id)) return null;
  return readAll().find((r) => r.id === id) ?? null;
}

/** The three numbers the wing's tab badge and header show. */
export function reportCounts(): ReportCounts {
  const counts: ReportCounts = { open: 0, actioned: 0, dismissed: 0 };
  for (const r of readAll()) counts[r.state] += 1;
  return counts;
}

/**
 * Every OPEN report about one subject — what the wing shows beside a piece of
 * content, and what {@link fileReport} checks for a duplicate.
 */
export function openReportsAbout(subject: ReportSubject): ReportEntry[] {
  return readAll().filter((r) => r.state === "open" && sameSubject(r.subject, subject));
}

const sameSubject = (a: ReportSubject, b: ReportSubject): boolean =>
  a.kind === b.kind && a.owner === b.owner && a.id === b.id && (a.parent ?? "") === (b.parent ?? "");

/* ----------------------------------- writes ------------------------------------ */

export interface NewReport {
  subject: ReportSubject;
  reason: string;
}

/**
 * File a report. Any signed-in member may — reporting is the one moderation
 * affordance that is not an administrator's, which is the whole point of it.
 *
 * Refused: an unparseable subject, an empty reason, and reporting your OWN
 * material (the decl's `amberxvid.post.reportable` predicate already hides the
 * row, and this is the server saying the same thing rather than trusting it).
 */
export async function fileReport(reporter: string, input: NewReport): Promise<ReportResult> {
  const me = norm(reporter);
  if (!me || !isValidUsername(me)) return fail(401, "sign in to AmberX Vid first");

  const subject = normalizeSubject(input?.subject);
  if (!subject) return fail(400, "that is not something that can be reported");
  if (!isValidUsername(subject.owner)) return fail(400, "that is not something that can be reported");
  if (subject.owner === me) return fail(400, "that is your own — there is nothing to report");

  const reason = clip(input?.reason, REPORT_REASON_MAX);
  if (!reason) return fail(400, "say what is wrong with it — a report needs a reason");

  // Decision (2): the same reporter, the same subject, still open ⇒ their own
  // first report back, unchanged. Idempotent by design, so a double-click is
  // not a second row and a member cannot bury the queue.
  const mine = openReportsAbout(subject).find((r) => r.reporter === me);
  if (mine) return { ok: true, report: mine };

  const entry: ReportEntry = {
    version: 1,
    id: newReportId(),
    subject,
    reporter: me,
    reason,
    state: "open",
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolvedBy: null,
    resolution: "",
  };

  withStoreLock("reports", () => {
    // Re-checked INSIDE the lock: two tabs pressing Report in the same moment
    // both passed the read above, and the queue is one shared document.
    const rows = readAll();
    const raced = rows.find(
      (r) => r.state === "open" && r.reporter === me && sameSubject(r.subject, subject),
    );
    if (raced) return;
    saveLocked([...rows, entry]);
  });

  const stored = openReportsAbout(subject).find((r) => r.reporter === me) ?? entry;
  await journal(
    "create",
    `AmberX Vid: ${me} reported a ${subject.kind} of ${subject.owner}'s (${stored.id})`,
  );
  return { ok: true, report: stored };
}

/**
 * Close a report — `actioned` (something was done) or `dismissed` (nothing
 * needed doing). Both keep the row; see decision (3).
 *
 * The ROLE is not checked here. This store has no view of accounts, exactly as
 * `recordings.ts` has none: the route gates the actor and `./moderation` writes
 * the audit line. One gate, in front, where it can be seen.
 */
export async function resolveReport(
  actor: string,
  id: string,
  state: ReportState,
  note: string,
): Promise<ReportResult> {
  const me = norm(actor);
  if (!me) return fail(401, "sign in first");
  if (state !== "actioned" && state !== "dismissed") {
    return fail(400, "a report is closed as actioned or dismissed");
  }
  if (!isReportId(id)) return fail(404, "no such report");

  const outcome = withStoreLock("reports", (): ReportEntry | "gone" | "closed" => {
    const rows = readAll();
    const existing = rows.find((r) => r.id === id);
    if (!existing) return "gone";
    if (existing.state !== "open") return "closed";
    const next: ReportEntry = {
      ...existing,
      state,
      resolvedAt: new Date().toISOString(),
      resolvedBy: me,
      resolution: clip(note, REPORT_RESOLUTION_MAX),
    };
    saveLocked([...rows.filter((r) => r.id !== id), next]);
    return next;
  });

  if (outcome === "gone") return fail(404, "no such report");
  if (outcome === "closed") return fail(409, "that report has already been closed");

  await journal(
    "edit",
    `AmberX Vid: ${me} ${state} report ${id} (${outcome.subject.kind} of ${outcome.subject.owner}'s)` +
      (outcome.resolution ? ` — ${outcome.resolution}` : ""),
  );
  return { ok: true, report: outcome };
}

/**
 * Close every open report about one subject, in one act — what the wing calls
 * when a moderator removes the reported thing itself. Without it, removing a
 * post that three people reported leaves three rows saying "open" about
 * something that no longer exists.
 */
export async function resolveReportsAbout(
  actor: string,
  subject: ReportSubject,
  note: string,
): Promise<ReportEntry[]> {
  const closed: ReportEntry[] = [];
  for (const open of openReportsAbout(subject)) {
    const res = await resolveReport(actor, open.id, "actioned", note);
    if (res.ok) closed.push(res.report);
  }
  return closed;
}

/**
 * @file `/api/amberxvid/moderation` — the moderation wing's API (P17).
 *
 * Double-gated through `requireMemberAdmin`, exactly like `/api/amberxvid/admin`:
 * a signed-in STUDIO session that holds the amberxvid grant AND an accounts role
 * of `administrator`, both re-read from the accounts stores on every request, so
 * a demotion or a revoked grant binds immediately rather than at the next login.
 *
 * GET → `{ ok, snapshot }` — the queue with its counts, the live streams, and
 *   the whole recording library. Deliberately NOT the vault scan: that walk is
 *   seconds of IO and belongs behind a button, not on every tab open.
 *
 * POST `{ action, … }`, every one of which writes an accounts audit line
 *   through `lib/moderation` (never from here — a route that wrote its own
 *   audit would be a second, drift-prone copy of the format):
 *   - `act-report`       { id, state: actioned|dismissed, reason }
 *   - `preview`          { subject }            → the subject, resolved live
 *   - `end-stream`       { streamId, reason }   → closes the room server-side
 *   - `purge-recording`  { id, reason }         → quota credited to its owner
 *   - `purge-recordings` { username?, reason }  → one library, or all of them
 *   - `remove-post`      { owner, postId, reason }
 *   - `remove-comment`   { owner, postId, commentId, reason }
 *   - `wall`             { owner, cursor? }     → one member's wall, admin view
 *   - `scan`             → the vault integrity scan, read-only
 *   - `repair`           → the fix pass
 *   - `sweep-orphans`    → rooms/threads whose owners were deleted
 *
 * **A reason is required on every acting verb.** Not a nicety: the audit line
 * carries actor/subject/reason, and a reason defaulted server-side would make
 * the log full of a sentence nobody chose. The route refuses rather than
 * inventing one.
 *
 * What is NOT here, on purpose: account CRUD, policy editing, storage browsing.
 * The accounts admin suite owns all three and the wing lives inside it — see
 * `src/modules/amberxvid/AdminWing.tsx`.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireMemberAdmin } from "@axs/modules/amberxvid/lib/membership";
import {
  actOnReport,
  forceEndStream,
  purgeLibrary,
  purgeRecording,
  removeComment,
  removePost,
} from "@axs/modules/amberxvid/lib/moderation";
import { repairVaults, scanVaultsAudited, sweepOrphans } from "@axs/modules/amberxvid/lib/maintenance";
import { isReportState, listReports, reportCounts } from "@axs/modules/amberxvid/lib/reports";
import { listRecordings } from "@axs/modules/amberxvid/lib/recordings";
import { listStreams } from "@axs/modules/amberxvid/lib/streams";
import { getAlbum } from "@axs/modules/amberxvid/lib/albums";
import { listAccounts } from "@axs/modules/amberxvid/lib/accounts";
import { getProfile } from "@axs/modules/amberxvid/lib/profiles";
import { readPost, wallFor } from "@axs/modules/amberxvid/lib/wall";
import type {
  ModerationPreview,
  ModerationSnapshot,
  ReportSubject,
} from "@axs/modules/amberxvid/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const err = (error: string, status: number): NextResponse =>
  NextResponse.json({ ok: false, error }, { status });

async function snapshot(): Promise<ModerationSnapshot> {
  return {
    reports: listReports(),
    counts: reportCounts(),
    streams: listStreams(),
    recordings: await listRecordings(null),
    members: (await listAccounts()).map((a) => a.username),
    generatedAt: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireMemberAdmin(req);
  if ("deny" in gate) return gate.deny;
  return NextResponse.json({ ok: true, snapshot: await snapshot() });
}

/**
 * Resolve a report's subject to what it is RIGHT NOW — the "preview in place"
 * half of the queue, so a moderator judges the thing rather than the reporter's
 * summary of it.
 *
 * The wall read passes the OWNER as the viewer, which is this module's
 * moderator-visible read of somebody's material: the admin surfaces are the
 * audited path the wall header points administrators at, and every call that
 * reaches here has already been through `requireMemberAdmin` and will leave an
 * audit line the moment it acts. `found: false` is a real answer — the subject
 * was deleted between the report and now, which is the common case and the
 * reason the stored excerpt exists.
 */
async function previewOf(subject: ReportSubject): Promise<ModerationPreview> {
  const gone: ModerationPreview = { found: false, kind: subject.kind, title: "", body: "", author: null, at: null };
  switch (subject.kind) {
    case "post": {
      const post = readPost(subject.owner, subject.owner, subject.id);
      if (!post) return gone;
      return {
        found: true,
        kind: "post",
        title: `Post on ${subject.owner}'s wall`,
        body: post.text,
        author: post.author,
        at: post.createdAt,
        media: post.media.map((m) => m.id),
        visibility: post.visibility,
      };
    }
    case "comment": {
      const post = readPost(subject.owner, subject.owner, subject.parent ?? "");
      const comment = post?.comments.find((c) => c.id === subject.id);
      if (!post || !comment) return gone;
      return {
        found: true,
        kind: "comment",
        title: `Comment on ${subject.owner}'s post`,
        body: comment.text,
        author: comment.author,
        at: comment.createdAt,
      };
    }
    case "album-item": {
      const album = await getAlbum(subject.owner, subject.parent ?? "");
      const photo = album?.photos.find((p) => p.id === subject.id);
      if (!album || !photo) return gone;
      return {
        found: true,
        kind: "album-item",
        title: `“${album.title}” · ${subject.owner}`,
        body: photo.caption,
        author: album.owner,
        at: photo.uploadedAt,
        visibility: album.visibility,
      };
    }
    case "stream": {
      const stream = listStreams().find((s) => s.id === subject.id);
      if (!stream) return gone;
      return {
        found: true,
        kind: "stream",
        title: stream.title || "(untitled stream)",
        body: stream.description,
        author: stream.host,
        at: stream.startedAt,
      };
    }
    case "profile": {
      const profile = await getProfile(subject.owner);
      if (!profile) return gone;
      return {
        found: true,
        kind: "profile",
        title: profile.screenname || subject.owner,
        // Both free-text fields, joined: the reportable part of a profile is
        // what its owner wrote, and which of the two boxes they wrote it in is
        // not something a moderator should have to click twice to find out.
        body: [profile.statusLine, profile.aboutMe].filter(Boolean).join("\n\n"),
        author: subject.owner,
        at: profile.updatedAt,
      };
    }
    default:
      return gone;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireMemberAdmin(req);
  if ("deny" in gate) return gate.deny;
  const actor = gate.user;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return err("body must be JSON", 400);
  }
  const str = (k: string): string => (typeof body[k] === "string" ? (body[k] as string) : "");
  const action = str("action");
  const reason = str("reason").trim();

  /** Every acting verb needs one — see the header. */
  const needsReason = (): NextResponse | null =>
    reason ? null : err("say why — every moderation act is audited with its reason", 400);

  switch (action) {
    case "act-report": {
      const state = str("state");
      if (!isReportState(state) || state === "open") {
        return err("state must be 'actioned' or 'dismissed'", 400);
      }
      const bad = needsReason();
      if (bad) return bad;
      const res = await actOnReport(actor, str("id"), state, reason);
      if (!res.ok) return err(res.error, res.status);
      return NextResponse.json({ ok: true, report: res.value, snapshot: await snapshot() });
    }

    case "preview": {
      const subject = body.subject as ReportSubject | undefined;
      if (!subject || typeof subject !== "object" || typeof subject.kind !== "string") {
        return err("subject is required", 400);
      }
      return NextResponse.json({ ok: true, preview: await previewOf(subject) });
    }

    case "end-stream": {
      const bad = needsReason();
      if (bad) return bad;
      const res = await forceEndStream(actor, str("streamId"), reason);
      if (!res.ok) return err(res.error, res.status);
      return NextResponse.json({ ok: true, ...res.value, snapshot: await snapshot() });
    }

    case "purge-recording": {
      const bad = needsReason();
      if (bad) return bad;
      const res = await purgeRecording(actor, str("id"), reason);
      if (!res.ok) return err(res.error, res.status);
      return NextResponse.json({ ok: true, recording: res.value, snapshot: await snapshot() });
    }

    case "purge-recordings": {
      const bad = needsReason();
      if (bad) return bad;
      const res = await purgeLibrary(actor, str("username").trim() || null, reason);
      if (!res.ok) return err(res.error, res.status);
      return NextResponse.json({ ok: true, purged: res.value, snapshot: await snapshot() });
    }

    case "remove-post": {
      const bad = needsReason();
      if (bad) return bad;
      const res = await removePost(actor, str("owner"), str("postId"), reason);
      if (!res.ok) return err(res.error, res.status);
      return NextResponse.json({ ok: true, post: res.value, snapshot: await snapshot() });
    }

    case "remove-comment": {
      const bad = needsReason();
      if (bad) return bad;
      const res = await removeComment(actor, str("owner"), str("postId"), str("commentId"), reason);
      if (!res.ok) return err(res.error, res.status);
      return NextResponse.json({ ok: true, post: res.value, snapshot: await snapshot() });
    }

    /**
     * One member's wall AS THE MODERATOR sees it — every post, whatever its
     * visibility, so the removal levers below act on something the moderator
     * actually read. `wallFor(owner, owner, …)` is that view: the owner tier of
     * this module's own visibility ladder, not a bypass bolted on here.
     */
    case "wall": {
      const owner = str("owner").trim();
      if (!owner) return err("owner is required", 400);
      const cursor = str("cursor") || null;
      return NextResponse.json({ ok: true, page: wallFor(owner, owner, cursor) });
    }

    case "scan":
      return NextResponse.json({ ok: true, scan: await scanVaultsAudited(actor) });

    case "repair":
      return NextResponse.json({ ok: true, scan: await repairVaults(actor) });

    case "sweep-orphans":
      return NextResponse.json({ ok: true, scan: await sweepOrphans(actor) });

    default:
      return err(`unknown action "${action}"`, 400);
  }
}

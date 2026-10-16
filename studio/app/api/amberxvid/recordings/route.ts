/**
 * @file `/api/amberxvid/recordings` — the browser recorder's chunked-upload
 * door into the library store.
 *
 * Gated like every module API on `memberUser` — the studio's `axs_session`
 * plus the amberxvid grant, both verified server-side on every request. The
 * store enforces ownership on top: chunks and finalize only land on the
 * caller's own open recording.
 *
 * Visibility (2026-08-03): a member sees ONLY their own captures; an
 * administrator sees every member's and may delete any of them, one at a time
 * or the whole library at once. The role is re-read from the accounts store on
 * every request — a demotion takes effect immediately, not at the next login.
 *
 * GET             → `{ ok, recordings, admin }` — the caller's manifests
 *                    (every member's when the caller is an administrator),
 *                    newest first.
 * POST `{ action, … }` (JSON):
 *   - `begin`    { title?, mimeType, width, height, quality, micEnabled } → manifest
 *   - `finalize` { id, durationS }                                       → manifest (+ thumbnail)
 *   - `abort`    { id }                                                  → discards the open capture
 *   - `rename`   { id, title }   — library (P5), finished + owner only
 *   - `notes`    { id, notes }   — library (P5), finished + owner only
 *   - `delete`   { id }          — library (P5), finished; owner or admin
 *   - `delete-all` { owner? }    — administrator only; the whole library, or
 *                                  one member's. Open captures are skipped.
 * PUT `?id=…&seq=…` (application/octet-stream) → appends one seq-ordered
 *   chunk. Chunks are capped at `CHUNK_MAX_BYTES` per request and the whole
 *   recording at `AMBERXVID_MAX_RECORDING_MB` — limits sized for internet
 *   uploads to the VPS, not LAN optimism.
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import { findAccount } from "@axs/modules/amberxvid/lib/accounts";
import {
  CHUNK_MAX_BYTES,
  abortRecording,
  appendChunk,
  beginRecording,
  deleteRecording,
  finalizeRecording,
  listRecordings,
  purgeRecordings,
  renameRecording,
  updateRecordingNotes,
  type RecordingResult,
} from "@axs/modules/amberxvid/lib/recordings";
import type { RecordingQuality } from "@axs/modules/amberxvid/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The caller plus their live administrator standing. The role is re-read from
 * the store per request (never trusted from the token), and a disabled account
 * is never an admin — same posture as `/api/amberxvid/admin`.
 */
async function viewer(req: NextRequest): Promise<{ user: string; admin: boolean } | null> {
  const user = await memberUser(req);
  if (!user) return null;
  const account = await findAccount(user);
  return { user, admin: account?.role === "administrator" && account.disabled !== true };
}

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

function resultJson(result: RecordingResult): NextResponse {
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, manifest: result.manifest });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const who = await viewer(req);
  if (!who) return unauthorized();
  // The visibility rule, enforced at the source: a member's listing never even
  // contains another member's rows — nothing to leak to a client-side filter.
  const recordings = await listRecordings(who.admin ? null : who.user);
  return NextResponse.json({ ok: true, admin: who.admin, recordings });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const who = await viewer(req);
  if (!who) return unauthorized();
  const { user } = who;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  const str = (k: string): string => (typeof body[k] === "string" ? (body[k] as string) : "");
  const num = (k: string): number => (typeof body[k] === "number" ? (body[k] as number) : NaN);

  switch (str("action")) {
    case "begin":
      return resultJson(
        await beginRecording(user, {
          title: str("title"),
          mimeType: str("mimeType"),
          width: num("width"),
          height: num("height"),
          quality: str("quality") as RecordingQuality,
          micEnabled: body["micEnabled"] === true,
        })
      );

    case "finalize":
      return resultJson(await finalizeRecording(user, str("id"), num("durationS")));

    case "abort":
      return resultJson(await abortRecording(user, str("id")));

    case "rename":
      return resultJson(await renameRecording(user, str("id"), str("title")));

    case "notes":
      return resultJson(await updateRecordingNotes(user, str("id"), str("notes")));

    case "delete":
      return resultJson(await deleteRecording(user, str("id"), { admin: who.admin }));

    case "delete-all": {
      if (!who.admin) {
        return NextResponse.json({ ok: false, error: "administrator access required" }, { status: 403 });
      }
      const owner = str("owner").trim();
      const purged = await purgeRecordings(user, owner || null);
      return NextResponse.json({ ok: true, ...purged });
    }

    default:
      return NextResponse.json({ ok: false, error: `unknown action "${str("action")}"` }, { status: 400 });
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  // Chunk upload is owner-scoped by the store — no role lookup needed here.
  const user = await memberUser(req);
  if (!user) return unauthorized();

  const id = req.nextUrl.searchParams.get("id") ?? "";
  const seq = Number.parseInt(req.nextUrl.searchParams.get("seq") ?? "", 10);
  if (!id || !Number.isFinite(seq) || seq < 0) {
    return NextResponse.json({ ok: false, error: "id and seq are required" }, { status: 400 });
  }

  // Cheap header check first so an oversized chunk dies before it is buffered.
  const declared = Number.parseInt(req.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > CHUNK_MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "chunk too large" }, { status: 413 });
  }

  const chunk = Buffer.from(await req.arrayBuffer());
  return resultJson(await appendChunk(user, id, seq, chunk));
}

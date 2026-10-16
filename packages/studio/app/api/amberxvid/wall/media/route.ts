/**
 * @file `/api/amberxvid/wall/media` — wall attachments, in and out.
 *
 * POST multipart/form-data → upload. Fields: `owner` (optional, defaults to the
 *   caller), files under `media`. Every file is signature-sniffed in the store
 *   (the extension comes from the BYTES), byte-capped per attachment, and
 *   weighed against the member's vault quota before it lands. Answers with the
 *   descriptors the composer then names on a post — the two-step that lets an
 *   upload fail on its own instead of taking a post down with it.
 *
 * GET ?owner=<u>&id=<wm-…> → the bytes.
 *   **Not a shared surface, unlike album photos.** A post can be `private` or
 *   `buddies`, so its attachment is served only when the caller may see a post
 *   that references it — `resolveWallMedia` answers that from the wall index,
 *   without opening a post document. A miss is the same 404 whether the id is
 *   invented, unreferenced, or simply not for this caller.
 *
 * Ownership: uploads land in the named owner's vault, and `uploadWallMedia`
 * gates that through the store's owner-or-administrator rule — nobody writes
 * bytes into somebody else's vault by passing a different `owner`.
 */

import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import {
  resolveWallMedia,
  uploadWallMedia,
  type WallMediaResult,
} from "@axs/modules/amberxvid/lib/wall";
import type { WallMedia } from "@axs/modules/amberxvid/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const viewer = await memberUser(req);
  if (!viewer) return unauthorized();

  const q = req.nextUrl.searchParams;
  const found = resolveWallMedia(viewer, q.get("owner") ?? "", q.get("id") ?? "");
  if (!found) {
    return NextResponse.json({ ok: false, error: "no such attachment" }, { status: 404 });
  }
  const bytes = await fs.promises.readFile(found.abs);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": found.media.mime,
      "content-length": String(bytes.length),
      // Private: a post's visibility can be narrowed after the fact, and a
      // shared cache would keep serving it to whoever asked first.
      "cache-control": "private, max-age=3600",
    },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await memberUser(req);
  if (!actor) return unauthorized();

  if (!(req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return NextResponse.json(
      { ok: false, error: "upload attachments as multipart/form-data" },
      { status: 400 },
    );
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "malformed multipart body" }, { status: 400 });
  }
  const ownerField = form.get("owner");
  const owner = typeof ownerField === "string" && ownerField.trim() ? ownerField.trim() : actor;

  const files = form.getAll("media").filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: 'no files under "media"' }, { status: 400 });
  }

  // Per-file verdicts, exactly as the album upload does: one file that is not
  // an image must not sink the other seven.
  const uploaded: WallMedia[] = [];
  const results: { name: string; ok: boolean; error?: string }[] = [];
  let firstFailure: WallMediaResult | null = null;
  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await uploadWallMedia(actor, owner, bytes);
    if (result.ok) {
      uploaded.push(result.media);
      results.push({ name: file.name, ok: true });
      continue;
    }
    results.push({ name: file.name, ok: false, error: result.error });
    if (!firstFailure) firstFailure = result;
    // Per-FILE failures (not an image, too big, empty) skip to the next file;
    // batch-level ones (access denied, policy, out of quota) end the run.
    const perFile = result.status === 415 || result.status === 413 || result.status === 400;
    if (!perFile) break;
  }

  if (uploaded.length === 0) {
    const status = firstFailure && !firstFailure.ok ? firstFailure.status : 400;
    const error = firstFailure && !firstFailure.ok ? firstFailure.error : "nothing uploaded";
    return NextResponse.json({ ok: false, error, results }, { status });
  }
  return NextResponse.json({ ok: true, media: uploaded, results });
}

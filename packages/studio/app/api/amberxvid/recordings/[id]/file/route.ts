/**
 * @file `/api/amberxvid/recordings/<id>/file?kind=media|thumb` — serves a
 * recording's media file or generated thumbnail out of the store.
 *
 * Same gate as the rest of the module (a signed-in AmberX Vid session), plus the library's visibility rule (2026-08-03): a member may
 * stream, thumbnail or export ONLY their own recordings — an administrator may
 * reach any of them. Gating the listing alone would be theatre; the id is
 * guessable from a manifest, so the bytes are gated here too. Ids are
 * validated against the strict store pattern, so no path ever escapes the
 * recordings root.
 *
 * Media honours `Range` (single-range) so the P5 player scrubs without
 * re-downloading; thumbnails are small JPEGs served whole. `download=1` adds a
 * content-disposition attachment named from the recording title — the
 * library's export action.
 */

import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import { findAccount } from "@axs/modules/amberxvid/lib/accounts";
import { exportFilename, getRecording, mediaPathOf, thumbPathOf } from "@axs/modules/amberxvid/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live administrator standing, re-read per request (a demotion lands now). */
async function isAdmin(user: string): Promise<boolean> {
  const account = await findAccount(user);
  return account?.role === "administrator" && account.disabled !== true;
}

/** Stream a file (or one byte range of it) as a web response body. */
function streamFile(abs: string, opts: { start?: number; end?: number } = {}): ReadableStream<Uint8Array> {
  const rs = fs.createReadStream(abs, opts.start !== undefined ? { start: opts.start, end: opts.end } : {});
  return new ReadableStream<Uint8Array>({
    start(controller) {
      rs.on("data", (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      rs.on("end", () => controller.close());
      rs.on("error", (err) => controller.error(err));
    },
    cancel() {
      rs.destroy();
    },
  });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const user = await memberUser(req);
  if (!user) {
    return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const manifest = await getRecording(id);
  if (!manifest) return NextResponse.json({ ok: false, error: "no such recording" }, { status: 404 });

  if (manifest.owner.toLowerCase() !== user.toLowerCase() && !(await isAdmin(user))) {
    return NextResponse.json({ ok: false, error: "not your recording" }, { status: 403 });
  }

  const kind = req.nextUrl.searchParams.get("kind") ?? "media";

  if (kind === "thumb") {
    const thumb = thumbPathOf(manifest);
    if (!thumb || !fs.existsSync(thumb)) {
      return NextResponse.json({ ok: false, error: "no thumbnail" }, { status: 404 });
    }
    return new NextResponse(streamFile(thumb), {
      headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" },
    });
  }

  const media = mediaPathOf(manifest);
  if (!fs.existsSync(media)) {
    return NextResponse.json({ ok: false, error: "media missing" }, { status: 404 });
  }
  const size = fs.statSync(media).size;
  const headers: Record<string, string> = {
    "content-type": manifest.mimeType,
    "accept-ranges": "bytes",
    "cache-control": "private, no-store",
  };
  if (req.nextUrl.searchParams.get("download") === "1") {
    // RFC 5987 filename* carries any unicode a title may hold; the plain
    // filename stays an ASCII fallback for older agents.
    const name = exportFilename(manifest);
    const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
    headers["content-disposition"] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number.parseInt(range[1], 10) : Math.max(0, size - Number.parseInt(range[2], 10));
    const end = range[1] && range[2] ? Math.min(Number.parseInt(range[2], 10), size - 1) : size - 1;
    if (!Number.isFinite(start) || start >= size || start > end) {
      return new NextResponse(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    }
    return new NextResponse(streamFile(media, { start, end }), {
      status: 206,
      headers: {
        ...headers,
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(end - start + 1),
      },
    });
  }

  return new NextResponse(streamFile(media), {
    headers: { ...headers, "content-length": String(size) },
  });
}

/**
 * @file `/api/amberxvid/albums/photo?owner=<u>&album=<alb-…>&id=<ph-…>` —
 * serves one album photo's bytes out of the store.
 *
 * Gated like the rest of the module on `memberUser` — a signed-in studio
 * session (`axs_session`) holding the amberxvid grant, asked of the permission
 * matrix per request.
 *
 * **Since P10 it also honours the album's VISIBILITY**, through the same
 * `resolvePhoto` the JSON reads go through. Before this phase albums were a
 * shared surface and any member could fetch any photo; now that an album can be
 * `buddies` or `private`, a bytes route that skipped the filter would serve
 * exactly what the filter withholds — and a leak on the image route is a leak,
 * whatever the JSON says. Both ids are validated against the strict store
 * patterns before they touch a path, so nothing escapes the albums root, and
 * the content-type comes from the sniffed-at-upload extension.
 */

import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import { photoMime, resolvePhoto } from "@axs/modules/amberxvid/lib/albums";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const viewer = await memberUser(req);
  if (!viewer) {
    return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
  }

  const q = req.nextUrl.searchParams;
  // One answer for "no such album", "no such photo", "not for you" and "the
  // file is missing" — the silence rule reaches the bytes route too.
  const found = await resolvePhoto(viewer, q.get("owner") ?? "", q.get("album") ?? "", q.get("id") ?? "");
  if (!found) return NextResponse.json({ ok: false, error: "no such photo" }, { status: 404 });

  const bytes = await fs.promises.readFile(found.abs);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": photoMime(found.photo),
      "content-length": String(bytes.length),
      // Private, and short: an album's visibility can be narrowed after the
      // fact, and a long-lived shared cache would outlive the narrowing.
      "cache-control": "private, max-age=3600",
    },
  });
}

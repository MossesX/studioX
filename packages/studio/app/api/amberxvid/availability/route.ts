/**
 * @file `/api/amberxvid/availability` — the member's own do-not-disturb state
 * (P13): the explicit switch and the quiet-hours window.
 *
 * **Own state only.** Reading whether somebody else is on do-not-disturb is not
 * offered, and that is a decision rather than an omission: a caller who could
 * probe it would learn a member is asleep, at dinner, or deliberately ignoring
 * them, which is precisely the information the "unavailable" copy on the ring
 * path is worded to withhold. The ring door (`lib/ring`) asks the model
 * server-side and tells the caller nothing but that the ring did not land.
 *
 * GET  → `{ availability, summary }` — the document plus the one-sentence
 *   rendering, including the server-time caveat the model owes the reader.
 * POST `{ dnd?, quietHours? }` → merge a patch, answer with the new document.
 *
 * The patch is merged field-wise by the store, so a client may send
 * `{ dnd: true }` alone without resetting a window it never mentioned.
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import {
  availabilitySummary,
  getAvailability,
  saveAvailability,
} from "@axs/modules/amberxvid/lib/availability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) return unauthorized();
  return NextResponse.json({
    ok: true,
    availability: getAvailability(me),
    summary: availabilitySummary(me),
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  // Only the two fields, hand-picked: the store normalises what it is given,
  // but a route that forwarded the whole body would let `user` or `updatedAt`
  // ride in from a client and be merged over the document's own bookkeeping.
  const patch: Record<string, unknown> = {};
  if (typeof body.dnd === "boolean") patch.dnd = body.dnd;
  if (typeof body.quietHours === "object" && body.quietHours !== null) {
    patch.quietHours = body.quietHours;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "nothing to change" }, { status: 400 });
  }

  const availability = await saveAvailability(me, patch);
  return NextResponse.json({ ok: true, availability, summary: availabilitySummary(me) });
}

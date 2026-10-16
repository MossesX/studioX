/**
 * @file `/api/amberxvid/profiles` — the module's profile surface API.
 *
 * Same gate as the rest of the module: `memberUser` — a signed-in studio
 * session (`axs_session`) holding the amberxvid grant. Profiles are
 * member-to-member content, so a signed-out caller — and a signed-in
 * non-member — sees nothing.
 *
 * GET             → `{ profiles }` — every entered member, screenname order.
 * GET ?user=<u>   → `{ profile }` — one member (404 when they never entered).
 * POST `{ owner?, statusLine?, aboutMe?, avatar? }` → update `owner`'s profile
 *   (defaults to the caller). The store enforces owner-or-admin, caps, avatar
 *   normalization and ledger logging — the route only maps identities on.
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import { getProfile, listProfiles, updateProfile, type ProfilePatch } from "@axs/modules/amberxvid/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await memberUser(req))) return unauthorized();

  const user = req.nextUrl.searchParams.get("user");
  if (user) {
    const profile = await getProfile(user);
    if (!profile) {
      return NextResponse.json({ ok: false, error: "no such module member" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, profile });
  }
  return NextResponse.json({ ok: true, profiles: await listProfiles() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const actor = await memberUser(req);
  if (!actor) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  const owner = typeof body.owner === "string" && body.owner.trim() ? body.owner.trim() : actor;
  const patch: ProfilePatch = {};
  if (typeof body.statusLine === "string") patch.statusLine = body.statusLine;
  if (typeof body.aboutMe === "string") patch.aboutMe = body.aboutMe;
  if ("avatar" in body) patch.avatar = body.avatar; // spec to set, null to clear

  const result = await updateProfile(actor, owner, patch);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, profile: result.profile });
}

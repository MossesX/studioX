/**
 * @file `/api/amberxvid/invite/[token]` — **the module's one unauthenticated
 * door**, and it is token-gated rather than open (P7).
 *
 * Every other `/api/amberxvid/*` route begins with `requireMember`. This one
 * cannot: the person on the other end has no account yet, which is the whole
 * point of an invitation. So the token IS the authentication, and everything
 * this route will do is bounded by what one invitation says.
 *
 * GET  → `{ invite }` — who invited, to what, and until when. Nothing else.
 * POST → `{ action: "signup" | "signin", username, password, screenname? }`
 *
 * ## Four properties this route is built around
 *
 * 1. **Every dead token answers identically.** Forged, expired, spent,
 *    revoked, from a deleted inviter, or from somebody who has blocked you —
 *    one sentence, one status. `INVITE_DEAD` in `lib/inviteContract.ts` says
 *    why (relations rule 1: a probe that can tell "blocked" from "gone" has
 *    defeated the silence), and the engine returns it; the route does not
 *    reshape it.
 * 2. **Credentials go through the accounts door, never around it.** The
 *    password is proven by `verifyLogin` — the same scrypt compare, the same
 *    dummy-hash burn for an unknown name — inside `redeemInvite`, where the
 *    guarantee cannot be skipped by a second caller. The session cookie is
 *    `issueAxsSession` with the same attributes `/api/accounts/session` sets;
 *    a second cookie recipe here would be a second session system, which is
 *    the thing P1 deleted.
 * 3. **The account is created before the session, and the grant before the
 *    arrival.** The engine owns that ordering (`redeemInvite`); the route's
 *    only sequencing decision is that a failed redemption issues NO cookie.
 * 4. **A screenname may be chosen right here.** Optional, and offered because
 *    a newcomer with none lands in the suite's `screenname` step instead of in
 *    the room they were invited to — technically correct, and precisely the
 *    "straight into the room" the phase gate is about. Refusing a taken
 *    screenname does not fail the redemption: the account and the membership
 *    are already real, and the suite will ask again.
 */

import { NextResponse, type NextRequest } from "next/server";
import { setScreenname, verifyLogin } from "@axs/modules/accounts/lib/accounts";
import {
  AXS_SESSION_COOKIE,
  AXS_SESSION_HOURS,
  issueAxsSession,
} from "@axs/modules/accounts/lib/session";
import { describeInvite, redeemInvite } from "@axs/modules/amberxvid/lib/invites";
import { ARRIVAL_PARAM, encodeArrival } from "@axs/modules/amberxvid/lib/inviteContract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === "string" ? (body[key] as string) : "";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;
  const result = await describeInvite(token);
  return result.ok
    ? NextResponse.json({ ok: true, invite: result.invite })
    : NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "expected a JSON body" }, { status: 400 });
  }

  const mode = str(body, "action") === "signin" ? "signin" : "signup";
  const username = str(body, "username").trim();
  const password = str(body, "password");

  // The password is proven inside `redeemInvite` — for BOTH modes, before the
  // invitation is consumed. Deliberately not repeated here: a check the route
  // owns is a check the next route forgets, and the thing being protected
  // (attaching an invitation to a named account) lives in the engine.
  const redeemed = await redeemInvite({ token, mode, username, password });
  if (!redeemed.ok) {
    return NextResponse.json({ ok: false, error: redeemed.error }, { status: redeemed.status });
  }

  // The account now exists (signup) or has been proven (signin), so this is
  // the studio's ordinary sign-in from here on.
  const authed = await verifyLogin(redeemed.username, password);
  if (!authed.ok) {
    return NextResponse.json({ ok: false, error: authed.error }, { status: authed.status });
  }

  const notes = [...redeemed.notes];
  const wantedName = str(body, "screenname").trim();
  if (wantedName && !authed.account.screenname) {
    const named = await setScreenname(authed.account.username, wantedName);
    // Not fatal, by design — see property 4 in the header.
    if (!named.ok) notes.push(`That screenname could not be used (${named.error}) — pick another inside.`);
  }

  const arrival = encodeArrival(redeemed.arrival);
  const res = NextResponse.json({
    ok: true,
    username: authed.account.username,
    created: redeemed.created,
    arrival: redeemed.arrival,
    /** Where the landing sends the browser. One place composes it. */
    next: arrival ? `/amberxvid?${ARRIVAL_PARAM}=${encodeURIComponent(arrival)}` : "/amberxvid",
    notes,
  });
  res.cookies.set(AXS_SESSION_COOKIE, issueAxsSession(authed.account), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: AXS_SESSION_HOURS * 3600,
  });
  return res;
}

/**
 * @file `/api/amberxvid/turn-credentials` — the session-gated minting route
 * of the `ICE_CONTRACT` (P8): each call fetches a fresh, short-TTL coturn
 * `use-auth-secret` pair plus the full env-driven ICE server list (STUN
 * always, the VPS TURN relay when the secret is configured). The shared HMAC
 * secret lives in server env only (`AMBERXVID_TURN_SECRET`) — what leaves
 * this route is the ephemeral pair, dead by its own embedded expiry.
 *
 * Same gate as the rest of the module: a signed-in AmberX Vid session —
 * relay minutes are member-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import { iceServersFor } from "@axs/modules/amberxvid/lib/turn";
import type { TurnCredentialsResponse } from "@axs/modules/amberxvid/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) {
    return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
  }

  const { iceServers, turnConfigured, ttlS, expiry } = iceServersFor(me);
  const body: TurnCredentialsResponse = {
    ok: true,
    iceServers,
    turnConfigured,
    ttlS,
    expiresAt: expiry === null ? new Date(Date.now() + ttlS * 1000).toISOString() : new Date(expiry * 1000).toISOString(),
  };
  // Credentials are per-call and short-lived — never cache them anywhere.
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

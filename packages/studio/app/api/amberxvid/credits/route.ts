/**
 * @file `/api/amberxvid/credits` — the meter, over HTTP (P18).
 *
 * GET  → the caller's {@link creditsView}: balance + recent ledger, every
 *        registered meter and its price, whether metering is on, and whether
 *        this member can buy.
 * POST `{ meter, units?, detail? }` → charge the caller for one metered thing.
 *
 * **A member may only ever charge THEMSELVES here**, and there is no `user`
 * parameter to say otherwise. A route that let one member spend another's
 * credits would be the whole ledger's integrity resting on a client field.
 *
 * The refusals are two different numbers on purpose (see `chargeMeter`): 403 is
 * "you are not allowed to", 402 is "you are allowed to and cannot afford it".
 * They are different conversations — one with an administrator about
 * permissions, one about credits — and collapsing them is how a member ends up
 * asking for a grant they already have.
 *
 * Double-gated like every route in this module: a studio session AND the
 * permission matrix (`requireMember`), so a revoked member is refused on their
 * very next request rather than at cookie expiry.
 */

import { NextResponse, type NextRequest } from "next/server";

import { chargeMeter, creditsView } from "@axs/modules/amberxvid/lib/credits";
import { requireMember } from "@axs/modules/amberxvid/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireMember(req);
  if ("deny" in gate) return gate.deny;
  return NextResponse.json({ ok: true, ...(await creditsView(gate.user)) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireMember(req);
  if ("deny" in gate) return gate.deny;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "the body must be JSON" }, { status: 400 });
  }

  const meter = typeof body.meter === "string" ? body.meter.trim() : "";
  if (!meter) return NextResponse.json({ ok: false, error: "a charge names a meter" }, { status: 400 });

  const units = typeof body.units === "number" ? body.units : 1;
  const detail = typeof body.detail === "string" ? body.detail.slice(0, 200) : undefined;

  // The verdict IS the body — it already carries `ok`, and re-spreading one in
  // front of it would let the two disagree.
  const charge = await chargeMeter(gate.user, meter, units, detail);
  return NextResponse.json(charge, { status: charge.ok ? 200 : charge.status });
}

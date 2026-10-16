/**
 * @file `/api/amberxvid/credits/buy` — the checkout hand-off, and the honest
 * absence of one (P18).
 *
 * GET                        → {@link purchaseAvailability}: can this member
 *                              buy, and if not, the sentence explaining which
 *                              of the two reasons applies.
 * POST `{ credits }`         → start a checkout: mint a reference, hand back
 *                              the processor's URL. **Credits nothing.**
 * POST `{ ref, credits, complete: true }`
 *                            → the RETURN leg: money arrived, credit the
 *                              ledger once.
 *
 * ## What this route is not
 *
 * It is not a payment processor and it does not pretend to be one. With
 * `AMBERXVID_PAYMENTS_URL` unset, every path here answers **501 with a
 * sentence**, and the buy surface renders that sentence with nothing clickable
 * beside it. There is no card form anywhere in this module, no "coming soon"
 * button, and no path that credits a ledger without a processor having been
 * configured — a UI that looks like it takes money and does not is the one
 * failure mode where somebody eventually types a real card number into it.
 *
 * ## The verification that is missing, named rather than faked
 *
 * `complete: true` credits the ledger on the caller's say-so. That is correct
 * for a hand-off shape and wrong for a real processor, and the difference is a
 * SIGNATURE CHECK that belongs right here, before `completeCheckout`, when a
 * processor exists to verify against. Until then the honest description of this
 * endpoint is: gated to the signed-in member, gated to a configured processor,
 * and trusting the return leg. Written down so the next session adds the check
 * instead of discovering the gap in production.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  completeCheckout,
  purchaseAvailability,
  startCheckout,
} from "@axs/modules/amberxvid/lib/credits";
import { requireMember } from "@axs/modules/amberxvid/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireMember(req);
  if ("deny" in gate) return gate.deny;
  return NextResponse.json({ ok: true, purchase: await purchaseAvailability(gate.user) });
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

  const credits = Number(body.credits);

  if (body.complete === true) {
    const ref = typeof body.ref === "string" ? body.ref.trim() : "";
    if (!ref) {
      return NextResponse.json(
        { ok: false, error: "a completed checkout carries the reference it was started with" },
        { status: 400 },
      );
    }
    // SIGNATURE CHECK GOES HERE when a processor exists — see the docblock.
    const done = await completeCheckout(gate.user, credits, ref);
    if (!done.ok) return NextResponse.json({ ok: false, error: done.error }, { status: done.status });
    return NextResponse.json({ ok: true, balance: done.balance, ref });
  }

  const started = await startCheckout(gate.user, credits);
  if (!started.ok) {
    return NextResponse.json({ ok: false, error: started.error }, { status: started.status });
  }
  return NextResponse.json({ ok: true, ref: started.ref, url: started.url, credits: started.credits });
}

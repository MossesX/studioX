/**
 * @file `/api/amberxvid/invites` — a member's own invitations (P7).
 *
 * Member-gated on both verbs, and there is no `?user=` anywhere: every
 * operation is the caller's own row by construction, so there is no parameter
 * to check and none to get wrong. The PUBLIC half of invites — describing a
 * token and redeeming it — lives at `/api/amberxvid/invite/[token]`, which is
 * unauthenticated on purpose and separated for exactly that reason.
 *
 * GET → `{ invites, delivery, canInvite }`
 *   `delivery` is `inviteDeliveryStatus()`: whether email leaves the server or
 *   opens in the member's own mail app. It is answered here rather than
 *   guessed in the dialog, because only the server can see the env var.
 *   `canInvite` is the policy row's live verdict, so the dialog can say WHY
 *   the create button is off instead of merely disabling it.
 *
 * POST `{ action }`:
 *   `create { channel, handle?, targetKind?, targetId?, buddy?, note? }`
 *   `revoke { id }`
 *
 * The link's origin comes from the REQUEST (`req.nextUrl.origin`), never from
 * a configured base URL: an invitation reached over the dev server, over the
 * tunnel and over amberxai.com must each carry the host it was minted on, and
 * a configured constant is exactly the setting that is right in production and
 * wrong for the person testing it.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireMember } from "@axs/modules/amberxvid/lib/membership";
import { assertCanSendInvites } from "@axs/modules/amberxvid/lib/policy";
import {
  createInvite,
  inviteDeliveryStatus,
  listInvites,
  revokeInvite,
} from "@axs/modules/amberxvid/lib/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const str = (body: Record<string, unknown>, key: string): string =>
  typeof body[key] === "string" ? (body[key] as string) : "";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireMember(req);
  if ("deny" in gate) return gate.deny;

  const policy = await assertCanSendInvites(gate.user);
  return NextResponse.json({
    ok: true,
    invites: listInvites(gate.user),
    delivery: inviteDeliveryStatus(),
    canInvite: policy.ok,
    // The refusal's own sentence, which names the policy row and tells the
    // member who to ask. A disabled button with no reason is an admin ticket.
    why: policy.ok ? null : policy.error,
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireMember(req);
  if ("deny" in gate) return gate.deny;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "expected a JSON body" }, { status: 400 });
  }
  const action = str(body, "action");

  if (action === "create") {
    const result = await createInvite(gate.user, req.nextUrl.origin, {
      channel: str(body, "channel") as "link" | "internal" | "email" | "sms",
      handle: str(body, "handle") || null,
      targetKind: str(body, "targetKind"),
      targetId: str(body, "targetId"),
      buddy: body.buddy === true,
      note: str(body, "note") || null,
    });
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({
      ok: true,
      invite: result.invite,
      url: result.url,
      delivery: result.delivery,
      invites: listInvites(gate.user),
    });
  }

  if (action === "revoke") {
    const result = revokeInvite(gate.user, str(body, "id"));
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    return NextResponse.json({ ok: true, invite: result.invite, invites: listInvites(gate.user) });
  }

  return NextResponse.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });
}

/**
 * @file `/api/amberxvid/reports` — where a *Report* row lands (P17).
 *
 * The one moderation route that is NOT an administrator's: any signed-in
 * member holding the amberxvid grant may file, because reporting is the
 * affordance that lets a member reach the moderators at all. Everything a
 * moderator then DOES about it is `/api/amberxvid/moderation`, behind
 * `requireMemberAdmin`.
 *
 * POST `{ subject: { kind, owner, id, parent?, excerpt? }, reason }`
 *   → `{ ok, report }`. Idempotent per (reporter, subject) while the report is
 *   open — a double-click gets the same row back, never a second one.
 *
 * GET → `{ ok, reports }`, the caller's OWN filed reports, so the member who
 *   reported something can see it was received. It is deliberately not a view
 *   of anybody else's: who reported whom is exactly the information a queue has
 *   to hold and must not publish.
 */

import { NextRequest, NextResponse } from "next/server";

import { requireMember } from "@axs/modules/amberxvid/lib/membership";
import { fileReport, listReports } from "@axs/modules/amberxvid/lib/reports";
import type { ReportSubject } from "@axs/modules/amberxvid/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await requireMember(req);
  if ("deny" in gate) return gate.deny;
  return NextResponse.json({ ok: true, reports: listReports({ reporter: gate.user }) });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await requireMember(req);
  if ("deny" in gate) return gate.deny;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  // The subject is validated by the store, not here — one validator, in the
  // place that also normalises it, so a route cannot accept a shape the store
  // would have refused.
  const subject = body.subject as ReportSubject;
  const reason = typeof body.reason === "string" ? body.reason : "";

  const result = await fileReport(gate.user, { subject, reason });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, report: result.report });
}

/**
 * @file `/api/amberxvid/admin` — the P9 admin control window's API.
 *
 * Double-gated through `requireMemberAdmin`: a signed-in STUDIO session
 * (`axs_session`, the accounts module's — there is no `axv_session` any more)
 * that holds the amberxvid grant, AND an accounts role of `administrator`.
 * Both halves are re-read from the accounts stores on EVERY request by
 * `effectivePermissions`, so a demotion or a revoked grant takes effect
 * immediately, not at the next login. Account CRUD
 * beyond this route (add-user / reset-password) stays on
 * `/api/amberxvid/accounts`; profile and album management ride their own
 * routes as the admin actor (`resolveActor`). This route owns what only P9
 * needs:
 *
 * GET → `AdminOverview` — accounts (flags + provenance, no credentials),
 *   presence roster, per-thread message stats, per-member album totals,
 *   per-member recording totals (the admin is the only role that sees another
 *   member's captures at all).
 * POST `{ action, … }`:
 *   - `update-user`         { username, role?, disabled? }
 *   - `remove-user`         { username }  → row + data cascade (threads stay)
 *   - `delete-thread`       { threadId }
 *   - `prune-messages`      { olderThanDays } (0 = everything)
 *   - `delete-user-threads` { username }
 *   - `delete-recordings`   { username? } → one member's captures, or the
 *       whole library when the username is omitted. Open captures are skipped
 *       (their engine still owns them), everything finished is gone for good.
 *
 * THE THREE MESSAGE ACTIONS ACT ON THE ACCOUNTS STORE (P6, 2026-08-15). This
 * module's own message store retired that phase, so they are the accounts
 * store's own admin verbs — which hold their own `requireAdmin` gate, meaning
 * the actor is checked twice by two systems that agree. Two consequences worth
 * knowing before reading the answers:
 *   - `delete-user-threads` reports `threadsLeft` as well as `threadsDeleted`:
 *     a DM is deleted outright as it always was, but a GROUP the member was not
 *     the last of survives and they are removed from it. Four other people's
 *     history is not one member's to take with them.
 *   - `prune-messages` no longer deletes a conversation it emptied. That is the
 *     accounts store's posture, and it is the right one now that a thread can
 *     be a shared room: a retention sweep must not evict anybody.
 *
 * Roster-visible mutations (disable/enable/remove) broadcast a fresh presence
 * roster so every open buddy list flips in the same moment.
 */

import { NextRequest, NextResponse } from "next/server";
import { AMBERXVID_MODULE_ID, requireMemberAdmin } from "@axs/modules/amberxvid/lib/membership";
import { setModuleGrant } from "@axs/modules/accounts/lib/permissions";
import { adminOverview, removeUserData } from "@axs/modules/amberxvid/lib/admin";
import {
  deleteThread,
  deleteUserThreads,
  pruneMessages,
} from "@axs/modules/accounts/lib/messages";
import { purgeRecordings } from "@axs/modules/amberxvid/lib/recordings";
import { broadcastAll, presenceSnapshot } from "@axs/modules/amberxvid/lib/presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The acting administrator, or a refusal response.
 *
 * P1 collapsed a hand-rolled five-condition check into `requireMemberAdmin`,
 * which asks the permission matrix. The role is the STUDIO role and is re-read
 * from the account store per request, so a demotion binds immediately — a
 * 24 h token outlives a demotion, this does not.
 *
 * Two of the old conditions deliberately did NOT survive: `mustChangePassword`
 * and "has no screenname" no longer bar an administrator here, because the
 * accounts module already refuses an admin mid-entry-flow at its own gate
 * (`gateAdmin`), and re-deciding another module's entry policy from a second
 * place is how the two answers drift apart.
 */
async function adminActor(req: NextRequest): Promise<{ actor: string } | { deny: NextResponse }> {
  const gate = await requireMemberAdmin(req);
  return "deny" in gate ? gate : { actor: gate.user };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const gate = await adminActor(req);
  if ("deny" in gate) return gate.deny;
  return NextResponse.json({ ok: true, overview: await adminOverview() });
}

/** Disable/enable/remove change who the roster shows — push the flip live. */
async function broadcastRoster(): Promise<void> {
  broadcastAll({ type: "roster", roster: await presenceSnapshot() });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const gate = await adminActor(req);
  if ("deny" in gate) return gate.deny;
  const { actor } = gate;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  const str = (k: string): string => (typeof body[k] === "string" ? (body[k] as string) : "");

  switch (str("action")) {
    // Role and enabled/disabled are STUDIO-WIDE facts now, not module ones —
    // a demotion here would have to mean a demotion everywhere, and a module
    // admin surface is the wrong place to decide that. 410 with the address,
    // so a stale bundle is told what happened instead of getting a puzzle.
    case "update-user":
    case "add-user":
    case "reset-password":
      return NextResponse.json(
        {
          ok: false,
          error: `"${str("action")}" is a studio account operation — use POST /api/accounts/users`,
          movedTo: `POST /api/accounts/users { action: '${str("action")}' }`,
        },
        { status: 410 },
      );

    // Removing someone from AMBERX VID, which is not the same act as deleting
    // their studio account and must not be conflated with it. It is a grant
    // revocation — the matrix's own operation, so the admin suite shows it
    // beside every other revocation and can undo it — plus this module's data
    // cascade. Deleting the account itself is /api/accounts/users.
    case "remove-member": {
      const username = str("username").trim();
      if (!username) {
        return NextResponse.json({ ok: false, error: "username is required" }, { status: 400 });
      }
      const revoked = await setModuleGrant(actor, username, AMBERXVID_MODULE_ID, false);
      if (!revoked.ok) {
        return NextResponse.json({ ok: false, error: revoked.error }, { status: revoked.status });
      }
      const cascaded = await removeUserData(actor, revoked.username);
      await broadcastRoster();
      return NextResponse.json({ ok: true, cascaded, overview: await adminOverview() });
    }

    case "remove-user":
      return NextResponse.json(
        {
          ok: false,
          error:
            "\"remove-user\" split in two: use \"remove-member\" here to remove someone from AmberX Vid, or POST /api/accounts/users to delete their studio account",
          movedTo: "POST /api/amberxvid/admin { action: 'remove-member' }",
        },
        { status: 410 },
      );

    case "delete-thread": {
      const result = await deleteThread(actor, str("threadId"));
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      }
      return NextResponse.json({
        ok: true,
        messagesRemoved: result.messagesRemoved,
        overview: await adminOverview(),
      });
    }

    case "prune-messages": {
      const days = typeof body.olderThanDays === "number" ? body.olderThanDays : NaN;
      if (!Number.isFinite(days) || days < 0) {
        return NextResponse.json(
          { ok: false, error: "olderThanDays must be a number ≥ 0 (0 prunes everything)" },
          { status: 400 },
        );
      }
      const result = await pruneMessages(actor, { olderThanDays: days });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      }
      // `ok` is dropped rather than spread: the store's own `ok: true` would
      // land AFTER this response's and silently decide the envelope.
      const { ok: _pruned, ...stats } = result;
      return NextResponse.json({ ok: true, ...stats, overview: await adminOverview() });
    }

    case "delete-user-threads": {
      const username = str("username").trim();
      if (!username) {
        return NextResponse.json({ ok: false, error: "username is required" }, { status: 400 });
      }
      const result = await deleteUserThreads(actor, username);
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
      }
      const { ok: _wiped, ...stats } = result;
      return NextResponse.json({ ok: true, ...stats, overview: await adminOverview() });
    }

    case "delete-recordings": {
      const username = str("username").trim();
      const purged = await purgeRecordings(actor, username || null);
      return NextResponse.json({ ok: true, ...purged, overview: await adminOverview() });
    }

    default:
      return NextResponse.json({ ok: false, error: `unknown action "${str("action")}"` }, { status: 400 });
  }
}

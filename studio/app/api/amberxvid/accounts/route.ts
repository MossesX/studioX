/**
 * @file `/api/amberxvid/accounts` — the suite's ROSTER, and the one door that
 * is genuinely the module's own: joining it.
 *
 * ## What left, and where it went (P1, `axf-amberxvid-social`, 2026-08-14)
 *
 * This route used to be an authentication spine: it minted `axv_session`,
 * verified module passwords, ran the forced-entry flow and carried two admin
 * actions. All of that is gone, because the module has no account store and no
 * session of its own any more — there is ONE identity system and it is the
 * accounts module's.
 *
 * | Was here | Is now at |
 * |---|---|
 * | `login`, `logout`, `change-password`, `set-screenname` | `POST /api/accounts/session` |
 * | `add-user`, `reset-password` | `POST /api/accounts/users` |
 *
 * Those actions answer **410 Gone** with the address rather than 400 "unknown
 * action". A stale client — a cached bundle, another tab, a proof script — is
 * then told what happened instead of being handed a puzzle, which is the
 * posture the house already takes for retired endpoints.
 *
 * ## What stayed, and why it is still here
 *
 * **GET** — the `AccountsSnapshot` the module's entry screen and `lib/viewer`
 * render from. It is the composite the client would otherwise assemble from
 * two calls to two modules, and assembling it here keeps "am I a member" and
 * "who else is a member" answered by the same read.
 *
 * **POST `join`** — self-serve membership. It belongs to amberxvid rather than
 * to the matrix because the POLICY is the module's (`openMembership()`), while
 * the OPERATION is the matrix's (`requestModuleGrant`) and is called, never
 * reimplemented. That split is the point: the grant lands in `permissions.json`
 * like any other, so the admin suite sees the join and can revoke it with the
 * same switch it uses for everything else.
 */

import { NextRequest, NextResponse } from "next/server";
import { listAccounts, toMe, toPublic } from "@axs/modules/amberxvid/lib/accounts";
import {
  AMBERXVID_MODULE_ID,
  isMember,
  openMembership,
} from "@axs/modules/amberxvid/lib/membership";
import { countForcedResets, findAccount } from "@axs/modules/accounts/lib/accounts";
import { requestModuleGrant } from "@axs/modules/accounts/lib/permissions";
import { axsUser } from "@axs/modules/accounts/lib/session";
import type { AccountsSnapshot } from "@axs/modules/amberxvid/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where each retired action moved to — the body of its 410. */
const MOVED: Record<string, string> = {
  login: "POST /api/accounts/session { action: 'login' }",
  logout: "POST /api/accounts/session { action: 'logout' }",
  "change-password": "POST /api/accounts/session { action: 'change-password' }",
  "set-screenname": "POST /api/accounts/session { action: 'set-screenname' }",
  "add-user": "POST /api/accounts/users { action: 'add-user' }",
  "reset-password": "POST /api/accounts/users { action: 'reset-password' }",
};

/**
 * The snapshot.
 *
 * Three states, and the client draws a different card for each: signed out
 * (`signedIn:false`), signed in but not a member (`signedIn:true, me:null,
 * notMember:true`), and a member. The middle one did not exist before — one
 * cookie could only say yes or no — and it is the state the join card lives in.
 *
 * The roster only ever leaves the server for a member: who else uses the suite
 * is member-only information, and a signed-in non-member is not a member.
 */
async function snapshot(user: string | null): Promise<AccountsSnapshot> {
  if (!user) return { signedIn: false, me: null, accounts: [], notMember: false };

  const account = await findAccount(user);
  // The cookie outlived the account, or the account was disabled since.
  if (!account || account.disabled === true) {
    return { signedIn: false, me: null, accounts: [], notMember: false };
  }
  if (!(await isMember(account.username))) {
    return {
      signedIn: true,
      me: null,
      accounts: [],
      notMember: true,
      canJoin: openMembership(),
    };
  }

  const members = await listAccounts();
  const mine = members.find((a) => a.username.toLowerCase() === account.username.toLowerCase());
  if (!mine) return { signedIn: true, me: null, accounts: [], notMember: true, canJoin: false };
  return {
    signedIn: true,
    me: toMe(mine),
    accounts: members.map(toPublic),
    notMember: false,
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const snap = await snapshot(axsUser(req));
  // A COUNT, never a list and never per-username: the login card shows it so a
  // migrated member understands why their old password does not work, and a
  // per-username answer on a screen anyone can reach would be an
  // account-enumeration oracle.
  const pendingResets = await countForcedResets();
  return NextResponse.json({ ...snap, pendingResets });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  const action = typeof body.action === "string" ? body.action : "";

  const movedTo = MOVED[action];
  if (movedTo) {
    return NextResponse.json(
      {
        ok: false,
        error: `AmberX Vid no longer has its own accounts — use ${movedTo}`,
        movedTo,
      },
      { status: 410 },
    );
  }

  if (action !== "join") {
    return NextResponse.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });
  }

  const user = axsUser(req);
  if (!user) return NextResponse.json({ ok: false, error: "sign in first" }, { status: 401 });

  // The module's policy gate, in front of the matrix's operation. Checked here
  // and not inside `requestModuleGrant`, because "is this module open to
  // self-serve joining" is not something the matrix can know about a module.
  if (!openMembership()) {
    return NextResponse.json(
      { ok: false, error: "AmberX Vid membership is by invitation — ask an administrator" },
      { status: 403 },
    );
  }

  const result = await requestModuleGrant(user, AMBERXVID_MODULE_ID);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, ...(await snapshot(user)) });
}

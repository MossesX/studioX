/**
 * @file **The studio's front door** — no page renders without a session.
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts` and made the Node.js runtime
 * its default, which is what makes this file possible at all: the session
 * verdict is an HMAC over a machine secret read from disk
 * (`src/modules/accounts/lib/session.ts`), so an Edge-runtime gate would have
 * had to re-implement the token format against a copy of the secret — a second
 * spelling of the one thing that must never have two.
 *
 * ## Why the gate is here and not in a layout
 *
 * `app/layout.tsx` could read the same cookie and render a login card instead
 * of `children`, and it would look the same on screen. It would not BE the
 * same: the page's server components would already have run to produce those
 * children, so every module's data loading happens before the check that says
 * the visitor may not see it. Proxy runs before routes are rendered, so an
 * unauthenticated request costs one cookie verify and a redirect, and no
 * module code observes it at all.
 *
 * ## What it gates, and what it deliberately leaves alone
 *
 * PAGES. Every route the matcher below admits — which is every navigation
 * except the signed-out allow-list (`lib/publicPaths.ts`), Next's own assets,
 * and files in `public/`.
 *
 * NOT `/api/*`. Those routes each carry their own gate (`requireSession` and
 * the per-module equivalents), and several are reached by callers that have no
 * cookie to offer: the tray service, the hotkey plugin, the `.newtask.`
 * capture curl in `CLAUDE.md`. A blanket API gate here would break those while
 * proving nothing the routes do not already prove for themselves.
 *
 * ## The account is re-read, not trusted from the token
 *
 * A signature check alone would let a deleted or disabled account keep opening
 * pages for the remaining life of a 24 h cookie. The accounts module's stated
 * posture is that the store is the authority and the token's claims are
 * advisory (`lib/accounts.ts`), so the gate follows it: one small JSON read per
 * navigation, and a disable binds on the very next page. The redirect also
 * clears the dead cookie, so the visitor pays for that lookup once rather than
 * on every request afterwards.
 */
import { NextResponse, type NextRequest } from "next/server";

import { findAccount } from "@axs/modules/accounts/lib/accounts";
import { LOGIN_PATH, isPublicPath } from "@axs/modules/accounts/lib/publicPaths";
import {
  AXS_SESSION_COOKIE,
  AXS_SESSION_HOURS,
  issueAxsSession,
  verifyAxsSession,
} from "@axs/modules/accounts/lib/session";
import { DEV_USER_ENV, devAuthUser } from "@axs/modules/accounts/lib/devAuth";
import { loginLandingRoute } from "@axs/x-landing/catalog";

/**
 * Where a signed-out visitor is sent.
 *
 * The `login`-role `x_landing` asset if one is declared (owner, 2026-08-15 —
 * "everyone should see the same login landing page"), otherwise the bare
 * `/login` screen. The asset declares the route; nothing here spells it, so the
 * front door moves by editing the landing rather than by editing the gate.
 *
 * The `??` is not decoration. `publicPaths.ts` warns that getting this route
 * wrong is "a lock-out with no way back in", so `/login` — which has always
 * worked and still renders the same sign-in card — remains the floor. If the
 * landing is ever deleted, renamed or has its role removed, the gate degrades
 * to the screen it used before instead of redirecting into a 404.
 */
const GATE_PATH = loginLandingRoute() ?? LOGIN_PATH;

/** Send them to the front door, remembering where they were headed. */
function toLogin(req: NextRequest, dropCookie: boolean): NextResponse {
  const url = req.nextUrl.clone();
  url.pathname = GATE_PATH;
  url.search = "";
  const from = `${req.nextUrl.pathname}${req.nextUrl.search}`;
  // `/` is where login lands by default, so saying so in the URL adds nothing.
  if (from !== "/") url.searchParams.set("next", from);
  const res = NextResponse.redirect(url);
  if (dropCookie) res.cookies.set(AXS_SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  if (isPublicPath(req.nextUrl.pathname)) return NextResponse.next();

  const payload = verifyAxsSession(req.cookies.get(AXS_SESSION_COOKIE)?.value);
  if (!payload) {
    /*
     * Development auto-login (owner, 2026-08-15). `devAuthUser()` answers null
     * in production ALWAYS and unless `AXF_DEV_USER` is set, so the normal path
     * below is what a real deployment runs — see `lib/devAuth.ts` for all three
     * conditions.
     *
     * This MINTS a real session rather than waving the request through: a
     * bypass would pass the page gate while `requireSession()` on every
     * `/api/*` route still refused and `kvUser()` still resolved to the
     * signed-out bucket, which is a half-signed-in app that fails in ways that
     * look like real bugs.
     *
     * The account is looked up rather than assumed, so the token carries the
     * REAL role — an auto-login that invented `administrator` would hand the
     * developer a permission set nobody actually has, and the admin surfaces
     * would then be tested against a fiction.
     */
    const devUser = devAuthUser();
    if (devUser) {
      const devAccount = await findAccount(devUser);
      if (devAccount && devAccount.disabled !== true) {
        const res = NextResponse.next();
        res.cookies.set(AXS_SESSION_COOKIE, issueAxsSession(devAccount), {
          httpOnly: true,
          path: "/",
          sameSite: "lax",
          maxAge: AXS_SESSION_HOURS * 3600,
        });
        return res;
      }
      // Named an account that does not exist or is disabled: fall through to the
      // real gate. Signing in a fiction would be worse than asking.
      console.error(
        `[accounts] ${DEV_USER_ENV}="${devUser}" names no enabled account — falling back to the sign-in gate.`
      );
    }
    return toLogin(req, false);
  }

  const account = await findAccount(payload.u);
  if (!account || account.disabled === true) return toLogin(req, true);

  return NextResponse.next();
}

export const config = {
  /**
   * Everything except Next's internals and static files.
   *
   * `_next` covers the build output AND dev's HMR socket; the trailing
   * extension clause covers `public/` (`favicon.ico`, images, fonts), which
   * would otherwise redirect to the login screen and leave a signed-out page
   * unstyled and iconless. `api` is excluded for the reason in the header.
   */
  matcher: ["/((?!api/|_next/|.*\\.[^/]*$).*)"],
};

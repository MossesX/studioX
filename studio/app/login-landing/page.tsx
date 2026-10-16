/**
 * @file /login-landing route — a full-viewport login landing page: a brand
 * banner across the top and an animated logo glowing in the background behind a
 * translucent sign-in card.
 *
 * The route is on the signed-out allow-list (`accounts/lib/publicPaths.ts`): a
 * landing page behind the session gate would redirect every visitor to /login
 * and could never be seen.
 *
 * ## `?preview=1` — the DESIGN state, for a viewer who is signed in
 *
 * The landing's whole point is what a signed-OUT visitor sees, and by
 * construction nobody designing it is signed out. Rendered normally to a signed-in
 * viewer, `LoginScreen` finds a session and immediately
 * `location.replace`s to that person's role landing — so the theme designer's
 * Surfaces preview showed the admin dashboard rather than the screen being
 * designed. That is not a preview of anything.
 *
 * `?preview=1` renders the same chrome around a plain signed-out card and skips
 * the navigation entirely. It is read HERE, on the server, and passed down as a
 * prop rather than sniffed from `window` in the client component: the server and
 * the client must agree on which of the two things they are rendering, or the
 * first paint is one and the hydration is the other.
 *
 * It grants nothing and reveals nothing — it is the signed-out card, which is
 * what the whole route already serves to anybody who asks.
 */
import LoginLandingScreen from "./LoginLandingScreen";

export default async function LoginLandingPage({
  searchParams
}: {
  searchParams: Promise<{ preview?: string }>;
}) {
  const { preview } = await searchParams;
  return <LoginLandingScreen preview={preview === "1"} />;
}

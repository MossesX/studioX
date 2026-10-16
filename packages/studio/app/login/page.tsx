/**
 * @file `/login` — the studio's front door, and the one page the gate lets a
 * signed-out visitor render.
 *
 * `proxy.ts` sends every unauthenticated navigation here with `?next=` naming
 * where they were going; this page signs them in and puts them back. It is a
 * ROUTE rather than something the gate rewrites in place because the address
 * bar should say what the screen is: a rewrite would leave a login form sitting
 * at `/buildmgr`, and a reload of that URL would look like the app had lost the
 * page rather than the session.
 *
 * It renders `LoginCard` — the same component `/accounts` shows when its own
 * state says signed out — so there is exactly one login form in the studio.
 */
import LoginScreen from "@axs/modules/accounts/LoginScreen";

export default function LoginPage() {
  return <LoginScreen />;
}

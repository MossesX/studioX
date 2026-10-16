/**
 * @file `/amberxvid/invite/<token>` — the invitation landing.
 *
 * **The one page in AmberX Vid a signed-out stranger is meant to reach.**
 * Every other surface in the module begins with `BootedHost` and a membership
 * gate; this one cannot, because the person opening it has no account yet.
 * What stands in for the gate is the token in the path: the screen shows
 * nothing until `/api/amberxvid/invite/<token>` says the token is live, and
 * the screen can do nothing that one invitation does not authorise.
 *
 * The route stays a three-line delegation like every other: the shell (from
 * `app/layout.tsx`) draws the banner and the nav, and `InviteLanding` is the
 * whole of the page.
 */
import InviteLanding from "@axs/modules/amberxvid/InviteLanding";

export default async function AmberXVidInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <InviteLanding token={token} />;
}

/**
 * @file `/settings` — the app settings page. Branding pack selection lives
 * here (owner, 2026-08-12: branding is a global app setting, never part of a
 * theme). A route, not a registered asset, for the same reason /brand and
 * /theme-designer are routes: it configures this install rather than shipping
 * with a peeled app.
 *
 * Chrome — style root, MUI provider, banner, nav, dashboard wrapper — is all
 * `StudioShell`'s, mounted once in `app/layout.tsx`. This page renders content
 * only, which is why it mounts no provider and is themed anyway.
 */
import SettingsPage from "../../src/plugins/settings/SettingsPage";

export const dynamic = "force-dynamic";

export default function Settings() {
  return <SettingsPage />;
}

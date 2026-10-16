/**
 * @file `/project-state` — the project-state plugin's surface.
 *
 * A route and not a module for the reason `/diff`, `/docs` and `/settings`
 * are: it reads THIS install's session history rather than shipping with a
 * peeled app, and it owns no state and no workflow that would earn one of the
 * twelve suite slots (§4.6). Deliberately not in either nav (the plan's own
 * ruling: nav real estate is not this plugin's to claim) — it is reached at
 * this URL directly.
 *
 * Chrome — style root, MUI provider, banner, nav — is all `StudioShell`'s,
 * mounted once in `app/layout.tsx`. This page renders content only.
 */
import ProjectStateScreen from "../../src/plugins/project-state/ProjectStateScreen";

export default function ProjectStatePage() {
  return <ProjectStateScreen />;
}

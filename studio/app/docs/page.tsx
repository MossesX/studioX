/**
 * @file `/docs` — the project documentation.
 *
 * A route, not a registered asset, for the same reason `/brand`,
 * `/settings` and `/theme-designer` are routes: it documents THIS install
 * rather than shipping with a peeled app. Making it a module would spend one
 * of the twelve suite slots on a page that fails §4.6's first clause — it owns
 * no state and no workflow that nothing else owns.
 *
 * Chrome — style root, MUI provider, banner, nav, dashboard wrapper — is all
 * `StudioShell`'s, mounted once in `app/layout.tsx`. This page renders content
 * only, which is why it mounts no provider and is themed anyway.
 */
import DocsPlugin from "../../src/plugins/docs/DocsPlugin";

export const dynamic = "force-dynamic";

export default function DocsPage() {
  return <DocsPlugin />;
}

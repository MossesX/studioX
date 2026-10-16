/**
 * @file `/diff` — the difference browser, full width.
 *
 * Restored by `axf-claude` P5 with the plugin it mounts. It is a route and not
 * a module for the same reason `/docs`, `/brand` and `/settings` are: it reads
 * THIS install's history rather than shipping with a peeled app, and it owns no
 * state and no workflow that would earn one of the twelve suite slots (§4.6).
 * What changed at P5 is that the browser is no longer *unwired* — it reaches
 * the Claude workspace through `claude-workspace.panel`, and this page is the
 * surface where an eight-column grid actually fits.
 *
 * `.claude/rules/diff-browser-trigger.md` (`.diff.`) points here, and pointed
 * here through the whole period the route did not exist — the rule carried a
 * stale-note header saying so, which P5 removes.
 *
 * Chrome — style root, MUI provider, banner, nav — is all `StudioShell`'s,
 * mounted once in `app/layout.tsx`. This page renders content only.
 */
import DiffBrowser from "../../src/plugins/diff-browser/DiffBrowser";

export const dynamic = "force-dynamic";

/** `?file=<folder>` picks the tracked file. The panel's "open the full browser"
 *  button passes it, so the grid opens on what the pane was showing rather than
 *  on whatever the default happens to be. */
export default async function DiffPage({
  searchParams
}: {
  searchParams: Promise<{ file?: string }>;
}) {
  const { file } = await searchParams;
  return <DiffBrowser file={file || "PLANNING-STATE"} />;
}

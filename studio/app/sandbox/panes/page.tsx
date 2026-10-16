/**
 * @file /sandbox/panes — the pane renderer's verification surface. `?fresh`
 * renders without a storageKey so the geometry probe can assert first paint
 * against declared weights with no persisted latch in the way.
 *
 * Restored in P2 (2026-08-10) alongside `src/plugins/pane-probe/`. The rest of
 * `/sandbox` was stripped at P0 and stays stripped; this one route came back
 * because `scripts/geometry-probe.mjs` defaults to it and P2 rebuilt
 * `PaneLayout` on MUI under an explicit requirement to report measured pane
 * sizes rather than assert that they look right.
 */
import PaneProbe from "../../../src/plugins/pane-probe/PaneProbe";

export const dynamic = "force-dynamic";

export default async function PanesPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <PaneProbe fresh={params.fresh !== undefined} />;
}

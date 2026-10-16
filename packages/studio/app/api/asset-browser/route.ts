/**
 * @file `GET /api/asset-browser` — the on-disk half of the graphical catalog.
 *
 * A thin translation over `disk.server.ts`, the way every route in this package
 * stays thin over its `.server.ts`: the route speaks HTTP, the engine speaks
 * filesystem.
 *
 * It answers about the two `asset-registry` kinds only (`logo_kit`,
 * `x_landing`). The packs and the chrome assets are IN-MEMORY registries the
 * client already holds, and the screen joins the two halves — neither side
 * alone is the catalog, exactly as `/api/plugins` and the plugin roster split.
 *
 * `force-dynamic` because the answer is the filesystem's current state; a
 * cached one would tell a person their regenerated asset had not landed.
 */
import { readDisk } from "../../../src/modules/asset-browser/disk.server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    return Response.json(readDisk());
  } catch (e) {
    // `readDisk` is written not to throw — every read inside it degrades to a
    // note. This is the backstop for what it cannot foresee, and it names the
    // failure rather than answering with an empty catalog, which would read as
    // "there are no assets".
    return Response.json(
      { error: e instanceof Error ? e.message : "the asset catalog could not be read" },
      { status: 500 }
    );
  }
}

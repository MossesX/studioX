/**
 * @file The **disk half** of the catalog — what `assets/registry.json` and the
 * installed tree say about the two `asset-registry` kinds.
 *
 * `node:fs` lives here and nowhere else in the module; `app/api/asset-browser/
 * route.ts` is a thin translation over it, the way every route in this package
 * stays thin over its `.server.ts` (`plugins/plugin-manager/engine.server.ts`
 * is the precedent).
 *
 * ## Why the browser needs a server at all
 *
 * Only one of P0's three lifecycles touches the filesystem. Packs and chrome
 * assets are IN-MEMORY registries the client already holds, and asking a server
 * about them would mean re-deriving in Node what `packs` / `toolbars` / `navs`
 * already know — a second answer to a settled question, which is the exact
 * failure `kinds.ts` was written to prevent. So the split follows the
 * lifecycles: `catalog.ts` composes cards from the live registries client-side
 * and joins THIS report onto the two kinds that have a disk existence.
 *
 * What lives only here, and is the reason the route exists: the registry row
 * (is it enabled?), whether the archive zip and the installed directory are
 * actually THERE, and the generator's content signature. A card that claimed a
 * zip existed because a manifest named one would be inventing a file.
 *
 * ## Degrade, never crash
 *
 * A browser over an installed tree meets a broken install eventually — a
 * manifest half-written by an interrupted generator, a registry row pointing at
 * a directory somebody moved. Every such fact becomes a NOTE on the asset (or
 * on the report) and the read continues. One bad asset must not blank the
 * screen for the others, and a manager that hides breakage is worse than one
 * that shows it.
 */
import fs from "node:fs";
import path from "node:path";

import { AXF_ROOT } from "../../server/paths";
import type { DiskAsset, DiskNote, DiskOrphan, DiskReport } from "./wire";

/**
 * The kinds that have a registry row, a zip and an installed dir.
 *
 * The other five are in-memory registries the CLIENT holds — see `catalog.ts`,
 * which states why asking a server about them would be a second answer to a
 * settled question.
 */
const DISK_KINDS = new Set(["logo_kit", "x_landing"]);

/** Repo-relative, forward-slashed — what a note or a card should show. */
function rel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

/** JSON or null. Never throws — the caller turns `null` into a note. */
function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
}

function exists(abs: string): boolean {
  try {
    return fs.existsSync(abs);
  } catch {
    return false;
  }
}

/** A registry row, read defensively — every field may be missing or wrong. */
interface Row {
  id?: unknown;
  kind?: unknown;
  name?: unknown;
  version?: unknown;
  created?: unknown;
  enabled?: unknown;
  archive?: unknown;
  installed?: unknown;
  meta?: { summary?: unknown; authored_by?: unknown } | unknown;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Read the registry and the installed tree, and report what they agree and
 * disagree about.
 *
 * Both are walked because neither alone is the truth: the registry knows the
 * enable switch and would miss an asset installed but never registered; the
 * disk holds the manifest the previews are built from and would miss a row
 * whose directory has been moved.
 *
 * `root` is an ARGUMENT rather than the module-scope constant it started as,
 * and the reason is worth keeping: `AXF_ROOT` is resolved once at import and
 * `paths.ts` is cached, so an engine that closed over it could only ever be
 * driven against the real tree. The degrade-never-crash property above is a
 * claim about broken trees — which means it can only be proven by planting one,
 * which means the root has to be passable. `test/asset-browser-disk.test.ts`
 * is what that bought; the route calls this with no argument and gets the real
 * root.
 *
 * The assets tree is already a declared runtime group — `asset-ledger`
 * (`assets/registry.json`) and `installed-assets` (`assets/installed/**`) in
 * `deploy/runtime-files.mjs` — so these reads ship with the image; nothing new
 * needs declaring and nothing here needs an exemption.
 */
export function readDisk(root: string = AXF_ROOT): DiskReport {
  const notes: DiskNote[] = [];
  const assets: DiskAsset[] = [];

  const ASSETS = path.join(root, "assets");
  const REGISTRY = path.join(ASSETS, "registry.json");

  const doc = readJson(REGISTRY) as { assets?: unknown } | null;
  const registryOk = doc !== null;
  if (!registryOk) {
    notes.push({
      level: "error",
      path: rel(root, REGISTRY),
      message:
        "the asset registry could not be read or is not JSON — every registered asset is missing " +
        "from this report, which is a fact about the registry rather than about the assets"
    });
  }

  const rows: Row[] = Array.isArray(doc?.assets) ? (doc?.assets as Row[]) : [];
  if (registryOk && !Array.isArray(doc?.assets)) {
    notes.push({
      level: "error",
      path: rel(root, REGISTRY),
      message: "the registry parsed but has no `assets` array — nothing could be listed from it"
    });
  }

  /** Which `<kind>/<id>` pairs the registry claims, for the orphan walk. */
  const claimed = new Set<string>();

  for (const row of rows) {
    const id = str(row.id);
    const kind = str(row.kind);
    if (!id || !kind || !DISK_KINDS.has(kind)) continue;
    claimed.add(`${kind}/${id}`);

    const perAsset: DiskNote[] = [];

    const installedRel = str(row.installed);
    const installedAbs = installedRel ? path.join(ASSETS, installedRel) : null;
    const installedPresent = installedAbs !== null && exists(installedAbs);
    if (installedRel && !installedPresent) {
      perAsset.push({
        level: "error",
        assetId: id,
        path: rel(root, installedAbs as string),
        message: "the registry names an installed directory that is not on disk"
      });
    }

    const archiveRel = str(row.archive);
    const archiveAbs = archiveRel ? path.join(ASSETS, archiveRel) : null;
    const archivePresent = archiveAbs !== null && exists(archiveAbs);
    if (archiveRel && !archivePresent) {
      perAsset.push({
        level: "warn",
        assetId: id,
        path: rel(root, archiveAbs as string),
        message: "the registry names an archive zip that is not on disk"
      });
    }

    let manifest: unknown = null;
    if (installedPresent) {
      const file = path.join(installedAbs as string, "manifest.json");
      manifest = readJson(file);
      if (manifest === null) {
        perAsset.push({
          level: "error",
          assetId: id,
          path: rel(root, file),
          message: "the installed manifest is missing or does not parse"
        });
      }
    }

    const m = (manifest ?? {}) as Record<string, unknown>;
    const meta = (row.meta ?? {}) as Record<string, unknown>;

    assets.push({
      id,
      kind,
      // The registry's name, falling back to the manifest's, falling back to
      // the id. A card with a blank title is one nobody can talk about.
      name: str(row.name) ?? str(m.name) ?? id,
      version: str(row.version) ?? str(m.version) ?? "",
      // Absent means enabled: a row with no switch is not a disabled asset, and
      // reading it as one would hide half the catalog on an older registry.
      enabled: row.enabled !== false,
      installed: installedRel,
      installedPresent,
      archive: archiveRel,
      archivePresent,
      created: str(row.created),
      authoredBy: str(m.authored_by) ?? str(meta.authored_by),
      signature: str(m.signature),
      manifest,
      notes: perAsset
    });
  }

  /* ------------------------------------------------------------- orphans */

  const orphans: DiskOrphan[] = [];
  for (const kind of DISK_KINDS) {
    const dir = path.join(ASSETS, "installed", kind);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      // A kind with nothing installed has no directory. That is the normal
      // empty case, not a fault, so it earns no note.
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (claimed.has(`${kind}/${e.name}`)) continue;
      const abs = path.join(dir, e.name);
      orphans.push({ kind, id: e.name, path: rel(root, abs) });
      notes.push({
        level: "warn",
        assetId: e.name,
        path: rel(root, abs),
        message:
          "installed on disk with no registry row — the framework cannot see it, so nothing " +
          "resolves it by id"
      });
    }
  }

  for (const a of assets) notes.push(...a.notes);

  return {
    generatedAt: new Date().toISOString(),
    registry: { path: rel(root, REGISTRY), ok: registryOk },
    assets,
    orphans,
    notes
  };
}

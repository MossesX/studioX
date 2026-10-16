/**
 * @file The shared authoring ENGINE for generated (framework-authored) assets.
 *
 * `logo_kit` and `x_landing` assets must be authored by the framework and never
 * by hand (owner directive, 2026-08-15). This module is that author. Both
 * generators are the same lifecycle over different content, so the lifecycle
 * lives here once and each generator supplies only what is type-specific —
 * spelled twice it would drift, and a drifting authoring engine is the exact
 * hazard the directive exists to close.
 *
 * The lifecycle is AmberX's own (`scripts/pack.mjs`, INITIATION §4), not
 * GizmoX's, and keeps its strongest property: **the installed dir is extracted
 * FROM the zip**, never copied from the staging dir, so what is installed is
 * provably what the archive holds.
 *
 *   staging dir → zip → assets/archive/<kind>/<id>-<version>.zip
 *               → extract → assets/installed/<kind>/<id>/
 *               → registry entry, under the shared lock
 *               → re-read all three OFF DISK before claiming success
 *
 * `--check` writes nothing and exits non-zero if any on-disk asset drifts from
 * what this engine would produce (missing/altered manifest, wrong signature,
 * missing zip, stale registry entry). That is the gate that makes a hand-edit
 * loud instead of silent; the conformance tests assert the same invariants.
 *
 * Build-time only — ships nothing of itself. Zero dependencies.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { assetsRoot, getAsset, registerAsset, registryPath } from "./registry-store.mjs";
import { extractZip, listFilesRelative, readZipMemberNames, zipDir } from "./zip.mjs";

/**
 * Run the generator for one asset type.
 *
 * @param {object} spec
 * @param {string}   spec.type      asset kind, e.g. `"logo_kit"` — also the
 *                                  archive/installed subdirectory name.
 * @param {string}   spec.script    the entry script's name, for messages.
 * @param {any[]}    spec.sources   the framework-authored input list.
 * @param {(input: any) => any}    spec.define    the validating chokepoint.
 * @param {(asset: any) => string} spec.sign      the content signature.
 * @param {(asset: any, signature: string) => object} spec.manifest
 *                                  the manifest body to write.
 * @param {(asset: any) => object} [spec.registryMeta] extra `meta` fields.
 * @param {(asset: any) => string} [spec.describe]  one-line success detail.
 * @param {boolean}  spec.check     verify only, write nothing.
 * @returns {number} process exit code.
 */
export function generateAssets(spec) {
  const { type, script, sources, define, sign, manifest, check } = spec;
  const root = assetsRoot();
  const problems = [];
  const built = [];

  for (const input of sources) {
    // `define` throws on any breach, naming the asset and the exact rule. An
    // invalid source is a build failure, in check mode as much as in write mode.
    let asset;
    try {
      asset = define(input);
    } catch (err) {
      problems.push(`${input?.id ?? "?"}: ${String(err?.message ?? err)}`);
      continue;
    }

    const signature = sign(asset);
    const zipRel = `archive/${type}/${asset.id}-${asset.version}.zip`;
    const zipAbs = path.join(root, ...zipRel.split("/"));
    const installedRel = `installed/${type}/${asset.id}`;
    const installedAbs = path.join(root, ...installedRel.split("/"));
    const manifestJson = JSON.stringify(manifest(asset, signature), null, 2) + "\n";

    built.push({ asset, signature, zipRel, zipAbs, installedRel, installedAbs, manifestJson });
  }

  if (problems.length) {
    console.error(`${script}: source assets do not validate:\n  - ${problems.join("\n  - ")}`);
    return 1;
  }

  // -------------------------------------------------------------------------
  // check mode — compare disk against what this engine would produce
  // -------------------------------------------------------------------------
  if (check) {
    for (const b of built) {
      const manifestPath = path.join(b.installedAbs, "manifest.json");
      if (!fs.existsSync(manifestPath)) {
        problems.push(`${b.asset.id}: manifest missing at ${path.relative(root, manifestPath)}`);
        continue;
      }
      const onDiskRaw = fs.readFileSync(manifestPath, "utf8");
      let onDisk;
      try {
        onDisk = JSON.parse(onDiskRaw);
      } catch (err) {
        problems.push(`${b.asset.id}: installed manifest is not valid JSON (${err.message})`);
        continue;
      }
      /*
       * Compare the WHOLE manifest, not just the stored `signature` field.
       *
       * Checking the field alone is a hole big enough to drive the directive
       * through: a hand-edit that changes a logo's name and leaves `signature`
       * untouched passes, because the stored value still equals the one
       * recomputed from source. Mutation-tested — renaming `logos[0].name` on
       * disk was reported as "matches disk" until this compared content.
       * (GizmoX's `scripts/gen-logo-kit.ts --check` still has that hole.)
       */
      if (onDiskRaw !== b.manifestJson) {
        const fields = new Set([...Object.keys(onDisk), ...Object.keys(JSON.parse(b.manifestJson))]);
        const expected = JSON.parse(b.manifestJson);
        const differing = [...fields].filter(
          (k) => JSON.stringify(onDisk[k]) !== JSON.stringify(expected[k])
        );
        problems.push(
          `${b.asset.id}: installed manifest DIFFERS from what ${script} would write` +
            (differing.length ? ` (field(s): ${differing.join(", ")})` : " (formatting only)") +
            `. A logo kit or landing is never hand-edited; re-run the generator instead.`
        );
      } else if (onDisk.signature !== b.signature) {
        problems.push(
          `${b.asset.id}: signature drift — disk ${onDisk.signature ?? "(none)"} vs expected ${b.signature}`
        );
      }
      if (!fs.existsSync(b.zipAbs)) problems.push(`${b.asset.id}: archive zip missing at ${b.zipRel}`);
      const entry = getAsset(b.asset.id, root);
      if (!entry) problems.push(`${b.asset.id}: no registry entry`);
      else {
        if (entry.kind !== type) problems.push(`${b.asset.id}: registry kind "${entry.kind}" ≠ "${type}"`);
        if (entry.version !== b.asset.version) {
          problems.push(`${b.asset.id}: registry version ${entry.version} ≠ ${b.asset.version}`);
        }
      }
    }
    if (problems.length) {
      console.error(`${script} --check FAILED:\n  - ${problems.join("\n  - ")}`);
      return 1;
    }
    console.log(`✓ ${script} --check: ${built.length} ${type} asset(s) match disk`);
    return 0;
  }

  // -------------------------------------------------------------------------
  // write mode
  // -------------------------------------------------------------------------
  for (const b of built) {
    // 1. staging — the generated source tree this asset is packaged FROM.
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), `axf-${type}-${b.asset.id}-`));
    try {
      fs.writeFileSync(path.join(staging, "manifest.json"), b.manifestJson, "utf8");

      // 2. zip
      const zipped = zipDir(staging, b.zipAbs, {
        onRetry: (n, why) => console.warn(`  zip attempt ${n} failed (${why}) — retrying`)
      });

      // 3. install, by extracting THE ZIP
      fs.rmSync(b.installedAbs, { recursive: true, force: true });
      const extracted = extractZip(b.zipAbs, b.installedAbs);

      // 4. registry, under the shared lock
      registerAsset(
        {
          id: b.asset.id,
          kind: type,
          name: b.asset.name,
          version: b.asset.version,
          archive: b.zipRel,
          installed: b.installedRel,
          enabled: true,
          layer: "sdk",
          meta: {
            summary: b.asset.description,
            authored_by: "framework",
            signature: b.signature,
            generator: `scripts/${script}`,
            ...(spec.registryMeta ? spec.registryMeta(b.asset) : {})
          }
        },
        root
      );

      // 5. verification duty — re-read off disk, never assert
      const verify = [];
      if (!fs.existsSync(b.zipAbs)) verify.push(`archive missing on disk: ${b.zipRel}`);
      const members = readZipMemberNames(b.zipAbs);
      for (const rel of listFilesRelative(staging)) {
        if (!members.includes(rel)) verify.push(`archive is missing ${rel}`);
      }
      for (const rel of members) {
        if (!fs.existsSync(path.join(b.installedAbs, ...rel.split("/")))) {
          verify.push(`installed dir is missing ${rel}`);
        }
      }
      let installedManifest = null;
      try {
        installedManifest = JSON.parse(fs.readFileSync(path.join(b.installedAbs, "manifest.json"), "utf8"));
      } catch {
        verify.push("installed dir has no readable manifest.json");
      }
      if (installedManifest && installedManifest.signature !== b.signature) {
        verify.push(`installed manifest signature ${installedManifest.signature} ≠ ${b.signature}`);
      }
      const entry = getAsset(b.asset.id, root);
      if (!entry) verify.push(`registry has no entry for "${b.asset.id}" after registration`);
      else {
        if (entry.archive !== b.zipRel) verify.push(`registry archive is ${entry.archive}, expected ${b.zipRel}`);
        if (entry.installed !== b.installedRel) {
          verify.push(`registry installed is ${entry.installed}, expected ${b.installedRel}`);
        }
      }
      if (verify.length) {
        for (const v of verify) console.error(`  ${v}`);
        console.error(`${script}: ${b.asset.id} FAILED verification — do not trust this asset's lifecycle`);
        return 1;
      }

      const detail = spec.describe ? spec.describe(b.asset) : "";
      console.log(
        `✓ ${b.asset.id} "${b.asset.name}" (${type} v${b.asset.version})${detail ? ` — ${detail}` : ""}\n` +
          `    archive   ${b.zipRel} · ${zipped.members} member(s), ${zipped.bytes} bytes\n` +
          `    installed ${b.installedRel} · ${extracted.length} file(s) extracted from the zip\n` +
          `    registry  ${path.relative(process.cwd(), registryPath(root)) || registryPath(root)} · enabled=${entry.enabled}\n` +
          `    signature ${b.signature}`
      );
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  return 0;
}

/**
 * The ONE zipper for AmberX asset archives — create with verification, extract
 * in pure Node. Ported from GizmoX `src/lib/server/assets/zip-pack.ts` (§9
 * rule: port known fixes with the code, or rediscover them the hard way).
 *
 * ## The fix that travels with this file
 *
 * `Compress-Archive -Path '<dir>\*'` compresses top-level items ONE AT A TIME,
 * closing and reopening the destination between each. If anything touches the
 * freshly-closed zip during a reopen — a virus scanner, the indexer, a sync
 * client — the cmdlet reports a NON-terminating error, exits 0, and leaves a
 * perfectly valid archive containing only the items compressed so far.
 * GizmoX shipped a brand pack with 214 of its 455 members this way, under a
 * clean "success". A truncated archive is indistinguishable from a good one by
 * exit code or existence — only a member-by-member diff against the source
 * tree catches it. So this helper:
 *
 *   1. runs with `$ErrorActionPreference='Stop'` so that class of failure
 *      becomes terminating and non-zero;
 *   2. reads the finished archive's central directory and diffs its member set
 *      against the source tree — the actual proof;
 *   3. retries the whole zip on failure, because the trigger is transient.
 *
 * Extraction is pure Node (central directory → local headers → inflateRawSync)
 * rather than Expand-Archive, so the install step does not inherit a second
 * PowerShell failure surface — and every extracted member is a byte count we
 * verified, not a cmdlet's word.
 *
 * Framework tooling: zero dependencies, `node:fs` + `node:zlib` only.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

/**
 * Zip the *contents* of `srcDir` (archive root = the asset's own files, not a
 * wrapper folder) into `zipPath`, then prove the result holds the whole tree.
 * Returns `{ bytes, members, attempts }`; throws when it cannot.
 */
export function zipDir(srcDir, zipPath, { retries = 3, onRetry } = {}) {
  const expected = listFilesRelative(srcDir);
  if (expected.length === 0) {
    throw new Error(`zip: ${srcDir} contains no files — nothing to archive`);
  }

  fs.mkdirSync(path.dirname(zipPath), { recursive: true });

  let lastReason = "";
  for (let attempt = 1; attempt <= retries; attempt++) {
    // Always start from nothing: a leftover partial archive is a candidate
    // for ZipArchiveMode::Update to append to rather than replace.
    discard(zipPath);

    const reason = attemptZip(srcDir, zipPath, expected);
    if (reason === null) {
      return { bytes: fs.statSync(zipPath).size, members: expected.length, attempts: attempt };
    }
    lastReason = reason;
    if (attempt < retries) onRetry?.(attempt, reason);
  }

  discard(zipPath);
  throw new Error(`zip: failed to archive ${srcDir} after ${retries} attempt(s): ${lastReason}`);
}

/**
 * Best-effort delete. Swallows everything on purpose: the failure this module
 * exists to catch is CAUSED by something else holding the archive, so an
 * EPERM/EBUSY here is a symptom, not the error worth reporting — and at the
 * top of the retry loop it would abort the very retry that recovers.
 */
function discard(zipPath) {
  try {
    fs.rmSync(zipPath, { force: true });
  } catch {
    /* held by a scanner or an editor — see above */
  }
}

/** One zip + verify cycle. Returns `null` on success or a failure reason. */
function attemptZip(srcDir, zipPath, expected) {
  const psCommand =
    `$ErrorActionPreference='Stop'; ` +
    `Compress-Archive -Path '${q(srcDir)}\\*' -DestinationPath '${q(zipPath)}' -Force`;
  const res = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand], {
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (res.error) return `Compress-Archive could not be launched: ${res.error.message}`;
  if (res.status !== 0) {
    const stderr = res.stderr?.toString().trim().replace(/\s+/g, " ").slice(0, 400);
    return `Compress-Archive exited ${res.status ?? `signal ${res.signal}`}${stderr ? `: ${stderr}` : ""}`;
  }
  if (!fs.existsSync(zipPath)) return "Compress-Archive exited 0 but wrote no archive";

  let members;
  try {
    members = readZipMemberNames(zipPath);
  } catch (err) {
    return `archive is unreadable: ${err.message}`;
  }

  const present = new Set(members);
  const missing = expected.filter((rel) => !present.has(rel));
  if (missing.length > 0) {
    return (
      `archive is truncated — ${expected.length - missing.length}/${expected.length} members ` +
      `(missing e.g. ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? `, +${missing.length - 3} more` : ""})`
    );
  }
  return null;
}

/**
 * Extract every member of `zipPath` into `destDir` (created if needed) and
 * return the member names written. Pure Node: walks the central directory,
 * reads each local header for its data offset, inflates (or copies stored
 * bytes), and verifies each member's uncompressed size landed exactly.
 */
export function extractZip(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  const entries = readCentralDirectory(buf);
  const root = path.resolve(destDir);
  const written = [];

  for (const entry of entries) {
    if (entry.name.endsWith("/")) continue; // directory marker
    // Zip-slip guard: a member must land inside destDir, full stop.
    const dest = path.resolve(root, entry.name);
    if (!dest.startsWith(root + path.sep)) {
      throw new Error(`zip member escapes the destination: ${entry.name}`);
    }

    const local = entry.localOffset;
    if (buf.readUInt32LE(local) !== 0x04034b50) {
      throw new Error(`bad local header for ${entry.name}`);
    }
    const nameLen = buf.readUInt16LE(local + 26);
    const extraLen = buf.readUInt16LE(local + 28);
    const dataStart = local + 30 + nameLen + extraLen;
    const compressed = buf.subarray(dataStart, dataStart + entry.compressedSize);

    let data;
    if (entry.method === 0) data = compressed;
    else if (entry.method === 8) data = zlib.inflateRawSync(compressed);
    else throw new Error(`unsupported compression method ${entry.method} for ${entry.name}`);

    if (data.length !== entry.uncompressedSize) {
      throw new Error(
        `${entry.name} inflated to ${data.length} bytes, central directory says ${entry.uncompressedSize}`
      );
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    written.push(entry.name);
  }
  return written.sort();
}

/** File member names from the central directory, `/`-separated. */
export function readZipMemberNames(zipPath) {
  return readCentralDirectory(fs.readFileSync(zipPath))
    .map((e) => e.name)
    .filter((n) => !n.endsWith("/"))
    .sort();
}

/** Every file under `dir`, as `/`-separated paths relative to it. */
export function listFilesRelative(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childAbs = path.join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(childAbs, childRel);
      else if (entry.isFile()) out.push(childRel);
    }
  };
  walk(dir, "");
  return out.sort();
}

/** Escape a single quote for a PowerShell single-quoted string literal. */
function q(value) {
  return value.replace(/'/g, "''");
}

/* ------------------------------- zip parsing ------------------------------- */

/**
 * Parse the central directory: name, method, sizes, local header offset per
 * member. Read here rather than shelled out to so that verification never
 * depends on the same process that produced the archive. Handles ZIP64 for
 * the record locations; asset zips saturating 32-bit member sizes would be a
 * different problem than any this tooling has.
 */
function readCentralDirectory(buf) {
  const eocd = findSignatureFromEnd(buf, 0x06054b50, 22);
  if (eocd < 0) throw new Error("no end-of-central-directory record (not a zip?)");

  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64 — the 16/32-bit fields saturate past 65535 members or 4 GiB.
  if (count === 0xffff || cdOffset === 0xffffffff) {
    const locator = findSignatureFromEnd(buf, 0x07064b50, 20, eocd);
    if (locator < 0) throw new Error("zip64 archive without an end-of-central-directory locator");
    const zip64Eocd = Number(buf.readBigUInt64LE(locator + 8));
    if (buf.readUInt32LE(zip64Eocd) !== 0x06064b50) throw new Error("bad zip64 end-of-central-directory");
    count = Number(buf.readBigUInt64LE(zip64Eocd + 32));
    cdOffset = Number(buf.readBigUInt64LE(zip64Eocd + 48));
  }

  const entries = [];
  let at = cdOffset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) {
      throw new Error(`central directory ends after ${i} of ${count} declared members`);
    }
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    entries.push({
      name: buf.toString("utf8", at + 46, at + 46 + nameLen).replace(/\\/g, "/"),
      method: buf.readUInt16LE(at + 10),
      compressedSize: buf.readUInt32LE(at + 20),
      uncompressedSize: buf.readUInt32LE(at + 24),
      localOffset: buf.readUInt32LE(at + 42)
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Scan backwards for a 4-byte little-endian signature. */
function findSignatureFromEnd(buf, signature, minTail, before) {
  const start = Math.min(before ?? buf.length, buf.length) - minTail;
  for (let i = start; i >= 0; i--) {
    if (buf.readUInt32LE(i) === signature) return i;
  }
  return -1;
}

/**
 * @file `GET /api/health` — is this process able to serve, and is its storage
 * actually there?
 *
 * A health check that only proves the event loop is running is a check that
 * stays green through the failure it exists to catch. The one thing that can be
 * wrong about this container and nothing else — the §2.2 ephemeral-filesystem
 * trap — is the persisted volume: not mounted, mounted read-only, or mounted at
 * a path the app is not pointed at. In every one of those the app boots
 * perfectly and quietly loses each write. So the check WRITES.
 *
 * `probe.tmp` is written and removed under the persisted root on every call.
 * That is a syscall pair per check, which is cheap next to what it proves:
 * green here means this process can persist, not merely that it answered.
 *
 * Deliberately unauthenticated, and deliberately thin on detail. It reports
 * whether storage works and what version is running — nothing about accounts,
 * sessions or configuration — because behind Traefik this is the one route
 * reachable before the basic-auth prompt, and a health endpoint that leaks the
 * install's shape is a reconnaissance endpoint with a friendly name.
 *
 * `force-dynamic` because a cached health check is not a health check.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { AXF_CORE_VERSION } from "@axf/core";

import { dataRoot } from "../../../src/server/dataRoot";

export const dynamic = "force-dynamic";

/** Prove the persisted root is writable, and leave nothing behind. */
async function storageWritable(): Promise<{ ok: boolean; error?: string }> {
  const probe = path.join(dataRoot(), ".health-probe");
  try {
    await fs.mkdir(dataRoot(), { recursive: true });
    await fs.writeFile(probe, String(Date.now()), "utf8");
    await fs.rm(probe, { force: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "write failed" };
  }
}

export async function GET(): Promise<Response> {
  const storage = await storageWritable();
  return Response.json(
    {
      ok: storage.ok,
      version: AXF_CORE_VERSION,
      // The path, not its contents — an operator debugging a bad mount needs to
      // see WHICH directory the app believes it is persisting to, and that is
      // the single most common thing to have wrong.
      dataRoot: dataRoot(),
      storage
    },
    { status: storage.ok ? 200 : 503 }
  );
}

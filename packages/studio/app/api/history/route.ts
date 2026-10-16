/**
 * @file `/api/history` — the difference browser's data source.
 *
 *   GET /api/history              → { root, tracked: TrackedFile[] }
 *   GET /api/history?file=<name>  → { root, file, tracked, instances }
 *
 * Instances come back oldest-first with the LIVE file appended last, so the
 * rightmost column is always the current document rather than the most recent
 * backup. That ordering is the point of the whole browser: you read left to
 * right and arrive at what the file is now.
 *
 * Restored by `axf-claude` P5 with the plugin it serves. Two changes from the
 * pre-strip original, both consequences of `history.ts` discovering the tracked
 * folders instead of hardcoding one: the no-argument form now answers the
 * ROSTER (which is what the workspace panel needs, and what saves it a second
 * route), and the live file is resolved per folder rather than looked up in a
 * one-entry map.
 *
 * Every path is checked against the history root before it is opened. The route
 * takes a folder name, never a path, so there is nothing to traverse with — and
 * `withinHistory` is the second layer behind the `basename`, because the day
 * someone adds a caller that forgets the basename is the day the first layer is
 * all there was.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  HISTORY_ROOT,
  isSnapshot,
  trackedFiles,
  withinHistory
} from "../../../src/plugins/diff-browser/history";

export const dynamic = "force-dynamic";

interface Instance {
  id: string;
  label: string;
  text: string;
  bytes: number;
  live?: boolean;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const tracked = trackedFiles();
  const asked = url.searchParams.get("file");

  // The roster form. A panel that only wants "what is there" should not have to
  // read thirteen documents to find out.
  if (!asked) {
    return Response.json({ root: HISTORY_ROOT, tracked });
  }

  const name = path.basename(asked);
  const folder = path.join(HISTORY_ROOT, name);
  if (!withinHistory(folder)) {
    return Response.json({ error: "outside the history root" }, { status: 400 });
  }

  let entries: string[] = [];
  try {
    entries = (await readdir(folder)).filter(isSnapshot).sort();
  } catch {
    // Not a 404: "this folder has no snapshots" is a state the browser renders,
    // and an error status would make the client's own empty state unreachable.
    return Response.json({ error: `no history at ${folder}`, root: HISTORY_ROOT, tracked, instances: [] });
  }

  const instances: Instance[] = [];
  for (const file of entries) {
    const full = path.join(folder, file);
    try {
      const [text, info] = await Promise.all([readFile(full, "utf8"), stat(full)]);
      instances.push({
        id: file,
        // Snapshots are named <date>_<time>_pre-merge.md — show the stamp only.
        label: file.replace(/_pre-merge\.md$/, "").replace(/\.md$/, ""),
        text,
        bytes: info.size
      });
    } catch {
      /* a file that vanished between readdir and read is not worth failing on */
    }
  }

  const live = tracked.find((t) => t.name === name)?.live;
  if (live) {
    try {
      const [text, info] = await Promise.all([readFile(live, "utf8"), stat(live)]);
      instances.push({ id: "live", label: "current", text, bytes: info.size, live: true });
    } catch {
      /* the tracked file may have been deleted since the scan */
    }
  }

  return Response.json({ root: HISTORY_ROOT, file: name, tracked, instances });
}

"use client";

/**
 * @file What the difference browser's composer action actually does — kept OUT
 * of `plugin.ts` for the resolver reason stated there: a `plugin.ts` may hold
 * packages and `import type` and nothing else, because plain Node's ESM
 * resolver does not do extensionless relative specifiers and the closure
 * resolver imports that file under plain Node.
 */
import { workspaceUi } from "../../modules/claude-workspace/ui";

import { fetchInstances } from "./client";
import { buildModel } from "./engine";
import { diffSelection } from "./selection";

/** How many lines the quote carries before it is truncated with a note. A
 *  prompt is not a place to paste nine hundred lines, and a silent cut is worse
 *  than a loud one. */
const QUOTE_LINES = 80;

/**
 * The lines the newest revision of the selected file introduced, as a fenced
 * block ready to be asked a question about.
 *
 * Returning `undefined` is the point's contract for "the action did its work
 * elsewhere" — here, leaving the draft alone rather than inserting an empty
 * fence. Each of those branches SAYS SO through the module's UI channel first:
 * a button that silently does nothing is what that contract must not hide.
 */
export async function quoteNewestChange(): Promise<string | undefined> {
  const file = diffSelection.get();
  let instances;
  try {
    instances = (await fetchInstances(file)).instances ?? [];
  } catch (err) {
    workspaceUi.say(
      `Could not read ${file}'s history: ${err instanceof Error ? err.message : String(err)}`
    );
    return undefined;
  }
  if (instances.length < 2) {
    workspaceUi.say(`${file} has fewer than two revisions — there is nothing to compare.`);
    return undefined;
  }

  const model = buildModel([...instances]);
  const last = model.instances.length - 1;
  const label = model.instances[last]?.label ?? "current";
  const added = model.rows
    .map((r) => r.cells[last])
    .filter((c) => c && c.vsPrev === "added" && c.text.trim())
    .map((c) => c!.text);
  if (!added.length) {
    workspaceUi.say(`The newest revision of ${file} introduced nothing.`);
    return undefined;
  }

  const shown = added.slice(0, QUOTE_LINES);
  const tail =
    added.length > shown.length ? `\n… ${added.length - shown.length} further line(s) omitted` : "";
  return `Lines introduced by the newest revision of ${file} (${label}):\n\n\`\`\`\n${shown.join("\n")}${tail}\n\`\`\`\n`;
}

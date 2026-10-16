"use client";

/**
 * @file What Agent Forge's composer action actually does — kept OUT of
 * `plugin.ts` so that file stays resolvable.
 *
 * `scripts/lib/closure.mjs` imports every `plugin.ts` under plain Node, and
 * plain Node's ESM resolver does not do extensionless relative specifiers. So a
 * `plugin.ts` may hold `import type` (erased) and packages (resolvable), and
 * nothing else — a single value import of a sibling `.ts` makes the plugin
 * unresolvable and `npm run suite` refuses to write the closure. That is not a
 * hypothetical: it is what this file was created in response to, after the gate
 * went red naming both plugins.
 *
 * The fix is a DYNAMIC import in the action's body. It is never evaluated by
 * the resolver, it is code-split at runtime for free, and it puts the rule in
 * one obvious place instead of relying on everyone remembering it.
 */
import { session } from "../../modules/claude-workspace/session";
import { workspaceUi } from "../../modules/claude-workspace/ui";

import { fetchPersonaContext, readBinding } from "./client";

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The bound persona, compiled the same way the context provider compiles it,
 * for insertion at the composer's caret.
 *
 * This exists because binding is FIRST-TURN ONLY — a resumed session already
 * carries its history and the broker ignores `system` under `--resume`. So a
 * conversation already under way cannot be given a persona through the
 * contract, and pasting the identical text into one message is the honest
 * second-best. Identical, not a paraphrase: both halves go through
 * `composePersonaContext`, so what the reader pastes is what a fresh
 * conversation would have received.
 *
 * Every branch ends in something visible. `undefined` is the point's contract
 * for "the action did its work elsewhere", and a button that silently does
 * nothing is exactly what that contract must not be used to hide — so each
 * refusal says why through the module's own UI channel first.
 */
export async function insertPersonaBrief(): Promise<string | undefined> {
  const record = session.getState().record;
  if (!record) {
    workspaceUi.say("Open a conversation first — a persona is bound to one.");
    return undefined;
  }
  let personaId: string | null = null;
  try {
    personaId = await readBinding(record.id);
  } catch (err) {
    workspaceUi.say(`Agent Forge could not read its bindings: ${message(err)}`);
    return undefined;
  }
  if (!personaId) {
    workspaceUi.say("No persona bound — pick one in the Agent Forge panel.");
    return undefined;
  }
  try {
    return `${await fetchPersonaContext(record.cwd, personaId)}\n`;
  } catch (err) {
    workspaceUi.say(`Agent Forge could not compile “${personaId}”: ${message(err)}`);
    return undefined;
  }
}

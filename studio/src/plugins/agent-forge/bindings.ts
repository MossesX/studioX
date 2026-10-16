/**
 * @file What persona a conversation is bound to — the ONE shape both halves of
 * this plugin agree on, and the only thing they share.
 *
 * Isomorphic on purpose: no `node:*`, no React, no fetch. The panel runs in the
 * browser and writes through core's kv transport; the context provider runs
 * inside the subsystem's process and reads the same document off disk through
 * `axfKv`. Two runtimes, two transports, one document — so the shape lives here
 * rather than being written out twice and drifting.
 *
 * A kv namespace holds ONE document, so the binding is a map keyed by
 * conversation id rather than a document per conversation. That also makes
 * "which conversations have a persona" a single read, which is what the panel
 * needs to draw a roster without asking per row.
 */

/** The kv namespace. Guarded by core's `isKvName`; this passes it. */
export const AGENT_FORGE_NS = "agent-forge";

export interface ForgeBindings {
  /** conversation id → persona id (`<scope>:persona:<slug>`). */
  readonly personas: Record<string, string>;
}

/**
 * Read a binding out of whatever the store answered with.
 *
 * Takes `unknown` because a kv document is JSON somebody else may have written:
 * an older shape, a hand-edited file, `null` for "no document yet". Every one of
 * those means "no persona", and none of them should throw inside a turn — the
 * provider that calls this runs while a conversation is being composed.
 */
export function boundPersona(doc: unknown, conversationId: string): string | null {
  if (!doc || typeof doc !== "object") return null;
  const personas = (doc as { personas?: unknown }).personas;
  if (!personas || typeof personas !== "object") return null;
  const value = (personas as Record<string, unknown>)[conversationId];
  return typeof value === "string" && value ? value : null;
}

/**
 * The document with one binding set, or removed when `personaId` is null.
 *
 * Returns a NEW object and never mutates the input: the panel holds the last
 * read in state, and a mutation would make the optimistic redraw and the
 * persisted document the same object — which is how a failed write ends up
 * looking like a successful one.
 */
export function withBinding(
  doc: unknown,
  conversationId: string,
  personaId: string | null
): ForgeBindings {
  const current =
    doc && typeof doc === "object" && typeof (doc as ForgeBindings).personas === "object"
      ? { ...(doc as ForgeBindings).personas }
      : {};
  if (personaId) current[conversationId] = personaId;
  else delete current[conversationId];
  return { personas: current };
}

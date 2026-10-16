/**
 * @file The conversation store — one JSON document per conversation, on disk,
 * because *"survives a restart"* is P1's gate and localStorage cannot meet it.
 *
 * INTERNAL to the Claude subsystem. Consumers — the P3 workspace module
 * included — go through the service API in `./service`; nothing outside
 * `src/claude/` may import this file, and the consumer proof greps for exactly
 * that.
 *
 * ── this is a FACADE over core's kv primitive, not a fourth file store ───────
 *
 * The pre-strip version of this file hand-rolled the whole thing: its own
 * traversal guard, its own tmp+rename protocol, its own HMR-safe write chains
 * on `globalThis`. It was one of the two scars that justified building
 * `KvStore` — core's own capability register says so by name:
 *
 *   > *"the theme store persists per browser profile and the claude subsystem
 *   > had to hand-roll a file store to get conversations through a restart,
 *   > and a third hand-rolled store was the signal to promote the semantics
 *   > into ONE primitive"* — `AXF_CAPABILITIES["kv-persistence"]`
 *
 * Rebuilding the hand-rolled store now would make that entry a lie on the day
 * the primitive it justified went unused by the thing that justified it. So
 * everything that can be WRONG about a store — scoping, name guards, the
 * envelope, atomicity, per-document write chains — is core's, and what is left
 * here is what core cannot know: that a document is a `ConversationRecord`,
 * that its id is a UUID we minted, and how to summarise one for a list.
 *
 * Layout: `<root>/<user>/<uuid>.json`, core's own — one file per conversation,
 * so a long transcript rewrites itself and nothing else.
 *
 * ── the root, and what moved ─────────────────────────────────────────────────
 *
 * `data/claude/conversations/` — its own root rather than a namespace inside
 * the shared `data/axf/kv/`, so a conversation id can never collide with
 * `expenses` / `chrome-assets` / a future namespace, and a busy library cannot
 * bury the app's own preferences. Note this adds the `<user>/` level core's
 * layout has and the pre-strip store did not, so the two records left over
 * from the deleted subsystem (`data/claude/conversations/*.json`, one of them
 * the previous consumer proof) sit one directory above where this reads. They
 * are throwaway test artefacts from an asset that no longer exists; they are
 * left in place rather than deleted or migrated, because nothing is owed to
 * them and silently rewriting a file this code did not write is worse.
 *
 * **Node-only** — the kv driver imports `node:fs/promises`. Never reaches a
 * client bundle.
 */
import { randomUUID } from "node:crypto";

import { KvStore } from "@axf/core";
import type { KvDoc } from "@axf/core";

import { nodeKvIo } from "../server/axfKv";
import { CLAUDE_CONVERSATIONS_ROOT } from "../server/claudePaths";
import type { ConversationMeta, ConversationRecord } from "./types";
import { toMeta } from "./types";

/** Defined in `../server/claudePaths` (P2 of `default-state`) so the accounts
 *  factory reset can name a user's subtree without importing this file. */
export const CONVERSATIONS_ROOT = CLAUDE_CONVERSATIONS_ROOT;

/** The format tag on disk. A record whose tag is not this one reads as absent
 *  rather than as state — core's recovery posture, inherited deliberately. */
export const CONVERSATION_FORMAT = "axs-claude-conversation/1";

/**
 * Conversation ids are UUIDs we minted, and this is stricter than core's
 * `isKvName` on purpose: ids become file names, so the alphabet is a traversal
 * fence, and two fences in series is the correct number when one of them
 * belongs to somebody else's module.
 */
export function isConversationId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v);
}

function checkedId(id: string): string {
  if (!isConversationId(id)) throw new Error(`"${id}" is not a conversation id`);
  return id;
}

/** A kv document read back as a record, or null when it is not one of ours. */
function asRecord(doc: KvDoc | null, id: string): ConversationRecord | null {
  if (!doc) return null;
  const record = doc as unknown as ConversationRecord;
  if (record.format !== CONVERSATION_FORMAT || record.id !== id) return null;
  return record;
}

/** What `create()` is given: the record minus everything the store mints. */
export type ConversationInit = Omit<
  ConversationRecord,
  "format" | "id" | "createdAt" | "updatedAt" | "totalCostUsd" | "messages"
>;

export class ConversationStore {
  readonly #kv: KvStore;
  readonly #user: string;
  readonly root: string;

  /**
   * @param root Documents directory. Defaults to {@link CONVERSATIONS_ROOT};
   *             tests pass a temp directory, which is the whole reason it is a
   *             parameter.
   * @param user The kv scope. Written when AmberX had no auth as "when auth
   *             lands, a per-user service is one construction and not a
   *             signature change in nine places" — and that is exactly what
   *             happened: P2 of `default-state` (2026-08-14) has
   *             `claudeService(user)` construct one store per signed-in
   *             username, with `"local"` remaining the signed-out owner.
   */
  constructor(root?: string, user = "local") {
    this.root = root ?? CONVERSATIONS_ROOT;
    this.#user = user;
    // The store id names the root, so two stores over different roots chain
    // separately while HMR copies of THIS module chain together.
    this.#kv = new KvStore(nodeKvIo(this.root), `claude:${this.root}`);
  }

  async create(init: ConversationInit): Promise<ConversationRecord> {
    const now = new Date().toISOString();
    const record: ConversationRecord = {
      format: CONVERSATION_FORMAT,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      totalCostUsd: 0,
      messages: [],
      ...init
    };
    await this.save(record);
    return record;
  }

  /** The record, or null when there is none. A non-id is refused LOUDLY and
   *  never read as "does not exist" — those are different answers and one of
   *  them is a caller's bug. */
  async load(id: string): Promise<ConversationRecord | null> {
    return asRecord(await this.#kv.read(this.#user, checkedId(id)), id);
  }

  /**
   * `async` rather than a bare `return`, here and on the two below, so the id
   * guard arrives as a REJECTION. A promise-returning method that throws
   * synchronously escapes the caller's `.catch()` and lands as an unhandled
   * exception — the guard would then be a crash instead of a refusal, which is
   * the opposite of what a traversal fence is for.
   */
  async save(record: ConversationRecord): Promise<void> {
    return this.#kv.write(this.#user, checkedId(record.id), {
      ...record,
      updatedAt: new Date().toISOString()
    } as unknown as KvDoc);
  }

  /**
   * Read-modify-write, the WHOLE of it inside core's chain — locking only the
   * save still loses updates, which the asset registry taught this project
   * once already. A missing record rejects rather than being created: a
   * mutation of something that does not exist is a caller's mistake, and
   * inventing a conversation to satisfy it would hide it.
   */
  async mutate(
    id: string,
    fn: (record: ConversationRecord) => ConversationRecord
  ): Promise<ConversationRecord> {
    checkedId(id);
    return this.#kv.mutate(this.#user, id, (doc) => {
      const current = asRecord(doc, id);
      if (!current) throw new Error(`conversation "${id}" does not exist`);
      return { ...fn(current), updatedAt: new Date().toISOString() } as unknown as KvDoc;
    }) as Promise<unknown> as Promise<ConversationRecord>;
  }

  /** Delete. Chained behind earlier writes, so a delete cannot overtake a
   *  mutate that was accepted before it; deleting the deleted is idempotent. */
  async remove(id: string): Promise<void> {
    return this.#kv.remove(this.#user, checkedId(id));
  }

  /** Every conversation's meta, newest activity first. */
  async list(): Promise<ConversationMeta[]> {
    const metas: ConversationMeta[] = [];
    for (const id of await this.#kv.list(this.#user)) {
      if (!isConversationId(id)) continue;
      // A record that fails to read is SKIPPED, not fatal: the list is a lobby,
      // and one unreadable file must not make every conversation unreachable.
      const record = await this.load(id);
      if (record) metas.push(toMeta(record));
    }
    return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

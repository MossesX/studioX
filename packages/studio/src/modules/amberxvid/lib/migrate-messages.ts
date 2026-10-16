/**
 * @file **The message migration** — amberxvid's own conversation store drained
 * into the accounts message store (P6 of `axf-amberxvid-social`, 2026-08-15).
 *
 * Run through `scripts/axv-p6-messages.mjs`. A library rather than a script
 * body so the same code can be exercised against a temp store without a
 * subprocess, exactly like `./migrate-members` and `./migrate-vaults`.
 *
 * ## Why it is nearly a copy, and why that is the point
 *
 * The retired module store wrote one JSON per pair: `{ version, id,
 * participants: [a, b], messages: [{ id, threadId, from, to, text, sentAt,
 * deliveredAt, readAt }], createdAt, updatedAt }`. That is **precisely the
 * pre-groups shape of the accounts store**, which P5 generalised IN PLACE and
 * whose normaliser reads a legacy document, reconstructs the per-member
 * cursors from the per-message stamps, and rewrites it in the new shape on the
 * next touch (`accounts/lib/messages.ts` → `normalizeThread`, round-tripped by
 * `test/accounts-groups.test.ts` against hand-staged legacy bytes).
 *
 * So this migration does NOT re-derive cursors, seqs or member records. It
 * maps usernames through the P1 identity mapping, recomputes the thread id
 * from the mapped pair, and writes the document into the accounts store —
 * where the code that already knows how to read exactly this input adopts it.
 * Reimplementing the normaliser here would be a second answer to a question
 * that already has one, and the second answer is the one that goes stale.
 *
 * ## Three properties, in the order they matter
 *
 * **Idempotent.** Finished-ness is the MARKER FILE, `messages/.message-migration.json`.
 * A second run reads it, reports `already-migrated`, and touches nothing. The
 * marker holds the first run's record, so a re-run cannot erase what moved.
 *
 * **Never destructive, and it never MERGES.** A source thread whose accounts
 * counterpart already exists is SKIPPED and reported — not merged into it.
 * Merging would mean interleaving two message lists and renumbering seqs, and a
 * renumbered seq is a per-member cursor pointing somewhere else; "your unread
 * count moved" is not an acceptable outcome of a data move. Every thread that
 * DOES move is renamed `<id>.json.migrated` in the source directory rather than
 * deleted, so the originals stay comparable against what landed.
 *
 * **Recorded.** Every thread that moved, every one that did not with the
 * reason, and the identity map that was applied, land in the marker file.
 *
 * ## Ordering
 *
 * Runs AFTER P1 and refuses before it, for the same reason the vault migration
 * does: until `accounts.json` is retired, the thread ids and the `from`/`to`
 * fields are keyed on the module's own usernames, and filing them under those
 * would put a conversation between two accounts that do not exist.
 *
 * Server-only.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { messagesDir as accountsMessagesDir } from "@axs/modules/accounts/lib/paths";
import { threadIdFor } from "@axs/modules/accounts/lib/types";
import { dataRoot, messageMarkerFile, messagesDir } from "./paths";

/* ---------------------------------- shapes ----------------------------------- */

export interface MessageMove {
  /** The source thread file. */
  from: string;
  /** Where it landed in the accounts store. */
  to: string;
  /** The thread id BEFORE mapping — the module's own. */
  sourceId: string;
  /** The thread id AFTER mapping — the accounts store's. */
  threadId: string;
  participants: string[];
  messages: number;
}

export interface MessageSkip {
  from: string;
  why: string;
}

export interface MessageMigrationReport {
  version: 1;
  status: "migrated" | "already-migrated" | "nothing-to-migrate" | "blocked";
  ranAt: string;
  dryRun: boolean;
  /** Set only on `blocked` — the ordering mistake a person has to fix. */
  blockedBy: string | null;
  amberxvidRoot: string;
  accountsRoot: string;
  /** Where the P1 identity mapping was read from, or null when none was given
   *  and every username therefore mapped to itself. */
  mappingFrom: string | null;
  /** The mapping actually applied, lowercased on both sides. Recorded even
   *  when it is the identity, because "we mapped nothing" and "we had no
   *  mapping" are different facts about the same empty object. */
  identityMap: Record<string, string>;
  moved: MessageMove[];
  skipped: MessageSkip[];
  messagesMigrated: number;
  warnings: string[];
}

export interface MigrateMessagesOptions {
  /** Plan everything, write nothing — not the threads, not the marker. */
  dryRun?: boolean;
  /**
   * The P1 identity mapping, `old username → accounts username`. Absent names
   * map to themselves, which is exactly right under P1's `match` policy: a
   * member whose studio account already used their name was never re-keyed and
   * so never appears in the mapping's `members` list with a different `to`.
   */
  identityMap?: Record<string, string>;
  /** Where {@link MigrateMessagesOptions.identityMap} came from, for the record. */
  mappingFrom?: string | null;
  /** Override the accounts store root — the temp-store seam the tests use. */
  accountsMessagesRoot?: string;
}

/* --------------------------------- plumbing ---------------------------------- */

const norm = (u: string): string => u.trim().toLowerCase();

async function writeJson(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tmp, file);
}

/**
 * The P1 gate. `accounts.json` still present means the member store was never
 * retired, so the thread ids and the `from`/`to` fields inside every message
 * are keyed on the MODULE's old usernames.
 */
export function migrationBlocked(): string | null {
  return fs.existsSync(path.join(dataRoot(), "accounts.json"))
    ? "the P1 member migration has not run — data/amberxvid/accounts.json is still present, " +
        "so conversations are keyed on retired module usernames rather than accounts usernames. " +
        "Run `npm run migrate:amberxvid` first."
    : null;
}

/**
 * Read the P1 mapping record and project it into `old → new`. Entries whose
 * two sides agree are kept: the record of a member who was NOT re-keyed is
 * still evidence that the migration considered them.
 */
export function identityMapFrom(record: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (record === null || typeof record !== "object") return out;
  const members = (record as { members?: unknown }).members;
  if (!Array.isArray(members)) return out;
  for (const entry of members) {
    if (entry === null || typeof entry !== "object") continue;
    const m = entry as { from?: unknown; to?: unknown };
    if (typeof m.from !== "string" || typeof m.to !== "string") continue;
    const from = norm(m.from);
    const to = norm(m.to);
    if (from && to) out[from] = to;
  }
  return out;
}

/** The legacy document, as loosely as it really is on disk. */
interface LegacyMessage {
  id?: unknown;
  threadId?: unknown;
  from?: unknown;
  to?: unknown;
  text?: unknown;
  sentAt?: unknown;
  deliveredAt?: unknown;
  readAt?: unknown;
}

interface LegacyThread {
  version?: unknown;
  id?: unknown;
  participants?: unknown;
  messages?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

/* -------------------------------- the migration -------------------------------- */

/**
 * Drain the module's conversation store into the accounts one.
 *
 * The whole of the transformation is: map both participants, recompute the id
 * from the mapped pair, map `from`/`to` on every message, and restamp
 * `threadId`. Everything else is copied verbatim — see the file header for why
 * that is the correct amount of work rather than a shortcut.
 */
export async function migrateMessages(
  options: MigrateMessagesOptions = {},
): Promise<MessageMigrationReport> {
  const dryRun = options.dryRun === true;
  const map = options.identityMap ?? {};
  const target = options.accountsMessagesRoot ?? accountsMessagesDir();
  const warnings: string[] = [];

  const report: MessageMigrationReport = {
    version: 1,
    status: "nothing-to-migrate",
    ranAt: new Date().toISOString(),
    dryRun,
    blockedBy: null,
    amberxvidRoot: dataRoot(),
    accountsRoot: target,
    mappingFrom: options.mappingFrom ?? null,
    identityMap: map,
    moved: [],
    skipped: [],
    messagesMigrated: 0,
    warnings,
  };

  const blockedBy = migrationBlocked();
  if (blockedBy) {
    report.status = "blocked";
    report.blockedBy = blockedBy;
    return report;
  }

  const marker = messageMarkerFile();
  if (fs.existsSync(marker)) {
    try {
      const prior = JSON.parse(fs.readFileSync(marker, "utf8")) as MessageMigrationReport;
      return { ...prior, status: "already-migrated", ranAt: report.ranAt, dryRun };
    } catch {
      // A junk marker is still a marker: it says a run happened, and re-running
      // over a store whose originals were already renamed would find nothing
      // anyway. Report it rather than silently migrating twice.
      warnings.push(`the marker at ${marker} is unreadable — treating it as "already migrated"`);
      report.status = "already-migrated";
      return report;
    }
  }

  const source = messagesDir();
  let files: string[] = [];
  try {
    files = (await fsp.readdir(source)).filter((f) => f.endsWith(".json") && !f.startsWith("."));
  } catch {
    /* no store directory at all — the honest empty case */
  }

  const mapped = (user: string): string => map[norm(user)] ?? norm(user);

  for (const file of files.sort()) {
    const from = path.join(source, file);
    const sourceId = file.slice(0, -".json".length);
    let raw: LegacyThread;
    try {
      raw = JSON.parse(await fsp.readFile(from, "utf8")) as LegacyThread;
    } catch {
      report.skipped.push({ from, why: "not readable as JSON — left in place, untouched" });
      continue;
    }
    const participants = Array.isArray(raw.participants)
      ? raw.participants.filter((p): p is string => typeof p === "string")
      : [];
    if (participants.length !== 2) {
      report.skipped.push({
        from,
        why: `a module thread has exactly two participants; this one declares ${participants.length}`,
      });
      continue;
    }
    const messagesRaw = Array.isArray(raw.messages) ? (raw.messages as LegacyMessage[]) : [];

    const [a, b] = participants.map(mapped) as [string, string];
    if (a === b) {
      report.skipped.push({
        from,
        why: `both participants map to "${a}" — migrating it would create a conversation with yourself`,
      });
      continue;
    }
    const threadId = threadIdFor(a, b);
    const to = path.join(target, `${threadId}.json`);

    if (fs.existsSync(to)) {
      report.skipped.push({
        from,
        why:
          `${to} already exists in the accounts store — refused to merge (merging renumbers seqs, ` +
          `and a renumbered seq moves every member's unread cursor)`,
      });
      continue;
    }

    // The one substantive rewrite: identities, and the ids derived from them.
    const messages = messagesRaw.map((m) => ({
      ...m,
      threadId,
      from: typeof m.from === "string" ? mapped(m.from) : m.from,
      to: typeof m.to === "string" ? mapped(m.to) : m.to,
    }));
    const document = {
      version: 1,
      id: threadId,
      participants: [a, b].sort(),
      messages,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : report.ranAt,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : report.ranAt,
    };

    if (!dryRun) {
      await writeJson(to, document);
      // Kept, never deleted — the original is what an audit compares against.
      await fsp.rename(from, `${from}.migrated`);
    }
    report.moved.push({
      from,
      to,
      sourceId,
      threadId,
      participants: [a, b].sort(),
      messages: messages.length,
    });
    report.messagesMigrated += messages.length;
  }

  report.status = report.moved.length > 0 ? "migrated" : "nothing-to-migrate";

  // The marker goes down even when nothing moved: "there was nothing to move"
  // and "we never ran" are different facts, and only the marker tells them
  // apart. A dry run writes neither.
  if (!dryRun) await writeJson(marker, report);
  return report;
}

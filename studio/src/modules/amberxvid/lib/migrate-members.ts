/**
 * @file **The one-way migration** — AmberX Vid's retired member store onto
 * studio accounts (P1 of `axf-amberxvid-social`, 2026-08-14).
 *
 * Run through `scripts/axv-p1-migrate.mjs`. It is a library rather than a
 * script body so the same code can be exercised against a temp store without a
 * subprocess.
 *
 * ## Three properties, in the order they matter
 *
 * **Idempotent.** Re-running is a no-op that says so. The migration is
 * finished when `accounts.json` has been renamed to `accounts.json.retired`;
 * a second run finds no source store, reports `already-migrated`, and touches
 * nothing. That test is the RENAME rather than the mapping file's existence,
 * because a mapping file can be copied around and a rename cannot.
 *
 * **Recorded.** Every decision lands in
 * `build/projects/axf-amberxvid-social.p1-migration.json`: which member became
 * which account, whether they were matched or created, whether they were
 * suffixed and why, every path that moved, and every member left needing a
 * password. A migration you cannot audit afterwards is a migration you cannot
 * trust.
 *
 * **Never destructive.** `accounts.json` is RENAMED, never deleted — the old
 * hashes stay on disk, readable, in case a question comes up later. Re-keying
 * renames; it does not copy-then-delete, and it refuses to overwrite an
 * existing destination rather than merging two people's data.
 *
 * ## Passwords do not migrate, and that is the honest option
 *
 * The two stores hash with different scrypt ladders. Copying a hash across
 * would silently move an account onto the other module's parameters; minting a
 * password would be inventing a credential nobody chose. So a member who has
 * no studio account gets one with an unusable placeholder hash and
 * `forcePasswordReset: true`, and an administrator issues them a temp password
 * the normal way. The login card says so.
 *
 * ## What "collision" means here
 *
 * The default policy is **match**: a studio account with the same normalised
 * username IS the same person. On a single-machine studio that is true, and the
 * live data proves the case matters — `GizmoX` and `Brett` existed in both
 * stores.
 *
 * `policy: "separate"` is for the case where that assumption is wrong (two
 * populations that happen to share names). Then every member gets a NEW account
 * and a taken name is suffixed `-axv`, `-axv2`, … — which is the path that
 * makes re-keying necessary at all, and it is the path the mapping file records
 * in most detail.
 *
 * Server-only.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  dataRoot,
  legacyAlbumsDir,
  legacyProfilesDir,
  legacyRecordingsDir,
  messagesDir,
  messengerSettingsDir,
  presenceDir,
  ratingsDir,
} from "./paths";

/**
 * P1 re-keys the PRE-VAULT layout, and that is not an oversight to tidy up.
 *
 * This migration runs before `./migrate-vaults` by construction — the vault
 * pass refuses to start until P1 has retired `accounts.json` — so the flat
 * `profiles/`, `albums/` and `recordings/` directories are exactly where the
 * data still is when this code executes. It uses the `legacy*` helpers for that
 * reason; pointing it at the vault would move nothing, because nothing is there
 * yet.
 */

/* ---------------------------------- shapes ----------------------------------- */

export type MemberOutcome = "matched" | "created" | "suffixed";

export interface MemberMapping {
  /** The username as it stood in the retired module store. */
  from: string;
  /** The studio username it now answers to. */
  to: string;
  outcome: MemberOutcome;
  /** Present on `suffixed` / `matched` — why that outcome, in one sentence. */
  note?: string;
  /** True when the studio account was created with no usable password. */
  forcePasswordReset: boolean;
  /** Every path this member's data moved from → to. Empty when `to === from`. */
  rekeyed: Array<{ from: string; to: string; what: string }>;
}

export interface MigrationReport {
  version: 1;
  status: "migrated" | "already-migrated" | "nothing-to-migrate";
  ranAt: string;
  policy: "match" | "separate";
  dryRun: boolean;
  amberxvidRoot: string;
  accountsRoot: string;
  /** Where `accounts.json` went. Null when nothing was migrated. */
  retiredStore: string | null;
  members: MemberMapping[];
  /** How many members now need an administrator-issued password. */
  pendingResets: number;
  /**
   * Stores the inventory named that this migration did NOT touch, with the
   * reason. Recorded rather than skipped silently: a later phase reading this
   * file must be able to tell "there was nothing" from "we forgot".
   */
  notMigrated: Array<{ what: string; why: string }>;
  warnings: string[];
}

export interface MigrateOptions {
  policy?: "match" | "separate";
  /** Plan everything, write nothing (not even the report). */
  dryRun?: boolean;
}

/* --------------------------------- plumbing ---------------------------------- */

const norm = (u: string): string => u.trim().toLowerCase();

interface RetiredAccount {
  username: string;
  role?: string;
  screenname?: string | null;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  disabled?: boolean;
  lastLoginAt?: string;
}

interface StudioAccount {
  username: string;
  role: "member" | "administrator";
  passwordHash: string;
  mustChangePassword: boolean;
  screenname: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  disabled?: boolean;
  lastLoginAt?: string;
  forcePasswordReset?: boolean;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tmp, file);
}

/**
 * A hash nothing can ever match.
 *
 * The verifier splits on `$` and expects `scrypt$params$salt$key`; this has the
 * wrong shape entirely, so it fails at parse rather than at comparison and
 * cannot be brute-forced into anything. It is also self-describing in the file,
 * which matters when somebody opens `accounts.json` and wonders what it is.
 */
const NO_PASSWORD = "migrated-no-password$an-administrator-must-issue-one";

/* ------------------------------- the re-keying -------------------------------- */

/** One rename, refusing to clobber. Returns null when there was nothing there. */
async function move(
  from: string,
  to: string,
  what: string,
  dryRun: boolean,
  warnings: string[],
): Promise<{ from: string; to: string; what: string } | null> {
  if (!fs.existsSync(from)) return null;
  if (fs.existsSync(to)) {
    // Merging two people's albums because their names collided is exactly the
    // silent data corruption this whole migration exists to avoid.
    warnings.push(`refused to move ${what}: ${to} already exists — left ${from} in place`);
    return null;
  }
  if (!dryRun) {
    await fsp.mkdir(path.dirname(to), { recursive: true });
    await fsp.rename(from, to);
  }
  return { from, to, what };
}

/**
 * Move everything keyed on one member id. Seven stores, and the last two are
 * the ones a path-only migration gets wrong: threads carry the username inside
 * the document as well as in the filename, and a recording carries it ONLY as
 * a field.
 */
async function rekeyMember(
  fromUser: string,
  toUser: string,
  dryRun: boolean,
  warnings: string[],
): Promise<MemberMapping["rekeyed"]> {
  const a = norm(fromUser);
  const b = norm(toUser);
  if (a === b) return [];
  const moved: MemberMapping["rekeyed"] = [];

  const simple: Array<[string, string, string]> = [
    [path.join(legacyProfilesDir(), `${a}.json`), path.join(legacyProfilesDir(), `${b}.json`), "profile"],
    [path.join(legacyAlbumsDir(), a), path.join(legacyAlbumsDir(), b), "albums"],
    [path.join(messengerSettingsDir(), `${a}.json`), path.join(messengerSettingsDir(), `${b}.json`), "messenger settings"],
    [path.join(presenceDir(), `${a}.json`), path.join(presenceDir(), `${b}.json`), "last-seen stamp"],
  ];
  for (const [from, to, what] of simple) {
    const done = await move(from, to, what, dryRun, warnings);
    if (done) moved.push(done);
  }

  // Ratings: `<kind>--<target>.json`, so the member id is the tail.
  for (const kind of ["user", "stream"]) {
    const done = await move(
      path.join(ratingsDir(), `${kind}--${a}.json`),
      path.join(ratingsDir(), `${kind}--${b}.json`),
      `${kind} ratings`,
      dryRun,
      warnings,
    );
    if (done) moved.push(done);
  }

  // Threads: the id is `<lower>--<lower>` SORTED, so a rename can reorder the
  // pair as well as replace a half. The document repeats both the id and the
  // participants, and a reader validates `raw.id === id` — so renaming the file
  // without rewriting the body would make every migrated thread unreadable.
  if (fs.existsSync(messagesDir())) {
    for (const entry of await fsp.readdir(messagesDir())) {
      if (!entry.endsWith(".json")) continue;
      const id = entry.slice(0, -5);
      const parts = id.split("--");
      if (parts.length !== 2 || !parts.includes(a)) continue;
      const other = parts[0] === a ? parts[1] : parts[0];
      const nextId = [b, other].sort().join("--");
      const done = await move(
        path.join(messagesDir(), entry),
        path.join(messagesDir(), `${nextId}.json`),
        "conversation",
        dryRun,
        warnings,
      );
      if (!done) continue;
      moved.push(done);
      if (dryRun) continue;
      const doc = readJson<{ id: string; participants: string[] }>(done.to);
      if (!doc) {
        warnings.push(`conversation ${nextId} could not be re-read after the move`);
        continue;
      }
      doc.id = nextId;
      doc.participants = [b, other].sort();
      await writeJsonAtomic(done.to, doc);
    }
  }

  // Recordings are keyed by CAPTURE id, not by user — the owner is a field.
  // Renaming the directory would break every stored reference; rewriting the
  // field is the whole job.
  if (fs.existsSync(legacyRecordingsDir())) {
    for (const entry of await fsp.readdir(legacyRecordingsDir())) {
      const manifest = path.join(legacyRecordingsDir(), entry, "manifest.json");
      const doc = readJson<{ owner?: string }>(manifest);
      if (!doc || typeof doc.owner !== "string" || norm(doc.owner) !== a) continue;
      if (!dryRun) {
        doc.owner = toUser;
        await writeJsonAtomic(manifest, doc);
      }
      moved.push({ from: `${manifest}#owner=${fromUser}`, to: `${manifest}#owner=${toUser}`, what: "recording owner" });
    }
  }

  return moved;
}

/* -------------------------------- the migration -------------------------------- */

/**
 * Migrate every retired member onto a studio account.
 *
 * `accountsFileOverride` exists so a caller can point at a temp store; left
 * alone it resolves the accounts module's own env-driven root, exactly as the
 * running app does.
 */
export async function migrateMembers(
  accountsRoot: string,
  options: MigrateOptions = {},
): Promise<MigrationReport> {
  const policy = options.policy ?? "match";
  const dryRun = options.dryRun === true;
  const warnings: string[] = [];
  const now = new Date().toISOString();

  const sourceFile = path.join(dataRoot(), "accounts.json");
  const retiredFile = `${sourceFile}.retired`;
  const studioFile = path.join(accountsRoot, "accounts.json");

  const base: MigrationReport = {
    version: 1,
    status: "nothing-to-migrate",
    ranAt: now,
    policy,
    dryRun,
    amberxvidRoot: dataRoot(),
    accountsRoot,
    retiredStore: null,
    members: [],
    pendingResets: 0,
    notMigrated: [
      {
        what: "passwords",
        why: "the two stores use different scrypt parameters; copying a hash would silently move the account onto another ladder, and minting one would invent a credential nobody chose",
      },
      {
        what: "vault directories",
        why: "vaults are P2's, and P2 runs after this pass by construction — this migration re-keys the flat stores onto accounts usernames, and `./migrate-vaults` then moves them into users/<vaultKey>/ (it refuses to start until this pass has retired accounts.json)",
      },
      {
        what: "rooms/, outbox/, presence/live/",
        why: "ephemeral cross-process state keyed by room or process id, not by member; it is rebuilt on the next connection",
      },
    ],
    warnings,
  };

  // Finished-ness is the RENAME, not the mapping file: a mapping file can be
  // copied around, a renamed store cannot.
  if (!fs.existsSync(sourceFile)) {
    if (fs.existsSync(retiredFile)) {
      return { ...base, status: "already-migrated", retiredStore: retiredFile };
    }
    return base;
  }

  const source = readJson<{ version?: number; accounts?: RetiredAccount[] }>(sourceFile);
  if (!source || !Array.isArray(source.accounts)) {
    warnings.push(`${sourceFile} is not a readable member store — nothing migrated, nothing renamed`);
    return base;
  }

  const studio = readJson<{ version?: number; accounts?: StudioAccount[] }>(studioFile) ?? {
    version: 1,
    accounts: [],
  };
  const studioAccounts: StudioAccount[] = Array.isArray(studio.accounts) ? studio.accounts : [];
  const taken = new Set(studioAccounts.map((a) => norm(a.username)));

  const members: MemberMapping[] = [];

  for (const member of source.accounts) {
    if (typeof member?.username !== "string" || !member.username.trim()) {
      warnings.push("skipped a member record with no username");
      continue;
    }
    const from = member.username.trim();
    const existing = studioAccounts.find((a) => norm(a.username) === norm(from));

    if (existing && policy === "match") {
      members.push({
        from,
        to: existing.username,
        outcome: "matched",
        note: "a studio account already used this username; under the `match` policy that is the same person, so nothing was re-keyed",
        forcePasswordReset: existing.forcePasswordReset === true,
        rekeyed: [],
      });
      continue;
    }

    // Either the name is free, or the `separate` policy says a shared name is
    // a coincidence. Mint a new account; suffix if the name is spoken for.
    let to = from;
    let outcome: MemberOutcome = "created";
    let note: string | undefined;
    if (taken.has(norm(to))) {
      let n = 1;
      let candidate = `${from}-axv`;
      while (taken.has(norm(candidate))) {
        n += 1;
        candidate = `${from}-axv${n}`;
      }
      to = candidate;
      outcome = "suffixed";
      note = `"${from}" was already a studio account and the \`separate\` policy treats that as a different person, so this member became "${to}"`;
    }

    const account: StudioAccount = {
      username: to,
      role: member.role === "administrator" ? "administrator" : "member",
      passwordHash: NO_PASSWORD,
      // No password exists, so the forced-change flow cannot run — that is
      // what `forcePasswordReset` records, and what an admin reset clears.
      mustChangePassword: true,
      forcePasswordReset: true,
      screenname: typeof member.screenname === "string" ? member.screenname : null,
      createdAt: member.createdAt ?? now,
      updatedAt: now,
      createdBy: "amberxvid-migration",
      ...(member.disabled === true ? { disabled: true } : {}),
      ...(member.lastLoginAt ? { lastLoginAt: member.lastLoginAt } : {}),
    };
    studioAccounts.push(account);
    taken.add(norm(to));

    members.push({
      from,
      to,
      outcome,
      note,
      forcePasswordReset: true,
      rekeyed: await rekeyMember(from, to, dryRun, warnings),
    });
  }

  if (!dryRun) {
    await writeJsonAtomic(studioFile, { version: 1, accounts: studioAccounts });
    // Renamed, never deleted: the old hashes stay readable on disk in case a
    // question comes up, and the rename is what makes a re-run a no-op.
    await fsp.rename(sourceFile, retiredFile);
  }

  return {
    ...base,
    status: "migrated",
    retiredStore: retiredFile,
    members,
    pendingResets: members.filter((m) => m.forcePasswordReset).length,
  };
}

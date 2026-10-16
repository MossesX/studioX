/**
 * @file **Console password recovery** — issue a temp password for one studio
 * account from the machine that owns the store.
 *
 * ## Why this exists
 *
 * Passwords are scrypt hashes (`../src/modules/accounts/lib/passwords.ts`), so
 * a forgotten one cannot be read back — only replaced. Every in-app replacement
 * path needs a session first: `changePassword` wants the current password,
 * `resetPassword` wants a signed-in administrator who has finished their own
 * entry flow. When the person who forgot IS the administrator, that circle has
 * no opening, and the alternatives are worse than a script: hand-editing
 * `accounts.json` (an unhashed password, or a hash pasted from somewhere), or
 * deleting the store (which re-seeds and takes every other account with it).
 *
 * ## What it does, and what it deliberately does not
 *
 * It writes exactly what `resetPassword` writes and nothing else: a fresh hash
 * through the module's own {@link hashPassword}, `mustChangePassword: true`, a
 * bumped `updatedAt`, and a journal line naming the console as the actor. So the
 * issued password is a TEMP credential — the next sign-in is forced through the
 * change-password step, and the value printed here stops working the moment it
 * is used. It never clears `disabled` and never changes a role: recovering a
 * password is not the same act as re-enabling an account, and an administrator
 * who typed the wrong username should get a password change, not a promotion.
 *
 * It talks to the store on DISK, not to the running server, so it works while
 * `:3200` is down — and a running server picks the change up on its next read,
 * since `accounts.json` is re-read per call rather than cached.
 *
 * ## Usage
 *
 * ```
 * node --import ./test/alias-hook.mjs scripts/accounts-password.mjs <username>
 * node --import ./test/alias-hook.mjs scripts/accounts-password.mjs <username> --password "s0mething"
 * node --import ./test/alias-hook.mjs scripts/accounts-password.mjs --list
 * ```
 *
 * With no `--password` a 12-character one is generated. `ACCOUNTS_DATA_DIR` is
 * honoured exactly as the app honours it (`../src/modules/accounts/lib/paths.ts`),
 * so pointing this at a deployed store is a matter of setting the same env var
 * the server runs with.
 */
import crypto from "node:crypto";
import path from "node:path";

import { appendJournal, readJsonFile, writeJsonAtomic } from "@axs/modules/accounts/lib/fsCore";
import { accountsFile } from "@axs/modules/accounts/lib/paths";
import { hashPassword } from "@axs/modules/accounts/lib/passwords";

/** No look-alike glyphs — this string gets read off a terminal and retyped. */
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

function die(message) {
  console.error(`accounts-password: ${message}`);
  process.exit(1);
}

/** One pass: `--flag value` pairs into `flags`, everything else positional. */
const argv = process.argv.slice(2);
const flags = new Map();
const positional = [];
for (let i = 0; i < argv.length; i += 1) {
  const arg = argv[i];
  if (!arg.startsWith("--")) {
    positional.push(arg);
    continue;
  }
  const name = arg.slice(2);
  // `--list` is a bare switch; every other flag takes the next token.
  if (name === "list") {
    flags.set(name, true);
    continue;
  }
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) die(`--${name} needs a value`);
  flags.set(name, value);
  i += 1;
}

const store = readJsonFile(accountsFile());
if (!store || store.version !== 1 || !Array.isArray(store.accounts)) {
  die(`no readable accounts store at ${accountsFile()}`);
}

const norm = (u) => String(u).trim().toLowerCase();

if (flags.get("list") === true) {
  console.log(`store: ${accountsFile()}`);
  for (const a of store.accounts) {
    const flags = [a.role, a.disabled === true ? "disabled" : null, a.mustChangePassword ? "temp password in force" : null]
      .filter(Boolean)
      .join(", ");
    console.log(`  ${a.username}  (${flags})`);
  }
  process.exit(0);
}

const wanted = positional[0];
if (!wanted) die("usage: accounts-password.mjs <username> [--password <value>] | --list");

const account = store.accounts.find((a) => norm(a.username) === norm(wanted));
if (!account) {
  die(`no account named "${wanted}" — run with --list to see the roster`);
}

const password = flags.get("password") ?? generatePassword();
if (password.length < 6) die("password must be at least 6 characters");

account.passwordHash = await hashPassword(password);
account.mustChangePassword = true;
// A migrated account had no password at all; issuing one is exactly the act
// that resolves the flag — same clearing `resetPassword` does.
delete account.forcePasswordReset;
account.updatedAt = new Date().toISOString();

await writeJsonAtomic(accountsFile(), store);
// Repo-relative when the store is inside the tree, absolute when it is not —
// the same ledger-path rule `lib/accounts.ts` writes its own entries with, so
// a console reset reads as one more line in the same column.
const relative = path.relative(process.cwd(), accountsFile());
await appendJournal("edit", (relative.startsWith("..") ? accountsFile() : relative).replace(/\\/g, "/"), {
  summary: `accounts: the console issued a temp password for "${account.username}"`,
});

console.log(`\n  account   ${account.username} (${account.role})`);
console.log(`  password  ${password}`);
console.log(`\n  It is a TEMP password: signing in with it goes straight to the`);
console.log(`  change-password step, and choosing a new one retires this value.\n`);

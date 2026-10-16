/**
 * **A signed-in session for a browser probe** — the half every CDP gate in this
 * package was missing (I-31).
 *
 * `proxy.ts` gates every page on an `axs_session` cookie, so a probe that
 * navigates without one is answered `307 → /login?next=…` before any route
 * renders. The probe then asserts against `/login` — which is deliberately
 * chromeless — and reports that the SURFACE it was aiming at is broken. Ten
 * gates went red that way on 2026-08-15, every one of them naming a screen that
 * was perfectly fine.
 *
 * ## The token is minted, never re-implemented
 *
 * The signature is an HMAC over a machine secret, and the whole reason the gate
 * lives in `proxy.ts` rather than in an Edge middleware is that the token format
 * must never have a second spelling. So this file does not know the format: it
 * registers the package's own alias hook and calls the REAL
 * `issueAxsSession()`. If the format changes, the probes follow it for free; if
 * the module moves, this fails loudly at import instead of minting something
 * that verifies nowhere.
 *
 * ## Which account
 *
 * `AXF_PROBE_USER`, else `AXF_DEV_USER` (including from studio's `.env`, which
 * Node does not load for a plain script the way `next dev` does for the server),
 * else the first enabled administrator, else the first enabled account.
 *
 * `AXF_DEV_USER` ranks second on purpose. Where a machine has development
 * auto-login configured, that is the account its dev server signs ITSELF in as
 * — and the kv bucket is per-user, so a probe signing in as somebody else would
 * measure a different saved theme, layout and nav than the developer is looking
 * at, and disagree with them for a reason neither could see.
 *
 * The account is REAL and is looked up rather than invented, because `proxy.ts`
 * re-reads it on every navigation and refuses a token naming somebody who is
 * disabled or absent — a fabricated username would sail through the signature
 * check and be bounced anyway, one layer later, which is a worse hunt than no
 * cookie at all.
 *
 * Nothing here writes to the store. The one file it can create is
 * `data/accounts/.auth-secret`, and only when no secret exists yet — in which
 * case the server has not minted one either and both sides read what this
 * wrote.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STUDIO = path.resolve(import.meta.dirname, "..", "..");

/**
 * Pin the accounts store to studio's own `data/accounts` unless the environment
 * already names one. `dataRoot()` resolves against `process.cwd()`, and a probe
 * started from the repo root would otherwise derive its key from a different
 * (empty) store than the dev server signs with — producing a valid token under
 * the wrong secret, which verifies nowhere and looks exactly like no cookie.
 */
if (!process.env.ACCOUNTS_DATA_DIR?.trim()) {
  process.env.ACCOUNTS_DATA_DIR = path.join(STUDIO, "data", "accounts");
}

/** The accounts module, loaded through the package's own `@axs/*` resolution. */
async function accountsSession() {
  await import(pathToFileURL(path.join(STUDIO, "test", "alias-hook.mjs")).href);
  return import("@axs/modules/accounts/lib/session");
}

/** Every account in the store, or [] if there is no store to read. */
function readAccounts() {
  const file = path.join(process.env.ACCOUNTS_DATA_DIR, "accounts.json");
  try {
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    const list = Array.isArray(doc) ? doc : (doc?.accounts ?? []);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/**
 * `AXF_DEV_USER` as the dev SERVER sees it: the process env if a caller exported
 * it, else studio's `.env` — which `next dev` loads for the server and Node does
 * not load for a script, so reading it here is what keeps the two agreeing.
 *
 * Deliberately not a dotenv dependency and deliberately not clever: one
 * `KEY=value` per line, `#` comments and surrounding quotes stripped. Anything
 * fancier and this file would be a second, worse env loader.
 */
function configuredDevUser() {
  const fromProcess = process.env.AXF_DEV_USER?.trim();
  if (fromProcess) return fromProcess;
  for (const name of [".env.local", ".env"]) {
    let text;
    try {
      text = fs.readFileSync(path.join(STUDIO, name), "utf8");
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?AXF_DEV_USER\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const value = m[1].trim().replace(/^(['"])(.*)\1$/, "$2").trim();
      if (value) return value;
    }
  }
  return null;
}

/** The named account, or null. Case-insensitive, as usernames are everywhere. */
const findByName = (accounts, name) =>
  accounts.find((a) => a.username.toLowerCase() === name.toLowerCase()) ?? null;

/**
 * The account a probe signs in as. Throws with the reason rather than returning
 * null: there is nothing useful a browser gate can do signed out, and a probe
 * that carries on would land on `/login` and blame a surface again.
 */
export function probeAccount() {
  const accounts = readAccounts().filter((a) => a && typeof a.username === "string" && a.disabled !== true);
  const wanted = process.env.AXF_PROBE_USER?.trim();
  if (wanted) {
    const hit = findByName(accounts, wanted);
    if (!hit) {
      throw new Error(
        `AXF_PROBE_USER="${wanted}" names no enabled account in ` +
          `${path.join(process.env.ACCOUNTS_DATA_DIR, "accounts.json")}`
      );
    }
    return hit;
  }
  // The dev server's own account, when this machine has one. A stale or
  // disabled name falls through rather than throwing: auto-login itself
  // degrades to the real gate in that case (`lib/devAuth.ts`), so a probe
  // must not be stricter about it than the app is.
  const devUser = configuredDevUser();
  const devAccount = devUser ? findByName(accounts, devUser) : null;
  if (devAccount) return devAccount;

  const admin = accounts.find((a) => a.role === "administrator");
  const account = admin ?? accounts[0];
  if (!account) {
    throw new Error(
      `no enabled account in ${path.join(process.env.ACCOUNTS_DATA_DIR, "accounts.json")} — ` +
        "every page is gated by proxy.ts, so a browser probe cannot reach one. Create an " +
        "account, or point AXF_PROBE_USER / ACCOUNTS_DATA_DIR at a store that has one."
    );
  }
  return account;
}

/**
 * A ready-to-set `axs_session` cookie for a real, enabled account.
 * `{ name, value, username, role }`.
 */
export async function probeSessionCookie() {
  const account = probeAccount();
  const { AXS_SESSION_COOKIE, issueAxsSession } = await accountsSession();
  return {
    name: AXS_SESSION_COOKIE,
    value: issueAxsSession({ username: account.username, role: account.role }),
    username: account.username,
    role: account.role,
  };
}

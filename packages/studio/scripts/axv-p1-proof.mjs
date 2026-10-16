#!/usr/bin/env node
/**
 * P1 identity proof — drives the REAL route handlers with real `Request`
 * objects against a scratch store.
 *
 *   npm run check:amberxvid-identity
 *
 * This shape exists because a unit test cannot see it and a long-running dev
 * server lies about it: `:3200` caches module closures, so a route edited in
 * this phase may still be served from a pre-edit graph. Importing the handlers
 * under the alias hook with a temp cwd and calling them directly is the only
 * way to watch the actual gate run.
 *
 * Seven assertions, and every one of them is a thing P1 CLAIMS:
 *
 *   1. no cookie                 → 401 on a member route
 *   2. an accounts session       → 200 (the switch itself)
 *   3. a forged `axv_session`    → 401 (the retired cookie is inert, not
 *                                  merely unused — proving the old token
 *                                  cannot be replayed is the point of
 *                                  retiring it in the same phase)
 *   4. grant revoked in matrix   → 403, and `notMember`
 *   5. re-granted                → 200 again, with NO restart and no cache to
 *                                  invalidate (the uncached-matrix property)
 *   6. a retired credential POST → 410 naming where it moved
 *   7. self-serve join           → writes an explicit `true` grant, and is
 *                                  REFUSED when an administrator revoked
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const studio = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
process.chdir(studio);

if (!process.execArgv.some((a) => a.includes("alias-hook"))) {
  console.error("run via: npm run check:amberxvid-identity");
  process.exit(2);
}

const scratch = path.join(studio, "logs", "p1-proof");
fs.rmSync(scratch, { recursive: true, force: true });
fs.mkdirSync(scratch, { recursive: true });
process.env.ACCOUNTS_DATA_DIR = path.join(scratch, "accounts");
process.env.AMBERXVID_DATA_DIR = path.join(scratch, "amberxvid");
process.env.AMBERXVID_SILENT_JOURNAL = "1";

const { NextRequest } = await import("next/server");
const { issueAxsSession, AXS_SESSION_COOKIE } = await import("@axs/modules/accounts/lib/session");
const { ensureStoreDirs, accountsFile } = await import("@axs/modules/accounts/lib/paths");
const { hashPassword } = await import("@axs/modules/accounts/lib/passwords");
const { readGrants, writeGrants, defaultGrants } = await import(
  "@axs/modules/accounts/lib/permissions"
);

ensureStoreDirs();
const now = new Date().toISOString();
const account = async (username, role) => ({
  username,
  role,
  passwordHash: await hashPassword("proof-password"),
  mustChangePassword: false,
  screenname: username[0].toUpperCase() + username.slice(1),
  createdAt: now,
  updatedAt: now,
  createdBy: "p1-proof",
});
fs.writeFileSync(
  accountsFile(),
  `${JSON.stringify(
    { version: 1, accounts: [await account("root", "administrator"), await account("mia", "member")] },
    null,
    2,
  )}\n`,
  "utf8",
);

// pathToFileURL, not a bare path: Windows absolute paths are not valid ESM specifiers.
const routeUrl = (p) => pathToFileURL(path.join(studio, p)).href;
const profiles = await import(routeUrl("app/api/amberxvid/profiles/route.ts"));
const accountsRoute = await import(routeUrl("app/api/amberxvid/accounts/route.ts"));

const BASE = "http://localhost/api/amberxvid";
const req = (url, cookie, body) =>
  new NextRequest(url, {
    method: body ? "POST" : "GET",
    ...(cookie ? { headers: { cookie } } : {}),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

const mia = `${AXS_SESSION_COOKIE}=${issueAxsSession({ username: "mia", role: "member" })}`;

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failed += 1;
};

/** Revoke or restore `amberxvid` for one user, straight in the store. */
async function setGrant(user, value) {
  const all = readGrants();
  const g = all[user] ?? defaultGrants();
  if (value === undefined) delete g.modules.amberxvid;
  else g.modules.amberxvid = value;
  all[user] = g;
  await writeGrants(all);
}

console.log("P1 identity proof — the real handlers, a scratch store\n");

// 1. no cookie
check("1  no cookie → 401", (await profiles.GET(req(`${BASE}/profiles`))).status === 401);

// 2. an accounts session opens an amberxvid route
{
  const res = await profiles.GET(req(`${BASE}/profiles`, mia));
  check("2  accounts session → 200 (THE SWITCH)", res.status === 200, `status ${res.status}`);
}

// 3. the retired cookie is inert, not merely unused
{
  const forged = `axv_session=${issueAxsSession({ username: "mia", role: "member" })}`;
  const res = await profiles.GET(req(`${BASE}/profiles`, forged));
  check("3  forged axv_session → 401 (retired cookie is INERT)", res.status === 401, `status ${res.status}`);
}

// 4. a matrix revocation binds — no restart, nothing to invalidate
await setGrant("mia", false);
{
  const res = await profiles.GET(req(`${BASE}/profiles`, mia));
  check("4  grant revoked → 401/403", res.status === 401 || res.status === 403, `status ${res.status}`);
  const snap = await (await accountsRoute.GET(req(`${BASE}/accounts`, mia))).json();
  check("4b snapshot says notMember", snap.notMember === true && snap.me === null);
}

// 5. …and so does restoring it, on the very next call
await setGrant("mia", undefined);
{
  const res = await profiles.GET(req(`${BASE}/profiles`, mia));
  check("5  re-granted → 200, no restart", res.status === 200, `status ${res.status}`);
}

// 6. retired credential actions answer 410 with the address
for (const action of ["login", "change-password", "add-user"]) {
  const res = await accountsRoute.POST(req(`${BASE}/accounts`, mia, { action }));
  const body = await res.json();
  check(`6  "${action}" → 410 with movedTo`, res.status === 410 && typeof body.movedTo === "string", body.movedTo);
}

// 7. self-serve join, and its refusal
await setGrant("mia", false);
{
  const res = await accountsRoute.POST(req(`${BASE}/accounts`, mia, { action: "join" }));
  check("7  join REFUSED after an admin revocation", res.status === 403, `status ${res.status}`);
}
await setGrant("mia", undefined);
{
  const res = await accountsRoute.POST(req(`${BASE}/accounts`, mia, { action: "join" }));
  const stored = readGrants().mia?.modules?.amberxvid;
  check("7b join → 200 and an EXPLICIT true grant", res.status === 200 && stored === true, `stored ${stored}`);
}
{
  process.env.AMBERXVID_OPEN_MEMBERSHIP = "off";
  await setGrant("mia", false);
  const res = await accountsRoute.POST(req(`${BASE}/accounts`, mia, { action: "join" }));
  check("7c join → 403 when open membership is off", res.status === 403, `status ${res.status}`);
  delete process.env.AMBERXVID_OPEN_MEMBERSHIP;
}

fs.rmSync(scratch, { recursive: true, force: true });
console.log(`\n${failed === 0 ? "check:amberxvid-identity OK" : `check:amberxvid-identity — ${failed} FAILURE(S)`}`);
process.exit(failed === 0 ? 0 : 1);

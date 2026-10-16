/**
 * `npm run check:peel` — the PEELED app, walked end to end over HTTP.
 *
 * Not a unit test and not a substitute for one. It exists because a peel can
 * be wrong in exactly one way nothing in the dev tree can see: the compiled
 * product. Every check below is a real request to a running peeled app on its
 * own port, through the routes the peel carried, against a store the peel
 * created. `npm test` passing proves the SDK works; this proves the thing the
 * peel shipped works.
 *
 * The shape is deliberately the P20 step's list, in its order:
 *   boot · /api/health green · sign UP through the carried accounts engine ·
 *   send a DM · open a stream room and see the player page · the assistant
 *   lists the module agent · install a trivial plugin zip through the engine.
 *
 * Usage — with a peeled app already running (`npm run dev` in its directory):
 *
 *     npm run check:peel                       # http://localhost:3270
 *     npm run check:peel -- --base http://localhost:3260
 *
 * It is RE-RUNNABLE against the same app: the seeded administrator's password
 * is a one-shot, so both the seeded and the already-provisioned paths are
 * accepted, and every account it creates is stamped (`--stamp`, default from
 * the clock) so a second run does not collide with the first.
 *
 * Zero dependencies, Node ≥ 23 — it imports the app's own `src/server/zip.ts`
 * to BUILD the plugin package rather than borrowing one, because a zip copied
 * out of the dev tree would only prove the dev tree can make one.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
};

const BASE = arg("base", process.env.SMOKE_BASE ?? "http://localhost:3270").replace(/\/$/, "");
/** The peeled app's directory — only needed to import its `zip.ts`. Derived
 *  from the default peel layout; `--app <dir>` overrides for an `--out` peel. */
const APP_DIR = path.resolve(
  arg("app", path.join(import.meta.dirname, "..", "..", "..", "peeled", "amberxvid"))
);

let failures = 0;
const results = [];

function ok(label, condition, detail = "") {
  if (!condition) failures += 1;
  results.push(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  return condition;
}

/** A cookie jar, because the whole point is that the session cookie the
 *  ACCOUNTS module mints is the one the AMBERXVID routes read. */
class Jar {
  constructor() {
    this.cookies = new Map();
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(res) {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (value === "" || /Max-Age=0/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
}

async function call(jar, path, init = {}) {
  const headers = { ...(init.headers ?? {}) };
  const cookie = jar.header();
  if (cookie) headers.cookie = cookie;
  if (init.json !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(init.json);
    init.method ??= "POST";
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  jar.absorb(res);
  const text = await res.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* html or plain text */
  }
  return { status: res.status, body, text };
}

const admin = new Jar();
const member = new Jar();
const stamp = String(arg("stamp", process.env.SMOKE_STAMP ?? Date.now().toString(36)))
  .replace(/\W/g, "")
  .toLowerCase();
const USER = `smoke${stamp}`;
const PASS = "Smoke-Pass-1";

// ---------------------------------------------------------------------------
// 1. Health — the app agrees with its own peel manifest
// ---------------------------------------------------------------------------
{
  const { status, body } = await call(admin, "/api/health");
  ok("health 200", status === 200, `status ${status}`);
  ok("health ok:true", body.ok === true, JSON.stringify(body.subsystems ?? body).slice(0, 200));
  ok("companion accounts registered", body.companions?.match === true);
  ok("framework vendored === running", body.framework?.match === true);
  ok("media server recorded", Boolean(body.mediaServer), body.mediaServer?.entry ?? "absent");
  ok("carried closure live", body.carries?.match === true);
  ok("ctx map clean", body.ctx?.match === true);
}

// ---------------------------------------------------------------------------
// 2. SIGN UP through the carried accounts engine
//
// The seeded administrator is the door: it signs in, completes its forced
// password change, and creates the member. That IS the sign-up path this app
// ships — the module's own `add-user` answers 410 with this address.
// ---------------------------------------------------------------------------
{
  // The seed is a one-shot: the first run of this smoke consumes it and the
  // store keeps the new password. Both paths are legitimate, and asserting
  // only the seed would make a second run red for no defect.
  let login = await call(admin, "/api/accounts/session", {
    json: { action: "login", username: "admin", password: "amberx" }
  });
  const seeded = login.status === 200;
  if (seeded) {
    ok("admin signs in on the seed credential", true);
    const changed = await call(admin, "/api/accounts/session", {
      json: { action: "change-password", currentPassword: "amberx", newPassword: "Admin-Pass-1" }
    });
    ok("forced password change", changed.status === 200, JSON.stringify(changed.body).slice(0, 160));
  } else {
    login = await call(admin, "/api/accounts/session", {
      json: { action: "login", username: "admin", password: "Admin-Pass-1" }
    });
    ok("admin signs in (seed already consumed by an earlier run)", login.status === 200,
      `status ${login.status}`);
  }

  const created = await call(admin, "/api/accounts/users", {
    json: { action: "add-user", username: USER, tempPassword: PASS, role: "member" }
  });
  ok("member account created", created.status === 200, JSON.stringify(created.body).slice(0, 200));

  const signin = await call(member, "/api/accounts/session", {
    json: { action: "login", username: USER, password: PASS }
  });
  ok("member signs in", signin.status === 200, JSON.stringify(signin.body).slice(0, 160));
  if (signin.body?.mustChangePassword === true) {
    const ch = await call(member, "/api/accounts/session", {
      json: { action: "change-password", currentPassword: PASS, newPassword: "Member-Pass-1" }
    });
    ok("member completes entry", ch.status === 200);
  }
  const who = await call(member, "/api/accounts/session");
  ok("session cookie carries the member", who.body?.me?.username === USER,
    JSON.stringify(who.body).slice(0, 200));
}

// ---------------------------------------------------------------------------
// 3. The member joins amberxvid — the module's own policy, the matrix's grant
// ---------------------------------------------------------------------------
{
  const grant = await call(admin, "/api/accounts/permissions", {
    json: { action: "set-module", username: USER, moduleId: "amberxvid", allowed: true }
  });
  const join = await call(member, "/api/amberxvid/accounts", { json: { action: "join" } });
  const snap = await call(member, "/api/amberxvid/accounts");
  const isMember = snap.body?.me != null || snap.body?.member === true;
  ok(
    "member is inside amberxvid",
    snap.status === 200 && isMember,
    `grant ${grant.status} · join ${join.status} · snapshot ${snap.status} ${JSON.stringify(snap.body).slice(0, 200)}`
  );
}

// ---------------------------------------------------------------------------
// 4. SEND A DM — accounts messaging, reached from the module's messenger route
// ---------------------------------------------------------------------------
{
  const sent = await call(member, "/api/accounts/messages", {
    json: { action: "send", to: "admin", text: "peel smoke: hello from the compiled product" }
  });
  const inbox = await call(admin, "/api/accounts/messages?with=" + USER);
  const landed =
    JSON.stringify(inbox.body).includes("peel smoke") ||
    JSON.stringify(sent.body).includes("peel smoke");
  ok("DM sent and readable", sent.status === 200 && landed,
    `send ${sent.status} ${JSON.stringify(sent.body).slice(0, 200)} · inbox ${inbox.status}`);
}

// ---------------------------------------------------------------------------
// 5. A STREAM ROOM, and the page that plays it
// ---------------------------------------------------------------------------
{
  const opened = await call(member, "/api/amberxvid/streams", {
    json: { action: "open", title: "peel smoke broadcast", description: "P20 peel smoke" }
  });
  const listed = await call(member, "/api/amberxvid/streams");
  const page = await call(member, "/amberxvid?view=streams");
  ok("stream room opens", opened.status === 200, JSON.stringify(opened.body).slice(0, 220));
  ok("stream room listed", JSON.stringify(listed.body).includes("peel smoke broadcast"),
    JSON.stringify(listed.body).slice(0, 220));
  ok("player page renders", page.status === 200 && /<html/i.test(page.text), `status ${page.status}`);
}

// ---------------------------------------------------------------------------
// 6. The ASSISTANT lists the module agent — the standing freight, proven here
// ---------------------------------------------------------------------------
{
  const agents = await call(member, "/api/assistant/agents");
  const roster = (agents.body?.agents ?? []).map((a) => `${a.id} (${a.source ?? "?"})`);
  ok("assistant answers", agents.status === 200, `status ${agents.status}`);
  ok(
    "assistant lists the amberxvid module agent",
    roster.some((r) => r.startsWith("amberxvid-agent")),
    roster.join(", ")
  );
}

// ---------------------------------------------------------------------------
// 7. The PLUGIN ENGINE — a trivial plugin zip built here and installed through
//    the app's OWN /api/plugins/import, into the app's OWN ledger.
//
// Built rather than borrowed on purpose: a zip copied out of the dev tree
// would prove the dev tree can make one. This proves the peeled app can take
// one, land the source, write the ledger entry and list it back.
// ---------------------------------------------------------------------------
{
  const { packZip } = await import(
    pathToFileURL(path.join(APP_DIR, "src", "server", "zip.ts")).href
  );
  const id = `smoke-plugin-${stamp}`;
  const manifest = {
    id,
    kind: "plugin",
    name: "Peel smoke plugin",
    version: "0.0.1",
    layer: "sdk",
    target: "universal",
    entry: "plugin.ts",
    summary: "A trivial plugin, installed by the P20 peel smoke to prove the engine ships."
  };
  const entry = [
    "/** Trivial by design — the engine's contract is structural, and this is",
    " *  the smallest thing that satisfies it. */",
    `export const SMOKE_DECL = { id: ${JSON.stringify(id)}, settings: { groups: [] } };`,
    ""
  ].join("\n");
  // Flat, manifest at the ROOT — the engine's package layout ("plugin dir
  // contents, manifest.json at its root"), which a wrapper directory fails.
  const zip = packZip([
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2) + "\n") },
    { name: "plugin.ts", data: Buffer.from(entry) }
  ]);

  const before = await call(member, "/api/plugins");
  ok("plugin engine answers", before.status === 200, `status ${before.status}`);

  const imported = await call(member, "/api/plugins/import?overwrite=1", {
    method: "POST",
    headers: { "content-type": "application/zip" },
    body: zip
  });
  ok("trivial plugin zip installs", imported.status === 200,
    `${imported.status} ${JSON.stringify(imported.body).slice(0, 300)}`);

  const after = await call(member, "/api/plugins");
  ok("installed plugin is in the app's ledger", JSON.stringify(after.body).includes(id),
    JSON.stringify(after.body).slice(0, 300));
}

console.log(`check:peel — ${BASE}\n`);
console.log(results.join("\n"));
console.log(`\n${results.length - failures}/${results.length} passed`);
if (failures) {
  console.error(
    `\ncheck:peel FAILED. Is the peeled app running? \`npm run dev\` in ${APP_DIR}, ` +
      "then re-run. A peel that installs and typechecks can still be missing a route."
  );
}
process.exit(failures === 0 ? 0 : 1);

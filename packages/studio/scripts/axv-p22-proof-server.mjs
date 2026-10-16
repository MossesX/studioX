/**
 * axv-p22-proof-server.mjs — the APP PROCESS of the P22 real-browser proof.
 *
 * P22 walks the whole platform in real browsers. Two facts make a plain
 * "point Chromium at :3200" impossible:
 *
 *   1. The media plane needs `AMBERXVID_MEDIA_SECRET` in the APP process — the
 *      app mints the participant token the media server verifies. The dev
 *      server on :3200 was started without it (and by another session), and
 *      `.claude/rules/concurrent-builds.md` is explicit: never restart it.
 *   2. The proof needs a controlled cast — blocks, quotas, a policy cascade,
 *      a moderation queue. Seeding those into the studio's real roster is
 *      exactly what `axv-p13-proof-server.mjs` refuses to do.
 *
 * So this is P13's sidecar, widened: it serves the REAL `/api/amberxvid/*`
 * AND `/api/accounts/*` route handlers, imported and called with real
 * `NextRequest`s, over SCRATCH data roots and with the media secret — and
 * proxies everything else verbatim to :3200, so the browser gets the real
 * compiled UI, the real client bundle and real hydration. Identity, social
 * graph, media and moderation all run in one process over one root, which is
 * what makes the walk a walk rather than a set of disconnected screenshots.
 *
 * Run from packages/studio:
 *   ACCOUNTS_DATA_DIR=<scratch>/accounts AMBERXVID_DATA_DIR=<scratch>/amberxvid \
 *   ACCOUNTS_AUTH_SECRET=<16+> AMBERXVID_MEDIA_DEV=1 \
 *   AMBERXVID_MEDIA_SECRET=<same as the media server> \
 *     node --import ./test/alias-hook.mjs scripts/axv-p22-proof-server.mjs
 *
 * Proof-only extras (not product surface):
 *   GET /__p22/ready  → 200 once listening
 *   GET /__p22/roots  → the two data roots this process is actually using
 */

import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { NextRequest } from "next/server";

const PORT = Number(process.env.AXV_PROOF_PORT ?? "") || 3220;
const DEV_SERVER = "http://127.0.0.1:3200";
const TAG = `[p22-server:${PORT}]`;
const studio = process.cwd();

for (const required of [
  "ACCOUNTS_DATA_DIR",
  "AMBERXVID_DATA_DIR",
  "ACCOUNTS_AUTH_SECRET",
  "AMBERXVID_MEDIA_SECRET",
]) {
  if (!process.env[required]?.trim()) {
    console.error(`${TAG} refusing to run: ${required} is unset.`);
    process.exit(2);
  }
}

const { ensureStoreDirs, dataRoot } = await import("@axs/modules/amberxvid/lib/paths");
const { ensureStoreDirs: ensureAccountDirs, dataRoot: accountsRoot } = await import(
  "@axs/modules/accounts/lib/paths"
);
ensureStoreDirs();
ensureAccountDirs();

if (path.resolve(accountsRoot()) === path.resolve(studio, "data", "accounts")) {
  console.error(`${TAG} refusing to run against the REAL accounts store at ${accountsRoot()}.`);
  process.exit(2);
}

/* ---------------------- the policy cascade, if one is asked for ------------- */

/**
 * P22 state 8 needs `storageQuotaMB` and `canHostStreams` to actually BIND, and
 * the product cannot do that today: `amberxvidPolicyStatus()` says so in its
 * own words — no accounts cascade has ever installed itself, because the
 * catalog is a deliverable of `axf-accounts-admin-suite`, a project that has
 * never run. So the thirteen rows resolve to site defaults and there is no
 * administrator screen that can move one.
 *
 * `AXV_P22_POLICY` points at a JSON file of `{ "<user>": { "<row>": value } }`.
 * It installs at the DOCUMENTED SEAM (`setAmberxvidPolicySource`) — the same
 * one the real cascade will use — so what the browser then walks is the
 * module's real enforcement points refusing by name, not a mock. The absence of
 * the editor is reported rather than papered over.
 */
if (process.env.AXV_P22_POLICY?.trim()) {
  const file = process.env.AXV_P22_POLICY.trim();
  const { setAmberxvidPolicySource } = await import("@axs/modules/amberxvid/lib/policy");
  setAmberxvidPolicySource((username) => {
    try {
      const doc = JSON.parse(fs.readFileSync(file, "utf8"));
      return doc[String(username).toLowerCase()] ?? {};
    } catch {
      return {};
    }
  });
  // The QUOTA is a second seam, and it has to be wired too: `installVaultStorage`
  // sets `setVaultQuotaSource` alongside the policy source precisely because
  // "a catalog holding rows nothing enforces" and "a guard reading a row nobody
  // registered" are the two halves of the same integration being half-done.
  // Installing only the first is exactly that half — a 1 MB quota with a 1.8 MB
  // upload sailing through, which is what happened here on the first attempt.
  const { setVaultQuotaSource } = await import("@axs/modules/amberxvid/lib/vault");
  setVaultQuotaSource(async (username) => {
    try {
      const doc = JSON.parse(fs.readFileSync(file, "utf8"));
      const mb = doc[String(username).toLowerCase()]?.storageQuotaMB;
      return typeof mb === "number" && mb > 0 ? Math.round(mb * 1024 * 1024) : null;
    } catch {
      return null;
    }
  });
  console.log(`${TAG} policy cascade + vault quota installed from ${file} (P22 state 8 scaffolding)`);
}

/* --------------------------- import the real routes ------------------------ */

/**
 * Discovered, never listed: a route added after this file was written must be
 * served by it, and a hand-kept list is how a proof quietly stops covering a
 * surface. Dynamic segments (`[token]`, `[id]`) become matchers.
 */
const table = [];
function collect(apiDir, prefix) {
  const walk = (dir, segs) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, [...segs, entry.name]);
      else if (entry.name === "route.ts") table.push({ prefix, segs, file: full });
    }
  };
  walk(apiDir, []);
}
collect(path.join(studio, "app", "api", "amberxvid"), "/api/amberxvid");
collect(path.join(studio, "app", "api", "accounts"), "/api/accounts");

for (const row of table) row.mod = await import(pathToFileURL(row.file).href);
// Longest first: /calls/history must win over /calls, and a literal segment
// must win over a [param] that would also match it.
table.sort((a, b) => b.segs.length - a.segs.length || a.segs.join("/").localeCompare(b.segs.join("/")));
console.log(`${TAG} ${table.length} route module(s) imported`);
console.log(`${TAG} accounts root ${accountsRoot()}`);
console.log(`${TAG} amberxvid root ${dataRoot()}`);

function matchRoute(pathname) {
  for (const row of table) {
    if (!pathname.startsWith(`${row.prefix}/`) && pathname !== row.prefix) continue;
    const rest = pathname.slice(row.prefix.length).replace(/^\/|\/+$/g, "");
    const parts = rest === "" ? [] : rest.split("/");
    if (parts.length !== row.segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i += 1) {
      const seg = row.segs[i];
      if (seg.startsWith("[") && seg.endsWith("]")) params[seg.slice(1, -1)] = decodeURIComponent(parts[i]);
      else if (seg !== parts[i]) { ok = false; break; }
    }
    if (ok) return { row, params };
  }
  return null;
}

/* ------------------------------- the server -------------------------------- */

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function serveApi(req, res, url, hit) {
  const handler = hit.row.mod?.[req.method];
  if (!handler) {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: `no ${req.method} ${url.pathname} here` }));
    return;
  }

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
    else if (Array.isArray(v)) headers.set(k, v.join(", "));
  }
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  const init = { method: req.method, headers, signal: abort.signal };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await collectBody(req);
    init.duplex = "half";
  }
  const nextReq = new NextRequest(`http://localhost:${PORT}${url.pathname}${url.search}`, init);

  let reply;
  try {
    reply = await handler(nextReq, { params: Promise.resolve(hit.params) });
  } catch (err) {
    if (abort.signal.aborted) return;
    console.error(`${TAG} ${req.method} ${url.pathname} threw:`, err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }));
    return;
  }

  const out = {};
  for (const [k, v] of reply.headers.entries()) {
    if (["content-length", "content-encoding", "transfer-encoding"].includes(k)) continue;
    out[k] = v;
  }
  const setCookies = reply.headers.getSetCookie?.() ?? [];
  if (setCookies.length) out["set-cookie"] = setCookies;
  res.writeHead(reply.status, out);
  if (!reply.body) {
    res.end();
    return;
  }
  try {
    for await (const chunk of reply.body) res.write(chunk); // unbuffered — SSE stays live
  } catch {
    /* client went away mid-stream */
  }
  res.end();
}

function proxyToDev(req, res, url) {
  const fwd = http.request(
    `${DEV_SERVER}${url.pathname}${url.search}`,
    { method: req.method, headers: { ...req.headers, host: "localhost:3200" } },
    (up) => {
      // Node's client already decodes chunked framing — forwarding the
      // hop-by-hop headers verbatim makes the browser wait on chunk framing
      // that never arrives (the frozen-splash bug the P6 sidecar fixed).
      const headers = { ...up.headers };
      for (const h of ["transfer-encoding", "connection", "keep-alive", "proxy-connection", "upgrade"]) {
        delete headers[h];
      }
      res.writeHead(up.statusCode ?? 502, headers);
      up.pipe(res);
    },
  );
  fwd.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end("dev server on :3200 did not answer");
  });
  req.pipe(fwd);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/__p22/ready") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ready");
    return;
  }
  if (url.pathname === "/__p22/roots") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ accounts: accountsRoot(), amberxvid: dataRoot(), routes: table.length }));
    return;
  }

  const hit = matchRoute(url.pathname);
  if (hit) {
    void serveApi(req, res, url, hit);
    return;
  }
  proxyToDev(req, res, url);
});

// Raw TCP tunnel for websocket upgrades (Turbopack's /_next/hmr): replay the
// upgrade request verbatim against :3200 and splice the sockets — destroying
// them starves the dev runtime's retry loop and hydration never finishes.
server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(3200, "127.0.0.1", () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      lines.push(`${k}: ${k.toLowerCase() === "host" ? "localhost:3200" : req.rawHeaders[i + 1]}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const drop = () => {
    socket.destroy();
    upstream.destroy();
  };
  upstream.on("error", drop);
  socket.on("error", drop);
});

server.listen(PORT, () => console.log(`${TAG} listening on http://localhost:${PORT}`));

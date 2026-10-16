/**
 * axv-p13-proof-server.mjs — ONE APP PROCESS of the P13 proof topology.
 *
 * P13 needs TWO app processes against the same data root (the cross-process
 * ring gate). Next 16 locks `next dev` per directory, so a second dev server
 * cannot start beside :3200 — this process IS an app process for the
 * amberxvid API: the REAL `/api/amberxvid/*` route handlers imported and
 * served directly (the I-9 idiom — the routes' real code, with the env the
 * media plane needs), everything else proxied verbatim to the dev server on
 * :3200 so the browsers get the real compiled UI. Two instances of THIS file
 * on :3217 and :3218, sharing AMBERXVID_DATA_DIR, AMBERXVID_AUTH_SECRET and
 * AMBERXVID_MEDIA_SECRET, are processes A and B.
 *
 * Derived from the P6/P7 proof sidecar (logs/build/axf-amberxvid-client-server/
 * p6-proof-server.mjs), parameterised:
 *   AXV_PROOF_PORT  — listen port (default 3217)
 *   AXV_PROOF_SEED  — "1" on exactly ONE instance: seed the four accounts.
 *                     The other instance must NOT rewrite the shared store.
 *
 * Run from packages/studio:
 *   AMBERXVID_DATA_DIR=<shared scratch> AMBERXVID_AUTH_SECRET=<16+> \
 *   AMBERXVID_MEDIA_DEV=1 AMBERXVID_MEDIA_SECRET=<shared> \
 *   AMBERXVID_SILENT_JOURNAL=1 AXV_PROOF_PORT=3217 AXV_PROOF_SEED=1 \
 *     node --import ./test/alias-hook.mjs scripts/axv-p13-proof-server.mjs
 *
 * Proof-only extras (not product surface):
 *   GET /__proof/signin?u=<alice|bob|carol|dave> → Set-Cookie axs_session, token in body
 *   GET /__proof/ready                           → 200 once listening
 */

import http from "node:http";
import net from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import fs from "node:fs";

import { NextRequest } from "next/server";

const PORT = Number(process.env.AXV_PROOF_PORT ?? "") || 3217;
const DEV_SERVER = "http://127.0.0.1:3200";
const USERS = ["alice", "bob", "carol", "dave"];
const TAG = `[p13-server:${PORT}]`;

const studio = process.cwd();
const routeFile = (...seg) =>
  pathToFileURL(path.join(studio, "app", "api", "amberxvid", ...seg, "route.ts")).href;

/* ------------------------- seed four ready accounts ------------------------ */

const { ensureStoreDirs, dataRoot } = await import("@axs/modules/amberxvid/lib/paths");
// P1 (2026-08-14): one identity system. The proof seeds STUDIO accounts and
// mints `axs_session`, because `amberxvid/lib/session` no longer exists — the
// module has no session of its own. `AMBERXVID_DATA_DIR` still points at the
// scratch store for the module's media/room/presence data; `ACCOUNTS_DATA_DIR`
// has to point somewhere scratch too, or the proof seeds over the real roster.
const { dataRoot: accountsRoot, ensureStoreDirs: ensureAccountDirs } = await import(
  "@axs/modules/accounts/lib/paths"
);
const { issueAxsSession } = await import("@axs/modules/accounts/lib/session");

ensureStoreDirs();
ensureAccountDirs();
if (!process.env.ACCOUNTS_DATA_DIR) {
  console.error(
    `${TAG} refusing to run: set ACCOUNTS_DATA_DIR to a scratch directory. ` +
      `Seeding four proof accounts into the real store at ${accountsRoot()} would ` +
      `overwrite the studio roster.`,
  );
  process.exit(2);
}
if (process.env.AXV_PROOF_SEED === "1") {
  const now = new Date().toISOString();
  const account = (username) => ({
    username,
    role: "member",
    passwordHash: "proof-never-logs-in-by-password",
    mustChangePassword: false,
    screenname: username[0].toUpperCase() + username.slice(1),
    createdAt: now,
    updatedAt: now,
    createdBy: "p13-proof",
  });
  fs.writeFileSync(
    path.join(accountsRoot(), "accounts.json"),
    `${JSON.stringify({ version: 1, accounts: USERS.map(account) }, null, 2)}\n`,
    "utf8",
  );
  console.log(`${TAG} scratch stores at ${dataRoot()} + ${accountsRoot()} — seeded ${USERS.join(", ")}`);
} else {
  console.log(`${TAG} joining existing store at ${dataRoot()} (no seed — process B)`);
}

/* --------------------------- import the real routes ------------------------ */

const ROUTES = {};
for (const seg of [
  "accounts", "admin", "albums", "calls", "media", "messages", "portrait",
  "presence", "profiles", "ratings", "recordings", "streams", "tray", "turn-credentials",
]) {
  ROUTES[seg] = await import(routeFile(seg));
}
ROUTES["albums/photo"] = await import(routeFile("albums", "photo"));
console.log(`${TAG} ${Object.keys(ROUTES).length} amberxvid route modules imported`);

/* ------------------------------- the server -------------------------------- */

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function serveApi(req, res, url) {
  const rest = url.pathname.slice("/api/amberxvid/".length).replace(/\/+$/, "");
  const mod = ROUTES[rest] ?? ROUTES[rest.split("/")[0]];
  const handler = mod?.[req.method];
  if (!handler) {
    res.writeHead(mod ? 405 : 404, { "content-type": "application/json" });
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
    reply = await handler(nextReq);
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

  if (url.pathname === "/__proof/ready") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ready");
    return;
  }
  if (url.pathname === "/__proof/signin") {
    const u = url.searchParams.get("u") ?? "";
    if (!USERS.includes(u)) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end(`u must be one of ${USERS.join(", ")}`);
      return;
    }
    const token = issueAxsSession({ username: u, role: "member" });
    res.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": `axs_session=${token}; Path=/; SameSite=Lax`,
    });
    res.end(JSON.stringify({ ok: true, user: u, token }));
    return;
  }

  if (url.pathname.startsWith("/api/amberxvid/")) {
    void serveApi(req, res, url);
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
    upstream.destroy();
    socket.destroy();
  };
  upstream.on("error", drop);
  socket.on("error", drop);
});

server.listen(PORT, () => {
  console.log(`${TAG} READY on :${PORT} — amberxvid API live here, everything else proxied to :3200`);
});

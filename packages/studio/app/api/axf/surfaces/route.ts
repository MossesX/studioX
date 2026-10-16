/**
 * @file `GET /api/axf/surfaces` — the route facts the Surfaces tab subtracts to
 * find every UI that is not a module.
 *
 *   { live: string[], moduleRoutes: string[] }
 *
 * Two lists rather than one derived answer, because the designer is not the only
 * possible consumer and the subtraction is the caller's business — a future
 * asset browser wants the same two facts and a different verdict from them.
 *
 * ## Why this reads the filesystem instead of a registry
 *
 * The same reason `scripts/check-nav.mjs` does, and this deliberately mirrors
 * that script's two discovery functions: the app directory IS the route table,
 * and a registry of "routes we believe exist" is the thing that goes stale
 * without anybody noticing. `check-nav` is the gate that proves the nav menus
 * agree with this same ground truth, so reading it the same way here means the
 * designer's list and the gate's list cannot drift apart.
 *
 * Deliberately NOT cached: it is a directory listing on a developer surface, and
 * a stale list is exactly the failure the approach exists to avoid.
 */
import fs from "node:fs";
import path from "node:path";

import type { NextRequest } from "next/server";

import { requireSession } from "../../../../src/modules/accounts/lib/http";

export const dynamic = "force-dynamic";

const STUDIO = path.resolve(process.cwd());
const APP = path.join(STUDIO, "app");

/** Live page routes, discovered from the app directory.
 *  Mirrors `check-nav.mjs`'s `routes()`: `api/` serves handlers not pages,
 *  `_x` is Next's private-folder convention, and `[x]` is a dynamic segment
 *  with no single address to name. */
function routes(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "api" || e.name.startsWith("_") || e.name.startsWith("[")) continue;
    const sub = path.join(dir, e.name);
    const route = `${prefix}/${e.name}`;
    if (fs.existsSync(path.join(sub, "page.tsx"))) out.push(route);
    out.push(...routes(sub, route));
  }
  return out;
}

/** The routes registered modules own, read from each module's own decl —
 *  the same anchored read `check-nav.mjs` uses, for the same reason: a looser
 *  match lands on a nav asset's route and passes while the real declaration
 *  goes unchecked. */
function moduleRoutes(): string[] {
  const root = path.join(STUDIO, "src", "modules");
  const out: string[] = [];
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const decl = path.join(root, d.name, `${d.name}.decl.ts`);
    if (!fs.existsSync(decl)) continue;
    const src = fs.readFileSync(decl, "utf8");
    const anchor = new RegExp(`\\bid:\\s*"${d.name}"`).exec(src);
    if (!anchor) continue;
    const after = src.slice(anchor.index);
    const route = /\broute:\s*"([^"]+)"/.exec(after);
    if (route) out.push(route[1]);
  }
  return out;
}

export function GET(req: NextRequest): Response {
  /*
   * Signed-in only. `/api/*` is outside the proxy's page gate by design, so each
   * route carries its own — and this one hands back the studio's whole internal
   * route inventory, including screens a signed-out visitor is never shown. Its
   * only caller is the theme designer's Surfaces tab, which is behind the gate
   * already, so requiring a session costs nothing and stops the map being
   * readable by anyone who guesses the path.
   */
  const gate = requireSession(req);
  if ("deny" in gate) return gate.deny;

  const live = routes(APP);
  if (fs.existsSync(path.join(APP, "page.tsx"))) live.push("/");
  return Response.json({ live: live.sort(), moduleRoutes: moduleRoutes().sort() });
}

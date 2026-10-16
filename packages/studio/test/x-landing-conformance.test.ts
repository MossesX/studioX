/**
 * @file Conformance gate for `x_landing` assets. Same shape as the logo-kit
 * gate: on-disk manifests must match source + signature, and — the property
 * special to this type — every asset a landing REFERENCES must resolve. A
 * landing that names a logo id no kit provides fails here, which is the
 * "renders wrong" failure made loud.
 *
 * PORTED from GizmoX `test/x-landing-conformance.test.ts` (2026-08-15), plus
 * two AmberX-specific gates the GizmoX tree had no reason to carry: a landing's
 * route must be REACHABLE (it exists under `app/`) and, if it is a sign-in
 * surface, PUBLIC (on the signed-out allow-list). AmberX gates every route by
 * default, so a landing that is merely defined and not allow-listed would
 * redirect its whole audience to /login — silently, and only in production.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { assetsRoot } from "../scripts/lib/registry-store.mjs";
import { defineXLanding } from "@axs/x-landing/define";
import { landingSignature } from "@axs/x-landing/sign";
import { SOURCE_LANDINGS } from "@axs/x-landing/landings";
import { XL_ID_RE, X_LANDING_TYPE } from "@axs/x-landing/types";
import { loginLandingRoute } from "@axs/x-landing/catalog";
import { resolveLogo } from "@axs/logo-kits/catalog";
import { LOGIN_PATH, isPublicPath, safeNext } from "@axs/modules/accounts/lib/publicPaths";
import { accountsStore } from "@axs/modules/accounts/store";

const ASSETS = assetsRoot();
const INSTALLED = path.join(ASSETS, "installed", X_LANDING_TYPE);
const APP = path.resolve(import.meta.dirname, "..", "app");

interface RegistryEntry {
  id: string;
  kind: string;
  version: string;
  archive?: string | null;
}
const registry = JSON.parse(fs.readFileSync(path.join(ASSETS, "registry.json"), "utf8")) as {
  assets: RegistryEntry[];
};

for (const input of SOURCE_LANDINGS) {
  const landing = defineXLanding(input);

  test(`x_landing ${landing.id}: manifest on disk matches source`, () => {
    const manifestPath = path.join(INSTALLED, landing.id, "manifest.json");
    assert.ok(fs.existsSync(manifestPath), "missing manifest — run npm run gen:x-landing");
    const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

    assert.equal(m.id, landing.id);
    assert.equal(m.type, X_LANDING_TYPE);
    assert.equal(m.authored_by, "framework");
    assert.equal(m.version, landing.version);
    assert.equal(m.name, landing.name);
    assert.equal(m.description, landing.description);
    assert.equal(m.route, landing.route);
    assert.equal(m.role, landing.role);
    assert.deepEqual(m.assets, landing.assets);
    assert.equal(m.cardOpacity, landing.cardOpacity);
    assert.equal(
      m.signature,
      landingSignature(landing),
      "signature drift — manifest was hand-edited or is stale"
    );
  });

  test(`x_landing ${landing.id}: invariants and references hold`, () => {
    assert.ok(XL_ID_RE.test(landing.id));
    assert.ok(landing.route.startsWith("/"), "route must start with /");
    assert.ok(landing.cardOpacity >= 0 && landing.cardOpacity <= 1);
    // the reference must resolve to a real logo in a real kit
    assert.ok(
      resolveLogo(landing.assets.logo),
      `landing ${landing.id} references unresolvable logo ${landing.assets.logo}`
    );
  });

  test(`x_landing ${landing.id}: its route is reachable and publicly served`, () => {
    // A landing asset that names a route no page serves is a promise the app
    // does not keep — the asset browser would list it and clicking would 404.
    const segments = landing.route.replace(/^\//, "").split("/");
    const pageDir = path.join(APP, ...segments);
    assert.ok(
      fs.existsSync(path.join(pageDir, "page.tsx")),
      `route ${landing.route} has no app/${segments.join("/")}/page.tsx`
    );
    /*
     * AmberX gates EVERY page on a session (`proxy.ts`). A landing is a front
     * door by definition, so one that is not on the signed-out allow-list
     * redirects the entire audience it exists for to /login — a failure that is
     * invisible to a signed-in developer and total for everyone else.
     */
    assert.ok(
      isPublicPath(landing.route),
      `landing route ${landing.route} is not on the signed-out allow-list ` +
        `(src/modules/accounts/lib/publicPaths.ts) — behind the gate, nobody it is for can reach it`
    );
  });

  test(`x_landing ${landing.id}: registered with a real archive`, () => {
    const entry = registry.assets.find((a) => a.id === landing.id && a.kind === X_LANDING_TYPE);
    assert.ok(entry, "no registry entry — run npm run gen:x-landing");
    assert.equal(entry!.version, landing.version);
    assert.ok(entry!.archive, "registry entry has no archive path");
    assert.ok(fs.existsSync(path.join(ASSETS, entry!.archive!)), "archive zip missing on disk");
  });
}

test("x_landing: the front door is reachable, public, and cannot bounce", () => {
  /*
   * `publicPaths.ts`: getting the login route wrong is "a lock-out with no way
   * back in". Since 2026-08-15 the gate redirects to the `login`-role landing
   * rather than to /login, so that route now carries the same risk and needs the
   * same three proofs.
   */
  const route = loginLandingRoute();
  if (route === null) return; // no front door declared; the gate falls back to /login

  assert.ok(isPublicPath(route), `the gate redirects to ${route}, which is not public — every visit would loop`);

  const segments = route.replace(/^\//, "").split("/");
  assert.ok(
    fs.existsSync(path.join(APP, ...segments, "page.tsx")),
    `the gate redirects to ${route}, which no page serves — signed-out visitors would get a 404`
  );

  // `safeNext` refuses public paths so a sign-in cannot be sent back to the
  // screen it just came from. The front door must be one of those refusals, or
  // `?next=<front door>` becomes an infinite round trip.
  assert.equal(safeNext(route), "/", `safeNext must refuse ${route} as a post-login destination`);

  // /login stays the floor: it must remain public and served, because it is what
  // the gate degrades to if the landing is ever removed.
  assert.ok(isPublicPath(LOGIN_PATH), "/login must stay public — it is the gate's fallback");
  assert.ok(fs.existsSync(path.join(APP, "login", "page.tsx")), "/login must stay served — it is the gate's fallback");
});

test("x_landing: the client bounce uses the same front door, and falls back to /login", () => {
  /*
   * `proxy.ts` routes signed-out NAVIGATIONS to the landing. The other half of
   * the same journey is a session dying under an already-open page, which the
   * accounts store bounces itself (`#leaveGatedPage`). Two answers to "where is
   * the front door" is the drift `publicPaths.ts` was written to prevent, so
   * this pins that the store starts on the floor, adopts what the shell hands
   * it, and refuses anything that would loop.
   */
  const store = accountsStore;

  // Untouched — a peel that takes accounts and leaves StudioShell registers
  // nothing, and must still bounce somewhere real. This is "fall back to /login
  // if login-landing fails", asserted rather than assumed.
  assert.equal(store.setFrontDoor(null), LOGIN_PATH, "the unregistered floor must be /login");
  assert.equal(store.setFrontDoor(""), LOGIN_PATH);
  assert.equal(store.setFrontDoor("https://evil.example/login"), LOGIN_PATH, "an absolute URL is not a route");

  // A GATED route can never become the door: the bounce is the one navigation a
  // signed-out visitor cannot opt out of, so it would redirect to itself forever.
  assert.equal(store.setFrontDoor("/claude"), LOGIN_PATH, "a gated route must be refused");

  const route = loginLandingRoute();
  if (route === null) return; // no front door declared; the floor is the answer

  // What `StudioShell` actually calls, with what it actually passes.
  assert.equal(store.setFrontDoor(route), route, `the store must adopt the declared front door ${route}`);

  // Restored, because the store is a singleton and a later test must not inherit
  // a door this one set.
  store.setFrontDoor(LOGIN_PATH);
  assert.equal(store.setFrontDoor(null), LOGIN_PATH);
});

test("x_landing: at most one landing claims the front door", () => {
  const claimants = SOURCE_LANDINGS.map(defineXLanding).filter((l) => l.role === "login");
  assert.ok(
    claimants.length <= 1,
    `${claimants.length} landings claim role "login" (${claimants.map((l) => l.id).join(", ")}) — ` +
      `the gate's destination would depend on import order`
  );
});

test("x_landing: no orphan installed landings", () => {
  const installed = fs.existsSync(INSTALLED)
    ? fs.readdirSync(INSTALLED).filter((d) => fs.existsSync(path.join(INSTALLED, d, "manifest.json")))
    : [];
  assert.deepEqual(
    installed.sort(),
    SOURCE_LANDINGS.map((l) => l.id).sort(),
    "an installed landing with no source is an orphan — it cannot have been framework-authored"
  );
});

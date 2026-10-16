/**
 * @file THE SCOPING PROOF — `axf-claude` P5, verbatim: *"Prove registry
 * scoping: a plugin targeting one host must not appear in another."*
 *
 * P5 absorbed two assets (Agent Forge, the difference browser) into a tree that
 * already had three contributing to a different module. That is the first time
 * this package has had contributions to five different points live at once, and
 * it is exactly the arrangement in which "scoping" stops being obvious: the
 * host list in `studio.subsystem.ts` is ONE loop over ONE mixed array, and if
 * the registry filed by anything other than the point a contribution NAMES, the
 * workspace's panel column would show AmberArt's tools and nobody would have
 * written a line of code to make that happen.
 *
 * ── everything here DISCOVERS ───────────────────────────────────────────────
 *
 * Nothing below hardcodes which plugin belongs to which host. The points come
 * from every `src/modules/*​/<id>.decl.ts` plus the subsystem's own
 * `src/claude/points.ts`; the contributions come from every
 * `src/plugins/*​/plugin*.ts`. So a plugin written next month joins this test
 * the day it is written — which is the only kind of scoping proof worth having,
 * because a hand-kept list of "who may appear where" has the same hole as the
 * hand-written `useCtx` handlers this framework exists to have replaced.
 *
 * The named assertions that remain are about the two assets P5 absorbed and
 * about the ONE thing a discovering scan cannot tell you: that the answer is
 * non-empty. A test asserting "no contribution appears under a foreign point"
 * passes perfectly on a registry with nothing in it.
 *
 * ── watched red ─────────────────────────────────────────────────────────────
 *
 * Three mutations at the foot of this file, each watched fail: a contribution
 * to a point nobody declared, a contribution whose payload does not satisfy the
 * point it names, and an impostor naming another host's point. All three must
 * be REFUSED and recorded — not silently dropped, and above all not filed under
 * the point they asked for.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { Registry, SHELL_STRIP_POINT_DEF } from "@axf/core";
import type { Contribution, ExtensionPoint } from "@axf/core";
// From the ctx stub, not the barrel: the test-time "@axf/core" alias is the
// Node-safe core stub, which does not re-export the ctx graph.
import { CTX_ITEM_POINT } from "../scripts/_axf-ctx-stub.ts";

const STUDIO = path.resolve(import.meta.dirname, "..");
const MODULES = path.join(STUDIO, "src", "modules");
const PLUGINS = path.join(STUDIO, "src", "plugins");

/* -------------------------------------------------------------- discovery */

const isContribution = (v: unknown): v is Contribution =>
  Boolean(v) &&
  typeof v === "object" &&
  typeof (v as Contribution).from === "string" &&
  typeof (v as Contribution).point === "string" &&
  "payload" in (v as object);

const isPoint = (v: unknown): v is ExtensionPoint =>
  Boolean(v) &&
  typeof v === "object" &&
  typeof (v as ExtensionPoint).id === "string" &&
  typeof (v as ExtensionPoint).kind === "string";

const dirs = (root: string): string[] =>
  fs.existsSync(root)
    ? fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    : [];

/** Every point any module or subsystem in this package declares. */
async function declaredPoints(): Promise<ExtensionPoint[]> {
  const out: ExtensionPoint[] = [];
  for (const id of dirs(MODULES)) {
    const decl = path.join(MODULES, id, `${id}.decl.ts`);
    if (!fs.existsSync(decl)) continue;
    const mod = (await import(pathToFileURL(decl).href)) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      const points = (value as { points?: unknown })?.points;
      if (Array.isArray(points)) out.push(...points.filter(isPoint));
    }
  }
  // The subsystem points. They belong to no module by design — a transport has
  // no screen, and the shell's assistant surface is the shell's — and a scan
  // that only walked `src/modules` would report Agent Forge's context provider
  // (and the assistant window) as contributions to nothing.
  const claude = (await import(
    pathToFileURL(path.join(STUDIO, "src", "claude", "points.ts")).href
  )) as { CLAUDE_POINTS?: unknown };
  if (Array.isArray(claude.CLAUDE_POINTS)) out.push(...claude.CLAUDE_POINTS.filter(isPoint));
  const studio = (await import(
    pathToFileURL(path.join(STUDIO, "src", "studio.points.ts")).href
  )) as { STUDIO_POINTS?: unknown };
  if (Array.isArray(studio.STUDIO_POINTS)) out.push(...studio.STUDIO_POINTS.filter(isPoint));
  // And core's points that belong to nobody at all — `ctx.item` and (0.0.22)
  // `shell.strip`, both declared straight onto the registry by Studio's boot,
  // exactly as they are here. A core point left out of this list does not read
  // as "not checked": it reads as a REFUSED contribution, because the plugin
  // that named it is discovered either way.
  out.push(CTX_ITEM_POINT);
  out.push(SHELL_STRIP_POINT_DEF);
  return out;
}

/** Every contribution any plugin in this package exports, with its file. */
async function pluginContributions(): Promise<{ plugin: string; file: string; c: Contribution }[]> {
  const out: { plugin: string; file: string; c: Contribution }[] = [];
  for (const plugin of dirs(PLUGINS)) {
    for (const file of fs
      .readdirSync(path.join(PLUGINS, plugin))
      .filter((f) => /^plugin(\.[a-z]+)?\.ts$/.test(f))
      .sort()) {
      const mod = (await import(pathToFileURL(path.join(PLUGINS, plugin, file)).href)) as Record<
        string,
        unknown
      >;
      for (const value of Object.values(mod)) {
        if (isContribution(value)) out.push({ plugin, file, c: value });
      }
    }
  }
  return out;
}

/** One registry with every declared point and every real contribution in it —
 *  the arrangement the app itself boots into, minus the React. */
async function loadedRegistry(): Promise<{
  registry: Registry;
  contributions: { plugin: string; file: string; c: Contribution }[];
}> {
  const registry = new Registry();
  for (const point of declaredPointsCache ?? (declaredPointsCache = await declaredPoints())) {
    registry.declarePoint(point);
  }
  const contributions = await pluginContributions();
  for (const { c } of contributions) registry.contribute(c);
  return { registry, contributions };
}

let declaredPointsCache: ExtensionPoint[] | null = null;

/* ------------------------------------------------------------- the proof */

test("every real contribution lands, and none of them is refused", async () => {
  const { registry, contributions } = await loadedRegistry();
  assert.deepEqual(
    registry.violations().map((v) => `${v.from} → ${v.point}: ${v.problem}`),
    [],
    "a real plugin was refused by the registry"
  );
  // The non-emptiness guard. Every scoping assertion below is vacuously true on
  // an empty registry, and an import path that quietly stopped finding plugins
  // would make this whole file green while proving nothing.
  assert.ok(contributions.length >= 9, `only ${contributions.length} contributions discovered`);
  assert.ok(registry.points().length >= 8, "too few points discovered to be a real scan");
});

test("a contribution appears under the point it NAMED, and under no other", async () => {
  const { registry, contributions } = await loadedRegistry();
  for (const point of registry.points()) {
    for (const c of registry.contributionsTo(point.id)) {
      assert.equal(
        c.point,
        point.id,
        `"${c.from}" was filed under "${point.id}" while naming "${c.point}"`
      );
    }
  }
  // The same claim from the other side: every discovered contribution is
  // reachable through its own point exactly once.
  for (const { c } of contributions) {
    const hits = registry.contributionsTo(c.point).filter((x) => x === c);
    assert.equal(hits.length, 1, `"${c.from}" → "${c.point}" is not reachable exactly once`);
  }
});

test("a plugin targeting one host does not appear in another", async () => {
  const { registry } = await loadedRegistry();
  /** Which plugins reach a point, by name. */
  const at = (id: string) => registry.contributionsTo(id).map((c) => c.from).sort();

  // The two P5 absorbed, on the two points the workspace declares.
  assert.deepEqual(at("claude-workspace.panel"), ["agent-forge", "diff-browser"]);
  assert.deepEqual(at("claude-workspace.composer-action"), ["agent-forge", "diff-browser"]);
  assert.deepEqual(at("claude.context-provider"), ["agent-forge"]);

  // And the hosts they are NOT: AmberArt's rail and the demo module's points
  // are contributed to from the same loop in `studio.subsystem.ts`, in the same
  // array, and stay entirely separate.
  assert.deepEqual(at("amberart.tool"), [
    "amberart-artgen",
    "amberart-drawing-lab",
    "amberart-stickers",
    "amberart-tessellate"
  ]);
  assert.deepEqual(at("demo.badge"), ["demo-badge"]);

  // Stated as the general rule as well, so a fourth host added later is covered
  // without an edit: nothing contributed by a claude plugin is visible on any
  // point outside `claude-workspace.` / `claude.`, and vice versa.
  const claudePlugins = new Set(["agent-forge", "diff-browser"]);
  for (const point of registry.points()) {
    const ours = point.id.startsWith("claude-workspace.") || point.id.startsWith("claude.");
    for (const c of registry.contributionsTo(point.id)) {
      assert.equal(
        claudePlugins.has(c.from),
        ours && claudePlugins.has(c.from),
        `"${c.from}" reached "${point.id}", which is not its host's`
      );
      if (!ours) {
        assert.ok(!claudePlugins.has(c.from), `"${c.from}" reached foreign point "${point.id}"`);
      }
    }
  }
});

test("the resolved suite carries each plugin only under its own host", () => {
  // The closure is the same claim one level up, and it is what a PEEL would
  // actually ship. Reading the committed artifact rather than recomputing it is
  // deliberate: `npm run check:suite` proves the artifact is current, and this
  // proves the current artifact scopes correctly.
  const resolved = JSON.parse(
    fs.readFileSync(path.join(STUDIO, "suite.resolved.generated.json"), "utf8")
  ) as {
    entries: { kind: string; id: string; carries?: string[]; carriedBy?: string[] }[];
  };
  const module = (id: string) => resolved.entries.find((e) => e.kind === "module" && e.id === id);
  const plugin = (id: string) => resolved.entries.find((e) => e.kind === "plugin" && e.id === id);

  for (const id of ["agent-forge", "diff-browser"]) {
    assert.deepEqual(plugin(id)?.carriedBy, ["claude-workspace"], `${id} is carried by the wrong host`);
    assert.ok(module("claude-workspace")?.carries?.includes(id), `claude-workspace does not carry ${id}`);
    assert.ok(!module("amberart")?.carries?.includes(id), `amberart carries ${id}`);
    assert.ok(!module("demo")?.carries?.includes(id), `demo carries ${id}`);
  }
  // And the other direction, so this is a statement about scoping rather than
  // about two names: AmberArt's tools stay out of the workspace's closure.
  for (const id of ["amberart-tessellate", "amberart-drawing-lab", "amberart-artgen", "amberart-stickers"]) {
    assert.deepEqual(plugin(id)?.carriedBy, ["amberart"]);
    assert.ok(!module("claude-workspace")?.carries?.includes(id));
  }
});

/* ----------------------------------------------- the server-side seam ---- */

/**
 * Routes that start a turn must register the server-side contributions.
 *
 * The hole `src/server/plugins.ts` could have is a route that reaches
 * `claudeService()` to run a turn and forgets the one line — at which point the
 * bound persona silently stops reaching the prompt, with nothing red anywhere.
 * That is a coverage failure, which means it needs a DISCOVERING check and not
 * a comment: a route added next month is scanned the day it is written.
 */
test("every route that starts a turn registers the server-side plugins", () => {
  const root = path.join(STUDIO, "app", "api");
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : e.name === "route.ts" ? [p] : [];
    });

  /**
   * The one exemption, and it is about a conflicting guarantee rather than
   * effort: `/api/claude/consumer-proof`'s IMPORT LIST IS its proof — the route
   * exists to show a consumer driving the subsystem through three imports and
   * nothing else, and `test/claude-subsystem.test.ts` asserts that list against
   * the file. A fourth import would void the thing the route is for. It starts
   * conversations of its own with no bindings, so it has nothing to lose.
   */
  const EXEMPT = new Map([
    [
      path.join("claude", "consumer-proof", "route.ts"),
      "its three-import list IS the consumer proof, pinned by test/claude-subsystem.test.ts"
    ]
  ]);

  const offenders: string[] = [];
  let scanned = 0;
  let exercised = 0;
  for (const file of walk(root)) {
    const src = fs.readFileSync(file, "utf8");
    // Both service entrances count: the shared `claudeService()` and the
    // per-user `claudeServiceFor(request)` the isolation work moved routes to.
    const startsTurn = /claudeService(?:For)?\s*\(/.test(src) && /\.send\s*\(/.test(src);
    if (!startsTurn) continue;
    scanned += 1;
    const rel = path.relative(path.join(STUDIO, "app", "api"), file);
    if (EXEMPT.has(rel)) {
      exercised += 1;
      continue;
    }
    if (!/registerServerPlugins\s*\(\s*\)/.test(src)) offenders.push(rel);
  }

  assert.ok(scanned >= 2, `the scanner found ${scanned} turn-starting routes — it is not looking`);
  assert.equal(exercised, EXEMPT.size, "an exemption is listed for a route that no longer exists");
  assert.deepEqual(offenders, [], "a route starts a turn without registering the server plugins");
});

/* ------------------------------------------------------------ watched red */

/** A payload that satisfies `claude-workspace.panel` and nothing else. */
const panelPayload = { title: "impostor", render: () => null };

test("RED: a contribution to a point nobody declared is refused and recorded", async () => {
  const { registry } = await loadedRegistry();
  registry.contribute({ from: "impostor", point: "nobody.declared-this", payload: panelPayload });
  const violation = registry.violations().find((v) => v.from === "impostor");
  assert.ok(violation, "the registry accepted a contribution to an undeclared point");
  assert.match(violation!.problem, /no module declares/);
  assert.deepEqual(registry.contributionsTo("nobody.declared-this"), []);
});

test("RED: an impostor naming another host's point is refused by the payload check", async () => {
  const { registry } = await loadedRegistry();
  const before = registry.contributionsTo("amberart.tool").map((c) => c.from);
  // A panel payload aimed at AmberArt's rail. The point requires id/title/glyph/
  // load, so the registry refuses it BY NAME — which is the layer that makes
  // "targeting one host" mean something rather than being a naming convention.
  registry.contribute({ from: "diff-browser", point: "amberart.tool", payload: panelPayload });
  const violation = registry
    .violations()
    .find((v) => v.from === "diff-browser" && v.point === "amberart.tool");
  assert.ok(violation, "AmberArt's rail accepted a workspace panel");
  assert.deepEqual(
    registry.contributionsTo("amberart.tool").map((c) => c.from),
    before,
    "the impostor reached the rail anyway"
  );
});

test("RED: a payload missing a required field never reaches the point", async () => {
  const { registry } = await loadedRegistry();
  const before = registry.contributionsTo("claude-workspace.panel").length;
  // `render` is required — a panel with only a title is the shape a hurried
  // contribution actually takes, and the failure it must not have is a blank
  // pane with no explanation.
  registry.contribute({ from: "half-written", point: "claude-workspace.panel", payload: { title: "x" } });
  assert.ok(registry.violations().some((v) => v.from === "half-written"));
  assert.equal(registry.contributionsTo("claude-workspace.panel").length, before);
});

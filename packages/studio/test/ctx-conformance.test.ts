/**
 * @file The context-menu CONFORMANCE gate — `axf-context-menus` P5.
 *
 * Its step, verbatim: *a discovering conformance test: every declared area
 * resolves, every item's command and predicate exist, no composed menu exceeds
 * the cap, no area declares a duplicate item id.*
 *
 * ── WHY IT DISCOVERS, AND WHAT IT DISCOVERS ───────────────────────────────────
 *
 * Nothing below names a module, an area or a command. Everything it checks it
 * finds on disk:
 *
 * - **the map** comes from every `*.decl.ts` under `src/`, imported for real and
 *   registered through `registerModuleMenus` — the same seam Studio's subsystem
 *   and the peeled app's generated boot use. A module that declares menus joins
 *   this test the day it is written, with no edit here;
 * - **the DOM half** comes from a scan of every `.tsx` for `data-axf-area`, which
 *   is the only way to check the claim that matters in both directions: a marker
 *   nobody declared is an invisible menu, and an area nobody marks is a menu
 *   nobody can open.
 *
 * That is the whole reason it is a discovering test rather than a list. This
 * package's stated failure mode is GizmoX's — *the menus were not bad, their
 * COVERAGE was inconsistent, because forty modules each hand-wrote `useCtx` and a
 * habit has holes.* A conformance test with a hand-kept list of areas in it has
 * exactly the same hole, one level up.
 *
 * ── THE FIFTH CHECK, AND WHY IT IS PART OF THE FIRST ──────────────────────────
 *
 * "Every declared area resolves" is checked three ways, because an area can fail
 * to resolve at three different distances from the source that declares it:
 * the resolver may not find it (the walk), the DOM may never mark it (the scan),
 * or the host may never register the decl that declares it (`registerModuleMenus`
 * is called over an explicit list in `studio.subsystem.ts`, and a module added to
 * the registry but left off that list declares areas that never reach the map).
 * All three produce the same symptom — a right-click with rows missing and
 * nothing said — so all three are here.
 *
 * ── WATCHED RED ───────────────────────────────────────────────────────────────
 *
 * Every guard below is watched fail in this same file, per the project's
 * doctrine: a fresh `MenuMap` is fed the violating decl and the throw is caught
 * and read, and the disk scanners are pointed at a planted temp tree through the
 * mutation harness. A guard nobody has watched fail is a guard nobody has tested.
 *
 * The mutations are planted in `os.tmpdir()` rather than in `src/`, deliberately:
 * `node --test` runs test FILES concurrently, and a violating `.tsx` planted in
 * the live tree would be seen by any other file scanning at that moment. The
 * scanners take their roots as an argument precisely so this is possible.
 *
 * NO DOM, like its P1/P3/P4 siblings — the walk is typed against `dataset` +
 * `parentElement`, so a plain object is a valid node. And the imports go through
 * `scripts/_axf-ctx-stub.ts` for the reason that file states: core's barrel
 * re-exports `.tsx`, and Node's type stripping does not transform JSX.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  AREA_ATTR,
  AREA_UNIVERSAL,
  MAX_CONTRIBUTING_AREAS,
  MenuMap,
  commands,
  composeMenu,
  declareUniversalArea,
  menu,
  predicates,
  registerCtxCommands,
  registerModuleMenus,
  resolveAreaPath,
  validateMenusDecl
} from "../scripts/_axf-ctx-stub.ts";
import type {
  AreaElement,
  ComposeInput,
  CtxItem,
  MenuItem,
  ModuleMenusDecl
} from "../scripts/_axf-ctx-stub.ts";
import { withMutation } from "../scripts/lib/mutation.mjs";

const STUDIO = path.resolve(import.meta.dirname, "..");
const SRC = path.join(STUDIO, "src");
const APP = path.join(STUDIO, "app");
const SUBSYSTEM = path.join(SRC, "studio.subsystem.ts");
/**
 * Core is scanned for MARKERS too, and only for markers.
 *
 * `ModuleHost` and the shell live there, and an area the shell marks is as real
 * as one a module marks — so scanning studio alone would make "this declared
 * area is marked nowhere" fail the day the chrome grows a surface of its own.
 * It is not scanned for DECLS: a decl is a module's, and core declares only the
 * universal area, which is documented as never marked.
 */
const CORE_SRC = path.resolve(STUDIO, "..", "core", "src");

/**
 * The module directories on disk — read straight from the filesystem, and the
 * ONE thing in this file allowed to answer "none".
 *
 * ── why this exists (v0.3.0 P0) ──────────────────────────────────────────────
 *
 * Every scanner below refuses to answer emptily, deliberately: a scanner that
 * finds nothing certifies everything, which is the green-check-that-is-wrong
 * this project spends most of its guard budget avoiding. That rule assumed
 * modules exist. The "strip to the frame" run archived and deleted all four, so
 * the assumption stopped holding and four checks went red — correctly, because
 * they genuinely could not tell an empty tree from a broken scanner.
 *
 * They still cannot. What they CAN do is ask something else that can: the
 * filesystem. `src/modules/` holding no module is a fact independent of every
 * regex in this file, so it is the one authority allowed to license an empty
 * answer — and it licenses NOTHING else. The moment a directory appears there,
 * every check below is mandatory again, with no edit here and no expectation to
 * remember to restore.
 *
 * The alternative — deleting these checks until P5 brings a module back — is
 * how a gate silently fails to come back.
 */
function moduleDirsOnDisk(): string[] {
  const root = path.join(SRC, "modules");
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return []; // the directory itself is gone — the P0 state
  }
}

const MODULE_DIRS = moduleDirsOnDisk();
/** True only while the tree genuinely ships no modules. */
const NO_MODULES = MODULE_DIRS.length === 0;

/* ==================================================== discovery: the sources */

/** Every file under `roots` with one of `exts`, sorted so failures are stable. */
function filesUnder(roots: readonly string[], exts: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // a root that does not exist is not a failure — `app/` may be flat
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next" || e.name.startsWith(".")) continue;
        walk(full);
      } else if (exts.some((x) => e.name.endsWith(x))) {
        out.push(full);
      }
    }
  };
  for (const root of roots) walk(root);
  return out.sort();
}

/** A module declaration found on disk, reduced to what this file checks. */
interface FoundDecl {
  /** Absolute path of the `*.decl.ts` it came from. */
  readonly file: string;
  /** The directory the decl lives in — how a decl is matched to a registration. */
  readonly dir: string;
  readonly id: string;
  readonly menus?: ModuleMenusDecl;
}

/**
 * Import every `*.decl.ts` under `src/` and take the module declarations out of
 * it.
 *
 * A decl is DATA — `nothing but import type` is the rule those files state about
 * themselves — so importing them under type stripping loads no React and no
 * component. That is what makes discovery possible here at all, and it is worth
 * naming: this test is a second consumer of the same property the peel depends
 * on, so a decl that grows a runtime import breaks this too, loudly.
 */
async function discoverDecls(): Promise<FoundDecl[]> {
  const out: FoundDecl[] = [];
  for (const file of filesUnder([SRC], [".decl.ts"])) {
    // `pathToFileURL`, not the bare path: Node's ESM loader reads `C:\…` as a
    // URL with the scheme `c:` and refuses it. A POSIX-only import here would
    // have worked everywhere except the machine this is built on.
    const mod: Record<string, unknown> = await import(pathToFileURL(file).href);
    for (const value of Object.values(mod)) {
      if (!value || typeof value !== "object") continue;
      const decl = value as { id?: unknown; route?: unknown; menus?: unknown };
      if (typeof decl.id !== "string" || typeof decl.route !== "string") continue;
      out.push({
        file,
        dir: path.dirname(file),
        id: decl.id,
        menus: decl.menus as ModuleMenusDecl | undefined
      });
    }
  }
  return out;
}

const DECLS = await discoverDecls();
const MENU_DECLS = DECLS.filter((d) => d.menus);

/* ============================================ discovery: the DOM area markers */

/**
 * Strip comments before scanning for markers.
 *
 * `types.ts` and `areas.ts` both quote `data-axf-area="<id>"` in their
 * docblocks, explaining the very thing being scanned for — so a raw regex over
 * source discovers a phantom area called `<id>` and the whole gate is a lie in
 * its first sentence. Only block comments and lines that are wholly a comment
 * are removed, which leaves every line that could carry a real JSX attribute
 * untouched.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

/** One `data-axf-area` occurrence found in a file. */
interface Marker {
  readonly file: string;
  /** The literal id, or `null` when the attribute is a computed expression. */
  readonly id: string | null;
  /** The raw expression, for a computed marker — what the report names. */
  readonly expression: string;
}

const MARKER_RE = new RegExp(`${AREA_ATTR}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{([^}]*)\\})`, "g");

/**
 * Scan `roots` for `data-axf-area` markers.
 *
 * `.tsx` only. A marker is a JSX attribute, and the `.ts` files that mention the
 * attribute at all are the engine's own sources describing it. Taking a root
 * list rather than reading the tree directly is what lets the red proofs below
 * point this at a planted temp tree instead of at `src/`.
 */
function scanAreaMarkers(roots: readonly string[]): Marker[] {
  const out: Marker[] = [];
  for (const file of filesUnder(roots, [".tsx"])) {
    const source = stripComments(fs.readFileSync(file, "utf8"));
    for (const m of source.matchAll(MARKER_RE)) {
      const literal = m[1] ?? m[2];
      out.push({
        file,
        id: literal !== undefined ? literal : null,
        expression: m[3] ?? literal ?? ""
      });
    }
  }
  return out;
}

const MARKERS = scanAreaMarkers([SRC, APP, CORE_SRC]);
const LITERAL_MARKERS = MARKERS.filter((m) => m.id !== null);
const COMPUTED_MARKERS = MARKERS.filter((m) => m.id === null);

/* ================================ discovery: which decls the host registers */

/** The live subsystem source. Named so the empty-tree licence below can tell a
 *  call about the REAL file from one fed a synthetic source by a RED test. */
function liveSubsystemSource(): string {
  return fs.readFileSync(SUBSYSTEM, "utf8");
}

/**
 * The module directories whose menus `studio.subsystem.ts` actually registers.
 *
 * Parsed from the `for (const mod of [...]) { registerModuleMenus(mod) }` loop
 * and the imports the names in it resolve through. A parse that finds nothing
 * THROWS rather than returning an empty set: an empty answer here would make
 * every conformance check below pass vacuously, which is the precise shape of a
 * green check that is wrong — the most expensive thing this project can ship.
 */
function registeredMenuDirs(source = liveSubsystemSource()): Set<string> {
  const loop = /for\s*\(\s*const\s+\w+\s+of\s*\[([^\]]*)\]\s*\)\s*\{[^}]*registerModuleMenus\s*\(/.exec(
    source
  );
  if (!loop) {
    // No loop AND no modules on disk is the one coherent way this parse comes
    // back empty: the host removed the seam because there is nothing to
    // register. Any other combination — a loop that vanished while modules
    // still ship — is the seam changing shape under the gate, and still throws.
    if (NO_MODULES && source === liveSubsystemSource()) return new Set();
    throw new Error(
      `could not find the registerModuleMenus loop in ${path.relative(STUDIO, SUBSYSTEM)} — ` +
        `the host's registration seam changed shape, so this gate cannot tell a registered ` +
        `module from an unregistered one. Update the scanner, never the expectation.`
    );
  }
  const names = loop[1]!
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) {
    throw new Error(`the registerModuleMenus loop in ${path.relative(STUDIO, SUBSYSTEM)} is empty`);
  }
  const dirs = new Set<string>();
  for (const name of names) {
    const imported = new RegExp(
      `import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["']([^"']+)["']`
    ).exec(source);
    if (!imported) {
      throw new Error(
        `"${name}" is registered for menus in studio.subsystem.ts but this scanner cannot see ` +
          `where it is imported from — resolve it before trusting this gate`
      );
    }
    dirs.add(path.resolve(SRC, path.dirname(imported[1]!)));
  }
  return dirs;
}

/* =========================================== discovery: module-owned commands */

/**
 * A module may bring its OWN commands, and its menu rows may name them —
 * taskman does (`taskman.commands.ts`). That is a case this gate did not model
 * while `demo` was the only module with menus, because demo's one row names a
 * core command (`ctx.copy`) which `registerCtxCommands()` already provides.
 *
 * The runtime registrar cannot be IMPORTED here: it reaches the real `@axf/core`
 * barrel, which drags `.tsx` and is exactly why this file talks to a Node-safe
 * stub instead. So the names are read from the SOURCE, the same technique
 * {@link registeredMenuDirs} uses on the host seam — and with the same refusal
 * to answer emptily, because a scanner that silently finds nothing would stub
 * nothing, refuse every row, and send a reader hunting a phantom typo.
 *
 * This does NOT weaken the map's gate. A row naming a command no module's
 * commands file registers is still stubbed by nobody and still refused by name:
 * mistype the decl and the boot goes red, which is the whole point.
 */
const COMMANDS_FILE_RE = /\.commands\.ts$/;
const COMMAND_ID_RE = /commands\.register\s*\(\s*\{\s*id\s*:\s*["']([^"']+)["']/g;
const REGISTRAR_RE = /export\s+function\s+(register\w*Commands)\s*\(/g;
/**
 * A module may bring its own PREDICATES as well as its own commands, for the
 * same reason and through the same seam: `enabledWhen` resolves by NAME, and
 * the map's gate refuses an unregistered predicate exactly as it refuses an
 * unregistered command. The Expense Tracker's "Delete selected expenses" row is
 * the first to need one (`expenses.selection`), and it registers it inside its
 * own `*.commands.ts` — the one file the host is known to call before the menus
 * loop, and the one this scanner already reads.
 *
 * Discovered, never listed, like everything else here. Unlike the command scan
 * this does NOT throw on zero matches: for commands, none in a `*.commands.ts`
 * means the registration shape changed underneath the gate; for predicates it
 * means the module simply has none, which is the common case.
 *
 * This does not weaken anything. A row naming a predicate no module registers
 * is still stubbed by nobody and still refused by name — `RED: an item naming
 * an unregistered predicate is refused, naming it` holds that, and it still
 * passes.
 */
const PREDICATE_ID_RE = /predicates\.register\s*\(\s*\{\s*id\s*:\s*["']([^"']+)["']/g;

interface CommandsFile {
  readonly file: string;
  readonly registrars: readonly string[];
  readonly ids: readonly string[];
  readonly predicateIds: readonly string[];
}

function scanCommandsFiles(): CommandsFile[] {
  const out: CommandsFile[] = [];
  for (const file of filesUnder([SRC], [".ts"]).filter((f) => COMMANDS_FILE_RE.test(f))) {
    const source = stripComments(fs.readFileSync(file, "utf8"));
    const ids = [...source.matchAll(COMMAND_ID_RE)].map((m) => m[1]!);
    const predicateIds = [...source.matchAll(PREDICATE_ID_RE)].map((m) => m[1]!);
    const registrars = [...source.matchAll(REGISTRAR_RE)].map((m) => m[1]!);
    if (!ids.length) {
      throw new Error(
        `${path.relative(STUDIO, file)} is a *.commands.ts file but this scanner found no ` +
          `commands.register({ id: "…" }) in it — the registration shape changed, so this gate ` +
          `cannot tell a module's commands from a missing one. Update the scanner, never the ` +
          `expectation.`
      );
    }
    if (!registrars.length) {
      throw new Error(
        `${path.relative(STUDIO, file)} registers commands but exports no register…Commands() ` +
          `function, so no host can call it — the commands would exist only if something imported ` +
          `the file for its side effects`
      );
    }
    out.push({ file, registrars, ids, predicateIds });
  }
  return out;
}

const COMMANDS_FILES = scanCommandsFiles();
const MODULE_COMMAND_IDS = COMMANDS_FILES.flatMap((c) => c.ids);
const MODULE_PREDICATE_IDS = COMMANDS_FILES.flatMap((c) => c.predicateIds);

/**
 * Does the host call a registrar BEFORE its menus loop? Ordering is the whole
 * constraint (`registerModuleMenus`'s docblock: "Module-specific commands must
 * be registered by the caller BEFORE this runs"), so the index comparison is
 * the assertion, not the mere presence of a call.
 */
function registrarCalledBeforeMenus(
  registrar: string,
  source = fs.readFileSync(SUBSYSTEM, "utf8")
): { called: boolean; beforeMenus: boolean } {
  const call = source.indexOf(`${registrar}(`);
  const menus = source.search(/registerModuleMenus\s*\(/);
  return { called: call >= 0, beforeMenus: call >= 0 && menus >= 0 && call < menus };
}

/* ===================================================== the map, booted for real */

/**
 * Boot the process-wide map exactly as a host does, in the order the engine's
 * own docblocks say is load-bearing: commands first (the map's gate refuses an
 * item naming an unregistered one), then D2's universal area, then every
 * discovered module's menus.
 *
 * The singleton rather than a throwaway `MenuMap`, on purpose. `node --test`
 * gives each test FILE its own process, so there is nothing to pollute, and what
 * this gate is actually asked to certify is the map the app runs on — not a map
 * a test assembled to its own taste.
 */
// A module's own commands come FIRST, exactly as the host orders them. These
// are stubs — the gate is about the NAMES a menu may legally reference, and the
// behaviour behind them is not this file's subject (it reaches the DOM, the
// store and `window.confirm`).
for (const id of MODULE_COMMAND_IDS) {
  commands.register({ id, title: id, run: () => {} });
}
// Same for a module's own predicates, and stubbed the same way: what this gate
// certifies is the NAMES a menu may legally reference. A real predicate reads
// the module's store, which is not this file's subject — and a stub that always
// holds cannot mask a missing registration, because a missing one is not here
// to stub.
for (const id of MODULE_PREDICATE_IDS) {
  if (!predicates.has(id)) predicates.register({ id, title: id, test: () => true });
}
registerCtxCommands();
declareUniversalArea();

/**
 * Boot failures, caught rather than thrown.
 *
 * The map's gate throws at registration BY DESIGN — it is the whole point of
 * P0's gate, and its message already names the area, the item and the missing
 * name. But a throw at module scope kills the test FILE, and what a reader then
 * sees is a stack trace where a list of results should be: every other check
 * silently never ran, and "the conformance gate is red" says nothing about how
 * much of the contract is intact. So the throw is caught, reported as its own
 * named failure with the gate's own words, and the rest of the file still runs.
 */
const BOOT_ERRORS: string[] = [];
for (const decl of MENU_DECLS) {
  try {
    registerModuleMenus({ id: decl.id, menus: decl.menus });
  } catch (e) {
    BOOT_ERRORS.push(
      `${path.relative(STUDIO, decl.file)}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

/** Every area in the booted map. */
const AREAS = menu.areas().map((a) => a.id);
/**
 * The areas a click can land in. `universal` is excluded everywhere below
 * because `universal.ts` states it is *never marked in the DOM — the engine
 * appends it to every menu*; asking it to resolve from a walk would be asking
 * it to be something it is documented not to be.
 */
const MARKABLE = AREAS.filter((id) => id !== AREA_UNIVERSAL);

/* ------------------------------------------------------------ small helpers */

interface Fake {
  dataset: Record<string, string | undefined>;
  parentElement: Fake | null;
}

/** A chain from `ids` given OUTERMOST first; returns the innermost node. */
function chainOf(ids: readonly string[]): Fake {
  let parent: Fake | null = null;
  for (const id of ids) parent = { dataset: { axfArea: id }, parentElement: parent };
  return parent as Fake;
}

const TARGET = { element: null, label: "t", selection: "", editable: false, value: "" };
const CLIPBOARD = { text: null, unreadable: null };

function inputFor(el: Fake, options: { map?: MenuMap; cap?: number } = {}): ComposeInput {
  return {
    path: resolveAreaPath(el as unknown as AreaElement, { warn: false, ...options }),
    target: TARGET,
    clipboard: CLIPBOARD,
    signedIn: false,
    user: null
  };
}

/** Walk a `MenuItem` tree, calling `visit` on every row at every depth. */
function eachItem(items: readonly MenuItem[], visit: (item: MenuItem, trail: string) => void): void {
  const go = (list: readonly MenuItem[], trail: string): void => {
    for (const item of list) {
      visit(item, trail);
      if (item.items) go(item.items, `${trail}${item.id}/`);
    }
  };
  go(items, "");
}

/** The distinct areas a composed menu actually drew rows from. */
function areasIn(rows: readonly CtxItem[]): string[] {
  return [...new Set(rows.map((r) => r.origin?.area).filter((a): a is string => Boolean(a)))];
}

/* ==================================================================== the gate */

// ---------------------------------------------------------------------------
// 0 — the walk really walked. Every check below is a green lie if it is not.
// ---------------------------------------------------------------------------
test("the discovery found a real tree to check", () => {
  // The module-side floors apply only while modules ship. With none on disk
  // they are pinned to zero instead of skipped: "no decls" must still be a
  // FAILURE the moment a module directory exists, and asserting equality keeps
  // this check load-bearing in both states rather than dormant in one.
  if (NO_MODULES) {
    // Scoped to `src/modules/` for the same reason as the else branch below: a
    // PLUGIN may declare areas too, and a stripped tree that still ships one is
    // a coherent state — the strip takes modules, not the whole of `src`.
    const moduleRoot = path.join(SRC, "modules");
    const underModules = DECLS.filter((d) => d.file.startsWith(moduleRoot + path.sep));
    assert.equal(underModules.length, 0, "no modules on disk, yet decls were discovered under src/modules");
    assert.equal(
      underModules.filter((d) => d.menus).length,
      0,
      "no modules on disk, yet a module declares context menus"
    );
  } else {
    // Tied to DISK, not to a constant. This was `>= 2`, a number that was true
    // of the four-module tree it was written against and became a failure the
    // day P2 restored `demo` as the only module — which is the classic floor
    // that measures the tree's history instead of the walk. What the check is
    // actually for is "the discovery is not silently empty or partial", and
    // one decl per module directory says that at any module count, including
    // the count where a magic floor would have gone quiet.
    // Counted against the decls that live UNDER `src/modules/`, not against
    // every decl discovered.
    //
    // The original was a flat `DECLS.length === MODULE_DIRS.length`, on the
    // assumption stated in this file's header: "a decl is a module's". That
    // stopped being true on 2026-08-12, when `/docs` — a PLUGIN, holding no
    // suite slot — declared context-menu areas and therefore had to ship a
    // `*.decl.ts` in the shape this scanner reads. Under the flat count the
    // gate would have failed for a surface doing exactly what the engine asks
    // of it.
    //
    // The guard itself is unchanged and is still an equality, not a floor:
    // every module directory must contribute exactly one discovered decl, so
    // "the walk missed one" and "a decl stopped being importable as data" both
    // still go red. What is no longer asserted is that NOTHING ELSE declares
    // menus — which was never the property being defended, and which the map
    // does not care about either: an area is an area, whatever declared it.
    const moduleRoot = path.join(SRC, "modules");
    const moduleDecls = DECLS.filter((d) => d.file.startsWith(moduleRoot + path.sep));
    assert.equal(
      moduleDecls.length,
      MODULE_DIRS.length,
      `discovered ${moduleDecls.length} module decl(s) under src/modules for ` +
        `${MODULE_DIRS.length} module director(ies) (${MODULE_DIRS.join(", ")}) — every module ` +
        "ships a *.decl.ts, so a mismatch means the walk missed one or a decl stopped being " +
        "importable as data"
    );
    assert.ok(
      MENU_DECLS.length >= 1,
      "no module declares context menus — this gate would certify an empty map"
    );
    assert.ok(
      MARKABLE.length >= 1,
      "the booted map holds no markable area — nothing below is testing anything"
    );
    assert.ok(
      LITERAL_MARKERS.length >= 1,
      `the ${AREA_ATTR} scan found no markers in src/, app/ or core/ — the scanner is reading the wrong tree`
    );
  }

  // Why the MARKER floor sits inside that branch too, despite the scan reading
  // core/ and app/ as well as src/: every real marker in this tree was in
  // `demo` and `taskman` (verified against the P0 archive — DemoModule,
  // TaskmanModule, TaskGrid, TaskTree and the two decls). Core mentions
  // `data-axf-area` only in its own implementation and docblocks, which this
  // scanner deliberately does not count. So zero markers is the true state of
  // a module-less tree, not a scanner reading the wrong one.
  //
  // That distinction is not taken on trust. The scanner is proven live on every
  // run by the three RED marker tests further down, which PLANT a marker on
  // disk and require the scan to see it — including the docblock case. A scan
  // reading the wrong tree would fail those, so nothing here depends on this
  // floor to catch it.

  // Tree-wide and never licensed to be empty: the .tsx walk covers app/ and
  // core/, which the strip did not touch.
  assert.ok(
    filesUnder([SRC, APP, CORE_SRC], [".tsx"]).length >= 10,
    "the .tsx scan walked an implausibly small tree"
  );
  console.log(
    `    discovered ${DECLS.length} decl(s), ${MENU_DECLS.length} with menus · ` +
      `${AREAS.length} area(s) · ${LITERAL_MARKERS.length} literal marker(s), ` +
      `${COMPUTED_MARKERS.length} computed`
  );
});

test("every module that owns commands has them registered by the host, before its menus", () => {
  // Stubbing the names above is what lets the map boot; it would also hide a
  // module whose commands nothing ever registers for real. This is the check
  // that closes that: the file must exist, export a registrar, and the host
  // must call it on the ordered side of the menus loop.
  for (const c of COMMANDS_FILES) {
    for (const registrar of c.registrars) {
      const { called, beforeMenus } = registrarCalledBeforeMenus(registrar);
      assert.ok(
        called,
        `${path.relative(STUDIO, c.file)} exports ${registrar}() but ` +
          `studio.subsystem.ts never calls it — its ${c.ids.length} command(s) would not exist ` +
          `in the running app, and every menu row naming one would be refused at boot`
      );
      assert.ok(
        beforeMenus,
        `studio.subsystem.ts calls ${registrar}() AFTER the registerModuleMenus loop — the map's ` +
          `gate refuses an item naming an unregistered command, so this ordering fails at boot`
      );
    }
  }
});

test("RED: the commands scanner refuses to answer rather than answering emptily", async () => {
  // The REAL scanner against a mutated tree, the same discipline the marker and
  // registration scanners are held to: a *.commands.ts whose registrations it
  // cannot see must throw, not quietly return no ids and stub nothing.
  //
  // The harness PLANTS a file rather than rewriting one — it refuses to
  // overwrite a real source file, which is the right instinct: a killed run
  // must never leave a mangled module behind.
  // The plant used to go inside `src/modules/taskman/`, which v0.3.0 P0
  // deleted along with every other module and every real *.commands.ts. It
  // goes directly under `src/` now — the scanner walks the whole of src/ for
  // the `*.commands.ts` suffix, so the location was never what it keyed on.
  //
  // The old precondition ("at least one real *.commands.ts exists, or this RED
  // check is testing nothing") is replaced rather than dropped. Its job was to
  // prove the scanner reads a real tree before trusting it to go red; the plant
  // proves exactly that and more directly — if the walk were reading the wrong
  // tree, it would not see the planted file either, and the throws() below
  // would fail. So the check keeps its teeth with no module on disk.
  const planted = path.join(SRC, "__mutation.commands.ts");
  await withMutation(
    planted,
    "export function registerMutationCommands() {\n  /* registers nothing the scanner can see */\n}\n",
    () => {
      assert.throws(
        () => scanCommandsFiles(),
        /found no commands\.register/,
        "the scanner answered for a file whose registration shape it cannot recognise"
      );
    }
  );
  assert.ok(!fs.existsSync(planted), "mutation harness failed to clean up");
  // Restored: the scanner is answerable again, and agrees with the disk.
  assert.equal(scanCommandsFiles().length, COMMANDS_FILES.length);
});

test("every discovered decl registers into the map without being refused", () => {
  // The map's registration gate, reported rather than crashed on. Its message is
  // the gate's own and already names the area, the item and the missing name.
  assert.deepEqual(BOOT_ERRORS, [], `the map's gate refused a module's menus:\n  ${BOOT_ERRORS.join("\n  ")}`);
});

// ---------------------------------------------------------------------------
// 1 — every declared area resolves: the walk finds it, the DOM marks it, and
//     the host registers the decl that declares it.
// ---------------------------------------------------------------------------
test("every declared area resolves from a walk, declared and contributing", () => {
  for (const id of MARKABLE) {
    const found = resolveAreaPath(chainOf([id]) as unknown as AreaElement, { warn: false });
    assert.deepEqual(found.path, [id], `area "${id}" did not come back off its own marker`);
    assert.equal(found.areas[0]?.declared, true, `area "${id}" resolved as undeclared`);
    assert.equal(found.areas[0]?.contributes, true, `area "${id}" resolved as non-contributing`);
    assert.deepEqual(found.undeclared, [], `area "${id}" was reported undeclared`);
  }
});

test(`every ${AREA_ATTR} marked in the tree is a declared area`, () => {
  const declared = new Set(AREAS);
  for (const marker of LITERAL_MARKERS) {
    assert.ok(
      declared.has(marker.id as string),
      `${path.relative(STUDIO, marker.file)} marks ${AREA_ATTR}="${marker.id}", which no module ` +
        `declares — the menu it opens is empty and says nothing. Declare it, or fix the marker.`
    );
    assert.notEqual(
      marker.id,
      AREA_UNIVERSAL,
      `${path.relative(STUDIO, marker.file)} marks the universal area in the DOM — the engine ` +
        `appends that band itself, so marking it doubles it`
    );
  }
});

test("every declared area is marked somewhere in the tree", () => {
  const marked = new Set(LITERAL_MARKERS.map((m) => m.id as string));
  for (const id of MARKABLE) {
    assert.ok(
      marked.has(id),
      `area "${id}" is declared and carries rows, but no .tsx marks ${AREA_ATTR}="${id}" — ` +
        `it is a menu nobody can open` +
        (COMPUTED_MARKERS.length
          ? `. ${COMPUTED_MARKERS.length} computed marker(s) exist and cannot be read statically: ` +
            COMPUTED_MARKERS.map((m) => `${path.relative(STUDIO, m.file)} {${m.expression}}`).join(", ")
          : "")
    );
  }
});

test("every decl that declares menus is registered by the host", () => {
  const registered = registeredMenuDirs();
  for (const decl of MENU_DECLS) {
    assert.ok(
      registered.has(decl.dir),
      `"${decl.id}" declares context menus in ${path.relative(STUDIO, decl.file)} but its module ` +
        `is not in studio.subsystem.ts's registerModuleMenus loop — its areas never reach the map, ` +
        `and every right-click inside it silently loses its rows`
    );
  }
});

// ---------------------------------------------------------------------------
// 2 — every item's command and predicate exist
// ---------------------------------------------------------------------------
test("every item in the booted map names a registered command and predicates", () => {
  let checked = 0;
  for (const areaId of AREAS) {
    eachItem(menu.defaultItemsFor(areaId), (item, trail) => {
      checked++;
      const where = `area "${areaId}" item "${trail}${item.id}"`;
      if (item.command !== undefined) {
        assert.ok(commands.has(item.command), `${where} names command "${item.command}", unregistered`);
      }
      for (const field of ["when", "enabledWhen", "checkedWhen"] as const) {
        const id = item[field];
        if (id === undefined) continue;
        assert.ok(predicates.has(id), `${where} names ${field} predicate "${id}", unregistered`);
      }
    });
  }
  assert.ok(checked >= 1, "the map holds no items at all — this check certified nothing");
  console.log(`    checked ${checked} item(s) across ${AREAS.length} area(s)`);
});

test("the map's own packaging-time pass finds nothing", () => {
  // The same question from the other direction: `contribute` asks "is this item
  // well-formed as written", `validate` asks "is every name it depends on still
  // there" — which catches a command unregistered AFTER the map was built.
  assert.deepEqual(menu.validate(), []);
});

test("every discovered decl passes the structural validator on its own", () => {
  for (const decl of MENU_DECLS) {
    assert.deepEqual(
      validateMenusDecl(decl.id, decl.menus as ModuleMenusDecl),
      [],
      `${path.relative(STUDIO, decl.file)} has structural problems in its menus decl`
    );
  }
});

// ---------------------------------------------------------------------------
// 3 — no composed menu exceeds the cap
// ---------------------------------------------------------------------------
test("the worst case the real map can produce still draws from at most the cap", () => {
  // Every declared area nested in one chain — deeper than any real DOM, which is
  // the point: a bound that holds here holds for every arrangement of these
  // areas that a screen could actually build.
  const rows = composeMenu(inputFor(chainOf([...MARKABLE].reverse())), { noticeUndeclared: false });
  const drew = areasIn(rows);
  assert.ok(
    drew.length <= MAX_CONTRIBUTING_AREAS,
    `a menu drew rows from ${drew.length} areas (${drew.join(", ")}), over the cap of ` +
      `${MAX_CONTRIBUTING_AREAS}`
  );
  console.log(
    `    worst case: ${MARKABLE.length} area(s) nested → ${drew.length} contributing, ${rows.length} row(s)`
  );
});

test("the cap holds when there are more areas than it allows — and is what bounds it", () => {
  // The real map is under the cap today, so the bound itself is proved against a
  // map built to exceed it. Both halves in one test on purpose: the second
  // assertion is the mutation — lift the cap and the composed menu really does
  // draw from every area, which is what makes the first assertion meaningful
  // rather than a coincidence of a small map.
  const map = new MenuMap();
  const ids = Array.from({ length: MAX_CONTRIBUTING_AREAS + 3 }, (_, i) => `cap.area${i}`);
  for (const id of ids) {
    map.declareArea({ id, title: id });
    map.contribute(id, [{ id: "row", label: id, command: "ctx.copy" }]);
  }
  const el = chainOf([...ids].reverse());

  const capped = composeMenu(inputFor(el, { map }), { map, noticeUndeclared: false });
  assert.equal(areasIn(capped).length, MAX_CONTRIBUTING_AREAS);

  const lifted = composeMenu(inputFor(el, { map, cap: ids.length }), { map, noticeUndeclared: false });
  assert.equal(
    areasIn(lifted).length,
    ids.length,
    "raising the cap did not widen the menu — the cap is not what bounds it, so the check above proves nothing"
  );
});

// ---------------------------------------------------------------------------
// 4 — no area declares a duplicate item id
// ---------------------------------------------------------------------------
test("no area holds two items under one id, at any depth", () => {
  for (const areaId of AREAS) {
    const seen = new Set<string>();
    eachItem(menu.defaultItemsFor(areaId), (item, trail) => {
      const key = `${trail}${item.id}`;
      assert.ok(!seen.has(key), `area "${areaId}" holds two items under id "${key}"`);
      seen.add(key);
    });
  }
});

test("a composed menu's row ids are unique — the renderer keys on them", () => {
  // The map's gate makes ids unique WITHIN an area; the resolver namespaces them
  // `"<area>:<item>"` so two areas each carrying a `copy` row do not collide. A
  // collision here would silently drop a row in React's reconciliation, which is
  // the invisible failure this package exists to make impossible.
  const rows = composeMenu(inputFor(chainOf([...MARKABLE].reverse())), { noticeUndeclared: false });
  const ids = rows.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate row ids in a composed menu: ${ids.join(", ")}`);
});

/* ================================================================ watched red */

test("RED: an item naming an unregistered command is refused, naming it", () => {
  const map = new MenuMap();
  map.declareArea({ id: "red.area", title: "Red" });
  assert.throws(
    () => map.contribute("red.area", [{ id: "boom", label: "Boom", command: "no.such.command" }]),
    /names command "no.such.command", which is not registered/
  );
});

test("RED: an item naming an unregistered predicate is refused, naming it", () => {
  const map = new MenuMap();
  map.declareArea({ id: "red.area", title: "Red" });
  assert.throws(
    () =>
      map.contribute("red.area", [
        { id: "boom", label: "Boom", command: "ctx.copy", enabledWhen: "no.such.predicate" }
      ]),
    /names enabledWhen predicate "no.such.predicate", which is not registered/
  );
});

test("RED: a duplicate item id is refused, at the top level and nested", () => {
  const map = new MenuMap();
  map.declareArea({ id: "red.area", title: "Red" });
  const row = (id: string): MenuItem => ({ id, label: id, command: "ctx.copy" });

  assert.throws(
    () => map.contribute("red.area", [row("dup"), row("dup")]),
    /is a duplicate id within its area/
  );
  assert.throws(
    () =>
      map.contribute("red.area", [
        { id: "sub", label: "Sub", role: "submenu", items: [row("kid"), row("kid")] }
      ]),
    /is a duplicate id within its area/
  );
  // …and across two separate contributions to the same area, which is how a
  // plugin's row collides with an author's.
  map.contribute("red.area", [row("once")]);
  assert.throws(() => map.contribute("red.area", [row("once")]), /is a duplicate id within its area/);
});

test("RED: the structural validator catches a duplicate before any registry exists", () => {
  const problems = validateMenusDecl("red", {
    areas: [{ id: "red.surface", title: "Red" }],
    items: {
      "red.surface": [
        { id: "dup", label: "A", command: "ctx.copy" },
        { id: "dup", label: "B", command: "ctx.copy" }
      ]
    }
  });
  assert.ok(
    problems.some((p) => /duplicate id/.test(p)),
    `expected a duplicate-id problem, got: ${problems.join(" | ") || "(none)"}`
  );
});

test("RED: the marker scanner sees an undeclared marker planted on disk", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axf-ctx-conformance-"));
  try {
    const planted = path.join(dir, "Planted__mutation__.tsx");
    const found = await withMutation(
      planted,
      // Concatenated so THIS file's own source never carries a scannable marker
      // — otherwise the green scan above would flag the test that guards it.
      `export const P = () => <div ${AREA_ATTR}=${JSON.stringify("red.undeclared.area")} />;\n`,
      async () => scanAreaMarkers([dir])
    );
    assert.equal(found.length, 1, "the scanner missed a marker it was pointed straight at");
    assert.equal(found[0]?.id, "red.undeclared.area");
    assert.equal(menu.area("red.undeclared.area"), undefined, "the planted area must not be declared");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("RED: the marker scanner reports a computed marker instead of swallowing it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axf-ctx-conformance-"));
  try {
    const planted = path.join(dir, "Computed__mutation__.tsx");
    const found = await withMutation(
      planted,
      `export const P = ({ id }: { id: string }) => <div ${AREA_ATTR}={id} />;\n`,
      async () => scanAreaMarkers([dir])
    );
    assert.equal(found.length, 1);
    assert.equal(found[0]?.id, null, "a computed marker must not be read as a literal area id");
    assert.equal(found[0]?.expression, "id");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("RED: a docblock quoting the attribute is NOT read as a marker", async () => {
  // The failure this stripper exists for: `types.ts` and `areas.ts` both quote
  // the attribute while explaining it, and a raw regex discovers a phantom area
  // called `<id>` — a gate that is wrong in its first sentence.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axf-ctx-conformance-"));
  try {
    const planted = path.join(dir, "Docblock__mutation__.tsx");
    const found = await withMutation(
      planted,
      [
        "/**",
        ` * Surfaces mark themselves ${AREA_ATTR}="<id>" and the resolver walks up.`,
        " */",
        `// ${AREA_ATTR}="commented.out"`,
        "export const P = () => <div />;",
        ""
      ].join("\n"),
      async () => scanAreaMarkers([dir])
    );
    assert.deepEqual(found, [], `comments were scanned as markers: ${found.map((f) => f.id).join(", ")}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("RED: the registration scanner refuses to answer rather than answering emptily", () => {
  // The REAL scanner, fed a mutated source — not a re-implementation of its
  // regex, which would only prove that a copy of the regex still matches a copy
  // of the file. It throws rather than returning an empty set, because an empty
  // set makes the registration check pass for every module at once: a green
  // check that is wrong, which is the most expensive thing available here.
  assert.throws(
    () => registeredMenuDirs("export const NOTHING = 1;\n"),
    /could not find the registerModuleMenus loop/
  );
  // A loop it CAN parse, naming something it cannot resolve to a file, is the
  // other half — it must not quietly drop the name it could not place.
  assert.throws(
    () => registeredMenuDirs("for (const mod of [GHOST_MODULE]) { registerModuleMenus(mod); }\n"),
    /cannot see where it is imported from/
  );
  // …and the green path really does resolve the live tree to real directories.
  // With no modules on disk the live subsystem carries no loop at all, and the
  // scanner is LICENSED to answer empty there (see MODULE_DIRS). Both RED
  // halves above still run, because both feed synthetic sources and neither is
  // covered by that licence.
  //
  // Counted against the decls that DECLARE MENUS, not against every module
  // directory. Those were the same number for as long as every module happened
  // to declare menus, and the equality quietly encoded "every module declares
  // menus" — which is false. `ModuleDecl.menus` is optional, and `buildmgr`
  // (registered 2026-08-11) declares none until its screen marks areas; the old
  // assertion failed it for a contract it had not broken.
  //
  // The check keeps its teeth either way. "Every decl WITH menus is registered"
  // is asserted directly by its own test above; this holds the other side — the
  // scanner must resolve exactly as many directories as there are menu-bearing
  // decls, so a name it silently dropped still fails here.
  const dirs = registeredMenuDirs();
  assert.equal(
    dirs.size,
    MENU_DECLS.length,
    `the scanner resolved ${dirs.size} module director(ies) from the live subsystem, ` +
      `but ${MENU_DECLS.length} decl(s) declare menus ` +
      `(${MENU_DECLS.map((d) => d.id).join(", ") || "none"})`
  );
  for (const dir of dirs) {
    assert.ok(fs.existsSync(dir), `the scanner resolved "${dir}", which is not on disk`);
  }
});

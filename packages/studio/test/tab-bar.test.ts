/**
 * @file The tab-bar plugin's gate — the claims its own files make about each
 * other, checked.
 *
 * `test/registry-scoping.test.ts` already proves every contribution here lands
 * under the point it names, and `test/ctx-conformance.test.ts` already proves
 * its menu areas resolve, are marked in the DOM and name registered commands.
 * Neither of them can check the three things below, which are specific to a
 * plugin that extends the FRAMEWORK rather than a module:
 *
 * 1. **The id is spelled the same in both halves.** `plugin.ts` cannot import
 *    the id from `tab-bar.decl.ts` — it is read under Node's type stripping by
 *    the closure resolver, where an extensionless relative runtime import does
 *    not resolve — so the string is written twice on purpose. Its docblock says
 *    this file pins them; this is that file. A comment asking someone to keep
 *    two strings in step is not a mechanism.
 *
 * 2. **The plugin-manager hook has teeth.** `studio.plugin` carries
 *    `settingsOwner` + `enabledKey` precisely so a manager can turn the plugin
 *    off through the plugin's own store. If `enabledKey` names a row the
 *    settings decl does not declare, the manager writes a key `ModuleSettingsStore`
 *    refuses ("has no setting") and the switch silently does nothing — the
 *    failure mode the payload shape was chosen to avoid.
 *
 * 3. **The SDK-settings hook names an owner that really registers settings.**
 *    A section pointing at an owner with no rows opens a dialog reading "this
 *    surface declares no settings", which is worse than no section.
 *
 * Discovering where it can be: the payload checks read whatever `plugin.ts`
 * exports rather than a list repeated here.
 */
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { SHELL_STRIP_POINT_DEF, validateContribution, validateSettingsDecl } from "@axf/core";
import type { Contribution } from "@axf/core";

const STUDIO = path.resolve(import.meta.dirname, "..");
const PLUGIN_DIR = path.join(STUDIO, "src", "plugins", "tab-bar");

const load = async (file: string): Promise<Record<string, unknown>> =>
  (await import(pathToFileURL(path.join(PLUGIN_DIR, file)).href)) as Record<string, unknown>;

const decl = (await load("tab-bar.decl.ts")).TAB_BAR_DECL as {
  id: string;
  route: string;
  menus: { areas: readonly { id: string }[]; items: Record<string, readonly unknown[]> };
  settings: { ns: string; rows: readonly { key: string }[] };
};
const declEnabledKey = (await load("tab-bar.decl.ts")).TAB_BAR_ENABLED_KEY as string;

const pluginModule = await load("plugin.ts");
const contributions = Object.values(pluginModule).filter(
  (v): v is Contribution =>
    Boolean(v) &&
    typeof v === "object" &&
    typeof (v as Contribution).from === "string" &&
    typeof (v as Contribution).point === "string"
);

test("the plugin exports the three contributions it claims", () => {
  assert.deepEqual(
    contributions.map((c) => c.point).sort(),
    ["shell.strip", "studio.plugin", "studio.settings-section"],
    "the tab bar's three audiences are the band, the plugin manager and the SDK settings interface"
  );
});

test("every contribution names the same id the decl does", () => {
  for (const c of contributions) {
    assert.equal(
      c.from,
      decl.id,
      `a contribution attributes itself to "${c.from}" while the decl is "${decl.id}" — ` +
        "plugin.ts writes the id as a literal because it cannot import one under Node, and " +
        "this is the assertion that keeps the two spellings equal"
    );
  }
});

test("the band satisfies the shell.strip point", () => {
  const strip = contributions.find((c) => c.point === "shell.strip");
  assert.ok(strip, "no shell.strip contribution");
  assert.deepEqual(
    validateContribution(SHELL_STRIP_POINT_DEF, strip),
    [],
    "the band does not satisfy the point it is drawn through"
  );
});

test("the plugin-manager entry names a settings row that exists", () => {
  const entry = contributions.find((c) => c.point === "studio.plugin");
  assert.ok(entry, "no studio.plugin contribution");
  const payload = entry.payload as { settingsOwner?: string; enabledKey?: string };

  assert.equal(payload.settingsOwner, decl.id, "the roster entry points at another owner's settings");
  assert.equal(
    payload.enabledKey,
    declEnabledKey,
    "the roster entry and the decl disagree about which row means 'on'"
  );
  assert.ok(
    decl.settings.rows.some((r) => r.key === payload.enabledKey),
    `enabledKey "${payload.enabledKey}" is not a declared row — a manager writing it would be ` +
      "refused by the store, and the switch would do nothing at all"
  );
});

test("the SDK settings section names an owner that declares rows", () => {
  const section = contributions.find((c) => c.point === "studio.settings-section");
  assert.ok(section, "no studio.settings-section contribution");
  const payload = section.payload as { ownerId: string };
  assert.equal(payload.ownerId, decl.id);
  assert.ok(
    decl.settings.rows.length > 0,
    "the section opens a dialog for an owner with nothing in it"
  );
});

test("the settings decl is structurally valid, and stays under the ceiling", () => {
  assert.deepEqual(validateSettingsDecl(decl.id, decl.settings), []);
  // The minimal-sui rule, as a number. GizmoX's top-strip carried ~70 settings;
  // the port keeps the ones that decide BEHAVIOUR and lets the theme own every
  // drawing decision. This is not a style preference — it is the standing
  // directive that a row earns its place only when the surface cannot work
  // properly without it, and a ratchet is the only form of it a test can hold.
  assert.ok(
    decl.settings.rows.length <= 10,
    `the tab bar declares ${decl.settings.rows.length} settings — the ceiling stands; a new row ` +
      "has to displace one or justify raising this number in the same edit"
  );
});

test("every menu area is namespaced to the plugin, and carries rows", () => {
  assert.ok(decl.menus.areas.length >= 1);
  for (const area of decl.menus.areas) {
    assert.ok(
      area.id.startsWith(`${decl.id}.`),
      `area "${area.id}" is not namespaced — areas are global and a bare id collides`
    );
    assert.ok(
      (decl.menus.items[area.id] ?? []).length > 0,
      `area "${area.id}" is declared with no rows, so a right-click there adds nothing`
    );
  }
});

/**
 * @file The landing OVERRIDE layer — the seam that lets the theme designer's
 * Surfaces tab edit a landing without touching its framework-authored asset.
 *
 * The properties worth holding are all about the split not leaking: the asset
 * must stay the default, the override must win while it exists, a malformed or
 * stale override must degrade to the asset rather than to a broken page, and
 * nothing structural (route, role, id) may be overridable — because those are
 * how the session gate finds the front door.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { defineXLanding } from "@axs/x-landing/define";
import { SOURCE_LANDINGS } from "@axs/x-landing/landings";
import {
  EMPTY_OVERRIDES,
  isOverridden,
  parseOverridesDoc,
  resolveLanding
} from "@axs/x-landing/overrides";

const asset = defineXLanding(SOURCE_LANDINGS[0]);

test("landing overrides: no document means the asset stands, unchanged", () => {
  assert.deepEqual(resolveLanding(asset, null), asset);
  assert.deepEqual(resolveLanding(asset, EMPTY_OVERRIDES), asset);
  assert.equal(isOverridden(asset, EMPTY_OVERRIDES), false);
});

test("landing overrides: an override wins over the asset while it exists", () => {
  const doc = parseOverridesDoc({ byId: { [asset.id]: { logo: "lk001-glow", cardOpacity: 0.8 } } });
  const shown = resolveLanding(asset, doc);
  assert.equal(shown.assets.logo, "lk001-glow");
  assert.equal(shown.cardOpacity, 0.8);
  assert.equal(isOverridden(asset, doc), true);
  // and the ASSET is untouched — this is the whole point of the split
  assert.equal(asset.assets.logo, SOURCE_LANDINGS[0].assets.logo);
});

test("landing overrides: a logo id that does not resolve is DROPPED, not rendered", () => {
  /*
   * A kit deleted or a slug renamed would otherwise leave a stored id pointing
   * at nothing and the landing would draw an empty hero — the dangling-reference
   * failure `defineXLanding` refuses at author time. The override layer has to
   * refuse it at read time too, because it is written long after that check ran.
   */
  const doc = parseOverridesDoc({ byId: { [asset.id]: { logo: "lk999-nope" } } });
  assert.deepEqual(doc.byId[asset.id], undefined);
  assert.equal(resolveLanding(asset, doc).assets.logo, asset.assets.logo);
});

test("landing overrides: out-of-range and malformed values are dropped", () => {
  for (const bad of [{ cardOpacity: 1.5 }, { cardOpacity: -1 }, { cardOpacity: "0.5" }, { logo: 42 }]) {
    const doc = parseOverridesDoc({ byId: { [asset.id]: bad } });
    assert.deepEqual(resolveLanding(asset, doc), asset, `${JSON.stringify(bad)} should not survive parsing`);
  }
  for (const junk of [null, undefined, 7, "x", { byId: 3 }, { byId: { [asset.id]: null } }]) {
    assert.deepEqual(parseOverridesDoc(junk), EMPTY_OVERRIDES);
  }
});

test("landing overrides: route, role and id are NOT overridable", () => {
  /*
   * The session gate resolves the front door from the landing's `route` and
   * `role`. If a stored document could change either, a click in a designer tab
   * could repoint the gate at a route that does not exist — the lock-out
   * `publicPaths.ts` warns about, reachable from a colour picker.
   */
  const doc = parseOverridesDoc({
    byId: { [asset.id]: { route: "/hijacked", role: "page", id: "xl999", logo: "lk001-glow" } }
  });
  const shown = resolveLanding(asset, doc);
  assert.equal(shown.route, asset.route, "route must not be overridable");
  assert.equal(shown.role, asset.role, "role must not be overridable");
  assert.equal(shown.id, asset.id, "id must not be overridable");
  assert.equal(shown.assets.logo, "lk001-glow", "the overridable field still applied");
});

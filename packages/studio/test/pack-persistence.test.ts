/**
 * @file The brand gallery's selection, as a contract: it is SAVED, it is
 * RESTORED, and the app's own defaults do not overwrite it on the way back up.
 *
 * The bug this locks down was not in the gallery at all. `packs.activate()` had
 * one tier, so the gallery's click and the two boot-time activations (Studio's
 * `start()`, the console wrapper's look) were the same operation — and the boot
 * ones always run last. Selecting an identity therefore worked perfectly for
 * exactly as long as the tab stayed open.
 *
 * So the tests are written against the real boot ORDER rather than against the
 * store's methods in isolation: restore, register, apply defaults, and only
 * then ask what is in force. A persistence test that never replays boot is a
 * test that passes while the app still forgets.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PACKS_KEY, PackRegistry } from "@axf/core";
import type { BrandingPackage, LogoPackage, PackStorage } from "@axf/core";

/* ------------------------------------------------------------- fixtures */

/** Legible against `page` in both directions — `register()` refuses palettes
 *  that are not, and a fixture that trips that guard tests the guard. */
function palette(accent: string, page: string, ink: string) {
  return {
    accent,
    accent2: "#4f8ef7",
    accent3: "#b06df7",
    ink,
    dim: "#8d8d8d",
    edge: "#3a3a3a",
    page,
    ok: "#3fb27f",
    warn: "#f5a623",
    err: "#e5484d"
  };
}

function branding(id: string, accent: string): BrandingPackage {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: `${id} fixture`,
    author: "test",
    type: "branding-package",
    payload: {
      schemaVersion: 1,
      palette: palette(accent, "#0f0d0b", "#f7f2ea"),
      entries: [
        { id: "mark", label: "mark", category: "mark", svg: `<svg viewBox="0 0 8 8"/>` }
      ]
    }
  };
}

function logos(id: string): LogoPackage {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: `${id} fixture`,
    author: "test",
    type: "logo-package",
    payload: { schemaVersion: 1, entries: [] }
  };
}

function style(id: string, accent: string): StylePackage {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: `${id} fixture`,
    author: "test",
    type: "branding-package",
    payload: {
      schemaVersion: 1,
      palette: palette(accent, "#0f0d0b", "#f7f2ea"),
      typography: {
        sans: "sans-serif",
        mono: "monospace",
        scale: { title: 19, body: 13, label: 11, micro: 9 },
        weight: { normal: 400, strong: 700 },
        tracking: "0.02em"
      },
      shape: {
        radius: "6px",
        radiusTight: "3px",
        border: "1px",
        shadow: "none",
        density: "normal"
      },
      overrides: []
    }
  };
}

/* These were `style(...)` fixtures until 2026-08-12. The style slot is no
   longer resolved — a style pack became a template you APPLY rather than a
   selection you are in — so a test asserting "the selected pack is the resolved
   one" has to use a slot that still resolves. Nothing about what this file
   PROVES changed: activate/clearChoice/restore/hydration are generic over
   slots, and the branding slot exercises every one of them. */
const APP_DEFAULT = branding("app-default-style", "#ff7a1a");
const PICKED = branding("picked-style", "#00b3ff");
const DEFAULT_LOGOS = logos("app-default-logos");

/** A `PackStorage` over a plain object, so a test can inspect and forge it. */
function fakeStorage(seed?: Record<string, string>) {
  const cells = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    cells,
    storage: {
      read: (k: string) => cells.get(k) ?? null,
      write: (k: string, v: string) => void cells.set(k, v)
    } satisfies PackStorage
  };
}

/**
 * Boot, in the order the app boots: the registry is CONSTRUCTED first (which is
 * when a stored selection is restored), then packs register, then the app
 * states its defaults. Everything below runs through this, because the order is
 * the thing that was broken.
 */
function boot(storage: PackStorage): PackRegistry {
  const registry = new PackRegistry(storage);
  registry.register(APP_DEFAULT);
  registry.register(PICKED);
  registry.register(DEFAULT_LOGOS);
  registry.activateDefault(APP_DEFAULT.id);
  registry.activateDefault(DEFAULT_LOGOS.id);
  return registry;
}

/* ---------------------------------------------------------------- tests */

describe("pack selection survives a reload", () => {
  it("a first visit runs on the app's defaults and stores nothing", () => {
    const { cells, storage } = fakeStorage();
    const registry = boot(storage);

    assert.equal(registry.resolved().brandingId, APP_DEFAULT.id);
    assert.deepEqual(registry.resolved().chosen, []);
    assert.equal(cells.has(PACKS_KEY), false, "a default is code, never a saved preference");
  });

  it("selecting writes immediately — no save step", () => {
    const { cells, storage } = fakeStorage();
    const registry = boot(storage);

    registry.activate(PICKED.id);

    assert.equal(registry.resolved().brandingId, PICKED.id);
    assert.deepEqual(JSON.parse(cells.get(PACKS_KEY)!), {
      chosen: { "branding-package": PICKED.id }
    });
  });

  it("the next boot restores it, and the app's default does NOT take it back", () => {
    const { storage } = fakeStorage();
    boot(storage).activate(PICKED.id);

    // A second registry over the same storage IS the reload — same construction,
    // same registrations, same defaults, in the same order.
    const reloaded = boot(storage);

    assert.equal(
      reloaded.resolved().brandingId,
      PICKED.id,
      "activateDefault ran after the restore and must not have overwritten it"
    );
    assert.deepEqual(reloaded.resolved().chosen, ["branding-package"]);
    // The slot nobody chose still follows the app.
    assert.equal(reloaded.resolved().logoId, DEFAULT_LOGOS.id);
  });

  it("a plain activate() at boot loses the selection — the defect, still red", () => {
    const { storage } = fakeStorage();
    boot(storage).activate(PICKED.id);

    // Exactly the old code path: the boot look stating itself as a SELECTION.
    const reloaded = new PackRegistry(storage);
    reloaded.register(APP_DEFAULT);
    reloaded.register(PICKED);
    reloaded.activate(APP_DEFAULT.id);

    assert.equal(
      reloaded.resolved().brandingId,
      APP_DEFAULT.id,
      "if this ever equals picked-style, the two tiers have collapsed back into one"
    );
  });

  it("clearChoice hands the slot back to the app default, and forgets it on disk", () => {
    const { cells, storage } = fakeStorage();
    const registry = boot(storage);
    registry.activate(PICKED.id);

    registry.clearChoice("branding-package");

    assert.equal(registry.resolved().brandingId, APP_DEFAULT.id);
    assert.deepEqual(registry.resolved().chosen, []);
    assert.deepEqual(JSON.parse(cells.get(PACKS_KEY)!), { chosen: {} });
    assert.equal(boot(storage).resolved().brandingId, APP_DEFAULT.id, "and it stays cleared");
  });

  it("clearing a slot on purpose is remembered as a choice, not as absence", () => {
    const { storage } = fakeStorage();
    const registry = boot(storage);

    registry.activate(null, "branding-package");
    assert.equal(registry.resolved().brandingId, null);

    // The distinction the persisted record has to carry: a key present with
    // `null` ("none, deliberately") outranks the default; an absent key does not.
    assert.equal(boot(storage).resolved().brandingId, null);
  });
});

describe("a stored selection is not trusted blindly", () => {
  it("an id nothing registers falls back and is REPORTED", () => {
    const { storage } = fakeStorage({
      [PACKS_KEY]: JSON.stringify({ chosen: { "branding-package": "deleted-style" } })
    });
    const registry = boot(storage);

    assert.equal(registry.resolved().brandingId, APP_DEFAULT.id, "the app still boots");
    assert.deepEqual(registry.resolved().unresolved, ["deleted-style"]);
  });

  it("a corrupt record starts from the defaults instead of throwing", () => {
    for (const raw of ["{not json", JSON.stringify({ chosen: "nope" }), "null"]) {
      const { storage } = fakeStorage({ [PACKS_KEY]: raw });
      const registry = boot(storage);
      assert.equal(registry.resolved().brandingId, APP_DEFAULT.id, `recovered from ${raw}`);
      assert.deepEqual(registry.resolved().chosen, []);
    }
  });

  it("a non-string id in the record is ignored, not activated", () => {
    const { storage } = fakeStorage({
      [PACKS_KEY]: JSON.stringify({ chosen: { "branding-package": 42 } })
    });
    assert.equal(boot(storage).resolved().brandingId, APP_DEFAULT.id);
  });
});

describe("the default storage — the seam the app actually runs on", () => {
  /** Drive the no-argument constructor against a stand-in `window`, so the
   *  branch the browser takes is exercised rather than described. Every test
   *  above injects storage and would pass with `browserStorage()` broken. */
  function withWindow<T>(localStorage: unknown, fn: () => T): T {
    const holder = globalThis as { window?: unknown };
    const had = "window" in holder;
    const previous = holder.window;
    holder.window = { localStorage };
    try {
      return fn();
    } finally {
      if (had) holder.window = previous;
      else delete holder.window;
    }
  }

  it("reads and writes localStorage when there is a window", () => {
    const cells = new Map<string, string>();
    const localStorage = {
      getItem: (k: string) => cells.get(k) ?? null,
      setItem: (k: string, v: string) => void cells.set(k, v)
    };

    withWindow(localStorage, () => {
      const registry = new PackRegistry();
      registry.register(PICKED);
      registry.activate(PICKED.id);
    });
    assert.deepEqual(JSON.parse(cells.get(PACKS_KEY)!), {
      chosen: { "branding-package": PICKED.id }
    });

    const restored = withWindow(localStorage, () => {
      const registry = new PackRegistry();
      registry.register(APP_DEFAULT);
      registry.register(PICKED);
      registry.activateDefault(APP_DEFAULT.id);
      return registry.resolved().brandingId;
    });
    assert.equal(restored, PICKED.id);
  });

  it("a window whose storage throws still applies the identity", () => {
    const hostile = {
      getItem() {
        throw new Error("disabled");
      },
      setItem() {
        throw new Error("disabled");
      }
    };
    withWindow(hostile, () => {
      const registry = new PackRegistry();
      registry.register(PICKED);
      registry.activate(PICKED.id);
      assert.equal(registry.resolved().brandingId, PICKED.id);
    });
  });

  it("no window at all is the server, and it falls back to memory", () => {
    const registry = new PackRegistry();
    registry.register(PICKED);
    registry.activate(PICKED.id);
    assert.equal(registry.resolved().brandingId, PICKED.id);
  });
});

describe("the hydration contract", () => {
  it("serverResolved ignores the stored selection; resolved honours it", () => {
    const { storage } = fakeStorage();
    boot(storage).activate(PICKED.id);
    const reloaded = boot(storage);

    // The server never read storage, so this is what its HTML contains — and a
    // <Glyph> writes its pack's SVG into that HTML, so a disagreement here is
    // React throwing the whole tree away on hydration.
    assert.equal(reloaded.serverResolved().brandingId, APP_DEFAULT.id);
    assert.deepEqual(reloaded.serverResolved().chosen, []);
    assert.equal(reloaded.resolved().brandingId, PICKED.id);
  });

  it("both snapshots are cached — an unstable one is an infinite render loop", () => {
    const { storage } = fakeStorage();
    const registry = boot(storage);

    assert.equal(registry.resolved(), registry.resolved());
    assert.equal(registry.serverResolved(), registry.serverResolved());

    const server = registry.serverResolved();
    registry.activate(PICKED.id);
    assert.notEqual(registry.resolved(), server, "a selection changes what is in force");
    assert.equal(
      registry.serverResolved(),
      server,
      "but cannot change what the server rendered, for the whole hydration pass"
    );
  });

  it("subscribers are notified on a selection, so the swap is still hot", () => {
    const { storage } = fakeStorage();
    const registry = boot(storage);
    let beats = 0;
    registry.subscribe(() => beats++);

    registry.activate(PICKED.id);
    registry.clearChoice("branding-package");

    assert.equal(beats, 2);
  });
});

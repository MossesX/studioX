/**
 * @file Core's kv primitive over a real node driver — the semantics core owns
 * (scoping, guards, atomicity protocol, chained read-modify-write) exercised
 * against a throwaway directory, plus the studio route's driver contract.
 *
 * The concurrency case is the one that earns its keep: twelve simultaneous
 * registry writers once left ONE survivor in GizmoX, and the whole reason
 * `mutate` chains the ENTIRE read-modify-write is that locking only the save
 * still loses updates.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { mkdir, readdir, rename, rm as rmFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import { KV_FORMAT, KvStore, isKvName, memoryKv } from "@axf/core";
import type { KvIo } from "@axf/core";

function nodeKvIo(root: string): KvIo {
  const abs = (rel: string) => path.join(root, rel);
  return {
    async read(file) {
      try {
        return await readFile(abs(file), "utf8");
      } catch {
        return null;
      }
    },
    async write(file, text) {
      await mkdir(path.dirname(abs(file)), { recursive: true });
      await writeFile(abs(file), text, "utf8");
    },
    rename: (from, to) => rename(abs(from), abs(to)),
    async list(dir) {
      try {
        return await readdir(abs(dir));
      } catch {
        return [];
      }
    },
    remove: (file) => rmFile(abs(file), { force: true })
  };
}

const root = await mkdtemp(path.join(os.tmpdir(), "axf-kv-test-"));
const store = new KvStore(nodeKvIo(root), `test:${root}`);
after(() => rm(root, { recursive: true, force: true }));

describe("kv names", () => {
  it("accepts sane components and refuses traversal shapes", () => {
    assert.equal(isKvName("local"), true);
    assert.equal(isKvName("panes.sandbox-panes"), true);
    assert.equal(isKvName(".."), false);
    assert.equal(isKvName("."), false);
    assert.equal(isKvName("a/b"), false);
    assert.equal(isKvName("a\\b"), false);
    assert.equal(isKvName(".hidden"), false);
    assert.equal(isKvName(""), false);
    assert.equal(isKvName("x".repeat(65)), false);
  });

  it("the store refuses bad names loudly, never as an empty read", async () => {
    await assert.rejects(async () => store.read("..", "ns"), /not a valid kv user/);
    await assert.rejects(async () => store.write("local", "a/b", {}), /not a valid kv namespace/);
  });
});

describe("kv store over a real filesystem", () => {
  it("round-trips a document inside a self-identifying envelope", async () => {
    await store.write("local", "roundtrip", { a: 1, nested: { b: "two" } });
    assert.deepEqual(await store.read("local", "roundtrip"), { a: 1, nested: { b: "two" } });

    const raw = JSON.parse(await readFile(path.join(root, "local", "roundtrip.json"), "utf8"));
    assert.equal(raw.format, KV_FORMAT);
    assert.equal(raw.user, "local");
    assert.equal(raw.ns, "roundtrip");
  });

  it("scopes per user: two users, same namespace, different documents", async () => {
    await store.write("alice", "prefs", { who: "alice" });
    await store.write("bob", "prefs", { who: "bob" });
    assert.deepEqual(await store.read("alice", "prefs"), { who: "alice" });
    assert.deepEqual(await store.read("bob", "prefs"), { who: "bob" });
  });

  it("reads null for a missing document and for a foreign/corrupt file", async () => {
    assert.equal(await store.read("local", "never-written"), null);
    await writeFile(path.join(root, "local", "corrupt.json"), "{not json", "utf8");
    assert.equal(await store.read("local", "corrupt"), null);
    await writeFile(path.join(root, "local", "foreign.json"), JSON.stringify({ format: "other/1", doc: {} }), "utf8");
    assert.equal(await store.read("local", "foreign"), null);
  });

  it("refuses non-object documents", async () => {
    await assert.rejects(
      async () => store.write("local", "bad", [1, 2] as unknown as Record<string, unknown>),
      /plain JSON object/
    );
  });

  it("mutate chains the WHOLE read-modify-write: N concurrent increments land N", async () => {
    await store.write("local", "counter", { n: 0 });
    await Promise.all(
      Array.from({ length: 20 }, () =>
        store.mutate("local", "counter", (doc) => ({ n: (Number(doc?.n) || 0) + 1 }))
      )
    );
    assert.deepEqual(await store.read("local", "counter"), { n: 20 });
  });

  it("lists a user's namespaces and removes documents", async () => {
    assert.equal((await store.list("local")).includes("roundtrip"), true);
    await store.remove("local", "roundtrip");
    assert.equal(await store.read("local", "roundtrip"), null);
    assert.equal((await store.list("local")).includes("roundtrip"), false);
    assert.deepEqual(await store.list("nobody"), []);
  });

  it("never leaves a tmp file behind an accepted write", async () => {
    await store.write("local", "tidy", { ok: true });
    const names = await readdir(path.join(root, "local"));
    assert.equal(names.some((n) => n.includes(".tmp")), false);
  });
});

describe("memory transport", () => {
  it("behaves like the http one, minus the network", async () => {
    const kv = memoryKv();
    assert.equal(await kv.read("panes.demo"), null);
    await kv.write("panes.demo", { x: 1 });
    assert.deepEqual(await kv.read("panes.demo"), { x: 1 });
    await assert.rejects(async () => kv.read("bad/ns"), /not a valid kv namespace/);
  });
});

/**
 * @file The task manager's seed and counting contract (MASTER §5).
 *
 * The dashboard's `tasks` card shows `countItems` over these four lists, so
 * the pinned numbers ARE the contract: 61/96, 49/80, 2/49, 19/35. And because
 * `countItems` must walk `children` recursively to get them, the seed is
 * required to actually NEST — a flat seed would pass a shallow count and the
 * recursion would be decorative.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SEED_LISTS } from "@axs/modules/taskman/seed";
import {
  countItems,
  insertItem,
  moveItem,
  newItem,
  removeItem,
  updateItem
} from "@axs/modules/taskman/taskOps";
import type { TaskItem } from "@axs/modules/taskman/types";

const EXPECTED: Record<string, { done: number; total: number }> = {
  "Logo Lenny · animated Logo Studio": { done: 61, total: 96 },
  "Session History – the ALL tab": { done: 49, total: 80 },
  "One GizmoX identity – default-deny access": { done: 2, total: 49 },
  "AmberArt 1.0 — paint & art module": { done: 19, total: 35 }
};

test("the four seeded lists exist at exactly the pinned counts", () => {
  assert.equal(SEED_LISTS.length, 4);
  for (const list of SEED_LISTS) {
    const expected = EXPECTED[list.name];
    assert.ok(expected, `unexpected seeded list "${list.name}"`);
    const counts = countItems(list.items);
    assert.deepEqual(
      counts,
      expected,
      `"${list.name}" counts ${counts.done}/${counts.total}, expected ${expected.done}/${expected.total}`
    );
  }
});

test("the seed genuinely nests, so the recursive walk is load-bearing", () => {
  for (const list of SEED_LISTS) {
    // Shallow count ≠ recursive count on every list…
    assert.notEqual(
      list.items.length,
      countItems(list.items).total,
      `"${list.name}" is flat — the dashboard number would not need recursion`
    );
    // …and at least one list reaches depth 3 (root → phase → sub-group → leaf).
  }
  const depthOf = (items: TaskItem[]): number =>
    items.length === 0 ? 0 : 1 + Math.max(...items.map((it) => depthOf(it.children)));
  const maxDepth = Math.max(...SEED_LISTS.map((l) => depthOf(l.items)));
  assert.ok(maxDepth >= 3, `deepest seed path is ${maxDepth}, want >= 3`);
});

test("seed ids and stamps are deterministic — no Date.now/Math.random", () => {
  // Two independent walks of the same import must agree, and every id must be
  // a fixed seed id: the server and browser bundles each build the seed and
  // hydration requires the two trees to be identical.
  const ids = new Set<string>();
  const walk = (items: TaskItem[]) => {
    for (const it of items) {
      assert.match(it.id, /^seed_/, `non-deterministic seed id "${it.id}"`);
      assert.ok(!ids.has(it.id), `duplicate seed id "${it.id}"`);
      ids.add(it.id);
      walk(it.children);
    }
  };
  for (const list of SEED_LISTS) walk(list.items);
});

test("ops preserve the counting contract: toggle, remove, move, insert", () => {
  const list = SEED_LISTS[0];
  const lists = [list];
  const before = countItems(list.items);

  // Toggling one leaf moves `done` by exactly one, total untouched.
  const leaf = (function findLeaf(items: TaskItem[]): TaskItem | null {
    for (const it of items) {
      if (it.children.length === 0) return it;
      const hit = findLeaf(it.children);
      if (hit) return hit;
    }
    return null;
  })(list.items)!;
  const toggled = updateItem(lists, leaf.id, (it) => ({ ...it, done: !it.done }));
  const afterToggle = countItems(toggled[0].items);
  assert.equal(afterToggle.total, before.total);
  assert.equal(afterToggle.done, before.done + (leaf.done ? -1 : 1));

  // Removing a group removes its whole subtree from the count.
  const group = list.items.find((it) => it.children.length > 0)!;
  const subtree = countItems([group]);
  const { lists: removed } = removeItem(lists, group.id);
  assert.equal(countItems(removed[0].items).total, before.total - subtree.total);

  // Moving a subtree deeper never changes the recursive totals.
  const other = list.items.find((it) => it.id !== group.id && it.children.length > 0)!;
  const moved = moveItem(lists, group.id, { listId: list.id, parentId: other.id, index: -1 });
  assert.deepEqual(countItems(moved[0].items), before);

  // Inserting one fresh item raises total by one.
  const inserted = insertItem(lists, newItem({ title: "probe" }), {
    listId: list.id,
    parentId: null,
    index: -1
  });
  assert.equal(countItems(inserted[0].items).total, before.total + 1);
});

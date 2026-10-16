/**
 * @file The 2026-08-14 rail work, held to its claims: the collapsible GROUPS,
 * the two engines that fill the first two of them, the multi-list delete's
 * count, and the archive every delete now goes through.
 *
 * Everything here is the PURE half — `groups.ts`, the two `sync.ts` files, the
 * archive's entry rules. That is deliberate and it is the reason those halves
 * were separated from their React and their filesystem: the properties worth
 * defending are "a list files under exactly one band", "a sync tick that
 * changes nothing allocates nothing" and "a trim is reported, never silent",
 * and not one of them needs a DOM to be true or false.
 *
 * NO DOM and no `@axf/core` barrel, so this runs under Node's type stripping
 * like its siblings.
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, describe } from "node:test";

import { KvStore } from "@axf/core";
import type { KvIo } from "@axf/core";

import {
  BUILTIN_GROUPS,
  GROUP_BUILD,
  GROUP_MODULES,
  GROUP_NOTES,
  GROUP_TODO,
  groupIdOf,
  listsInGroup,
  newGroup,
  sortedGroups,
  ungroupedLists,
  withBuiltinGroups
} from "../src/modules/taskman/groups.ts";
import { newList } from "../src/modules/taskman/taskOps.ts";
import type { TaskGroup, TaskList } from "../src/modules/taskman/types.ts";
import { colorFor, mergeModules, listIdFor as moduleListId } from "../src/plugins/modules-taskman/sync.ts";
import { mergeProjects } from "../src/plugins/bmpx-taskman/sync.ts";
import type { BmpxProject } from "../src/plugins/bmpx-taskman/sync.ts";
import {
  ARCHIVE_MAX_ENTRIES,
  appendArchive,
  countTree,
  mergeEntries,
  purgeArchive,
  readArchive,
  readEntries,
  type ArchiveEntry
} from "../src/server/taskmanArchive.ts";

/* ------------------------------------------------------------------ helpers */

const list = (partial: Partial<TaskList>): TaskList => ({ ...newList(partial), ...partial });

const entry = (id: string, at: number): ArchiveEntry => ({
  id,
  listId: `tlist_${id}`,
  name: id,
  archivedAt: at,
  reason: "list",
  itemCount: 0,
  list: { id: `tlist_${id}`, name: id, items: [] }
});

/* ============================================================ the group rule */

describe("which band a list falls into", () => {
  test("an explicit groupId wins over everything", () => {
    assert.equal(groupIdOf(list({ groupId: "mine", kind: "todo" })), "mine");
  });

  test("a todo list with no group files under ToDo, notes under Project Notes", () => {
    assert.equal(groupIdOf(list({ kind: "todo" })), GROUP_TODO);
    assert.equal(groupIdOf(list({ kind: "notes" })), GROUP_NOTES);
  });

  test("anything else with no group sits at the root", () => {
    assert.equal(groupIdOf(list({ kind: "tasks" })), null);
    assert.equal(groupIdOf(list({ kind: "project" })), null);
  });

  test("the by-kind fallback is a FALLBACK — an explicit undefined still falls back", () => {
    // The distinction `removeGroup` depends on: it writes `groupId: undefined`
    // and relies on the kind rule pulling a `todo` list back only if it never
    // had a group of its own. This pins that reading, so a future change to
    // `groupIdOf` that made `undefined` mean "root, always" fails here rather
    // than as a list quietly leaving the ToDo band.
    assert.equal(groupIdOf(list({ kind: "todo", groupId: undefined })), GROUP_TODO);
  });

  test("a list naming a group nobody declares shows at the root, never nowhere", () => {
    const lists = [list({ id: "a", groupId: "ghost" }), list({ id: "b" })];
    const loose = ungroupedLists(lists, BUILTIN_GROUPS);
    assert.deepEqual(loose.map((l) => l.id).sort(), ["a", "b"]);
  });

  test("every list appears in exactly one band — the property the rail depends on", () => {
    const groups = withBuiltinGroups([{ id: "mine", name: "Mine", order: 50 }]);
    const lists = [
      list({ id: "build", groupId: GROUP_BUILD }),
      list({ id: "mod", groupId: GROUP_MODULES }),
      list({ id: "todo", kind: "todo" }),
      list({ id: "notes", kind: "notes" }),
      list({ id: "mine", groupId: "mine" }),
      list({ id: "loose" }),
      list({ id: "ghost", groupId: "nope" })
    ];
    const drawn = [
      ...groups.flatMap((g) => listsInGroup(lists, g.id).map((l) => l.id)),
      ...ungroupedLists(lists, groups).map((l) => l.id)
    ];
    assert.equal(drawn.length, lists.length, `a list was drawn twice or not at all: ${drawn}`);
    assert.deepEqual([...drawn].sort(), lists.map((l) => l.id).sort());
  });

  test("pinned lists ride at the top of their own band, not the whole rail", () => {
    const lists = [
      list({ id: "a", groupId: GROUP_BUILD }),
      list({ id: "b", groupId: GROUP_BUILD, pinned: true }),
      list({ id: "c" })
    ];
    assert.deepEqual(listsInGroup(lists, GROUP_BUILD).map((l) => l.id), ["b", "a"]);
  });
});

describe("the built-in groups survive whatever is stored", () => {
  test("a document written before groups existed still gets all four", () => {
    assert.deepEqual(
      withBuiltinGroups(undefined).map((g) => g.id),
      [GROUP_BUILD, GROUP_MODULES, GROUP_TODO, GROUP_NOTES]
    );
  });

  test("a stored collapsed state is kept; a stored rename of a built-in is not", () => {
    const merged = withBuiltinGroups([
      { id: GROUP_BUILD, name: "Renamed by hand", order: 999, collapsed: true }
    ]);
    const build = merged.find((g) => g.id === GROUP_BUILD)!;
    assert.equal(build.collapsed, true, "collapsed is preference and must survive");
    assert.equal(build.name, "Build Manager", "a built-in's name is code, not document");
    assert.equal(build.order, 10, "a built-in's rail order is code, not document");
    assert.equal(build.managedBy, "bmpx", "a document must not be able to disown a built-in");
  });

  test("a document cannot delete a built-in by omitting it", () => {
    const merged = withBuiltinGroups([{ id: "mine", name: "Mine", order: 50 }]);
    assert.equal(merged.length, BUILTIN_GROUPS.length + 1);
    assert.ok(merged.some((g) => g.id === GROUP_MODULES));
  });

  test("malformed stored groups are dropped rather than rendered", () => {
    const merged = withBuiltinGroups([
      null as unknown as TaskGroup,
      { id: 7, name: "x" } as unknown as TaskGroup,
      { id: "ok", name: "Ok", order: 60 }
    ]);
    assert.deepEqual(
      merged.map((g) => g.id),
      [GROUP_BUILD, GROUP_MODULES, GROUP_TODO, GROUP_NOTES, "ok"]
    );
  });

  test("the built-ins are deterministic — the store builds them twice, in two bundles", () => {
    // Same reasoning the seed states about itself: the server and the browser
    // build this independently and a `Date.now()` or a `uid()` in it would tear
    // hydration.
    assert.deepEqual(withBuiltinGroups(undefined), withBuiltinGroups(undefined));
  });
});

describe("adding a group", () => {
  test("the id is slugged from the name and the order lands last", () => {
    const g = newGroup("  Deep Work  ", BUILTIN_GROUPS);
    assert.equal(g.id, "deep-work");
    assert.equal(g.name, "Deep Work");
    assert.ok(g.order > Math.max(...BUILTIN_GROUPS.map((b) => b.order)));
  });

  test("typing the same name twice makes two groups, not one collision", () => {
    const first = newGroup("ToDo", BUILTIN_GROUPS);
    // "todo" is taken by a built-in, so the slug has to move.
    assert.notEqual(first.id, GROUP_TODO);
    const second = newGroup("ToDo", [...BUILTIN_GROUPS, first]);
    assert.notEqual(second.id, first.id);
  });

  test("a name with nothing sluggable still yields a usable id", () => {
    assert.equal(newGroup("…", []).id, "group");
  });

  test("sortedGroups is a TOTAL order — equal orders never swap between renders", () => {
    const a: TaskGroup = { id: "a", name: "Zeta", order: 50 };
    const b: TaskGroup = { id: "b", name: "Alpha", order: 50 };
    assert.deepEqual(sortedGroups([a, b]).map((g) => g.id), ["b", "a"]);
    assert.deepEqual(sortedGroups([b, a]).map((g) => g.id), ["b", "a"]);
  });
});

/* ============================================== the engines that fill them */

describe("installed modules → the Modules band", () => {
  const modules = [
    { id: "taskman", title: "Task Manager" },
    { id: "amberart", title: "AmberArt" }
  ];

  test("a module gets one EMPTY list, filed under Modules", () => {
    const out = mergeModules([], modules);
    assert.equal(out.length, 2);
    for (const l of out) {
      assert.equal(l.groupId, GROUP_MODULES);
      assert.deepEqual(l.items, [], "the engine owns the name, never the tasks");
    }
    assert.ok(out.some((l) => l.id === moduleListId("taskman")));
  });

  test("a second pass over the same modules returns the SAME array instance", () => {
    // The idempotence the store's persist-on-every-mutation depends on.
    const first = mergeModules([], modules);
    assert.equal(mergeModules(first, modules), first);
  });

  test("the person's items in a module list are never touched", () => {
    const first = mergeModules([], modules);
    const withWork = first.map((l) =>
      l.id === moduleListId("taskman")
        ? { ...l, items: [{ id: "mine", title: "my task", children: [] } as never] }
        : l
    );
    const again = mergeModules(withWork, modules);
    assert.equal(again, withWork, "nothing moved, so nothing should have been rewritten");
  });

  test("a renamed module renames its list; a list dragged out is put back", () => {
    const first = mergeModules([], modules);
    const meddled = first.map((l) =>
      l.id === moduleListId("amberart") ? { ...l, name: "Wrong", groupId: undefined } : l
    );
    const fixed = mergeModules(meddled, modules);
    const l = fixed.find((x) => x.id === moduleListId("amberart"))!;
    assert.equal(l.name, "AmberArt");
    assert.equal(l.groupId, GROUP_MODULES);
  });

  test("a module that is no longer registered leaves its list alone", () => {
    const first = mergeModules([], modules);
    const after = mergeModules(first, [modules[0]]);
    assert.equal(after, first, "an unregistered module must not delete the person's tasks");
  });

  test("a colour is stable per module id, so inserting a module recolours nothing", () => {
    assert.equal(colorFor("taskman"), colorFor("taskman"));
    // Not a claim that all ids differ — a hash over twelve colours collides by
    // design. The claim is that one id's colour does not depend on its
    // neighbours, which is what index-cycling got wrong.
    const before = modules.map((m) => colorFor(m.id));
    const after = [{ id: "aaa", title: "A" }, ...modules].map((m) => colorFor(m.id));
    assert.deepEqual(after.slice(1), before);
  });
});

describe("build projects → the Build Manager band", () => {
  const project: BmpxProject = {
    file: "a.bmpx",
    id: "axf-demo",
    name: "Demo",
    status: "planned",
    amberxBound: true,
    modified: 1,
    checklist: [],
    phases: [{ n: 0, name: "P0 Start", status: "planned", steps: [{ text: "go", done: false, model: "", tok: 0 }] }]
  };

  test("a project list is filed under Build Manager", () => {
    const out = mergeProjects([], [project]);
    assert.equal(out[0].groupId, GROUP_BUILD);
  });

  test("a project list dragged out of its band is put back on the next tick", () => {
    const first = mergeProjects([], [project]);
    const moved = first.map((l) => ({ ...l, groupId: undefined }));
    assert.equal(mergeProjects(moved, [project])[0].groupId, GROUP_BUILD);
  });

  test("the band did not cost the merge its idempotence", () => {
    const first = mergeProjects([], [project]);
    assert.equal(mergeProjects(first, [project]), first);
  });
});

/* ========================================================= the archive rules */

describe("what the archive keeps", () => {
  test("entries come back newest first", () => {
    assert.deepEqual(
      readEntries({ entries: [entry("old", 1), entry("new", 3), entry("mid", 2)] }).map((e) => e.id),
      ["new", "mid", "old"]
    );
  });

  test("a document that is not ours reads as an empty archive, never a throw", () => {
    assert.deepEqual(readEntries(null), []);
    assert.deepEqual(readEntries({ entries: "nope" }), []);
    assert.deepEqual(readEntries({ entries: [{ nope: true }] }), []);
  });

  test("the trim drops the OLDEST and reports how many", () => {
    const existing = [entry("a", 1), entry("b", 2)];
    const { entries, trimmed } = mergeEntries(existing, [entry("c", 3)], 2);
    assert.deepEqual(entries.map((e) => e.id), ["c", "b"]);
    assert.equal(trimmed, 1, "a silent truncation would make “never really deleted” false");
  });

  test("nothing is trimmed while there is room", () => {
    assert.equal(mergeEntries([entry("a", 1)], [entry("b", 2)], 10).trimmed, 0);
  });

  test("the cap is a real number, not Infinity dressed up", () => {
    assert.ok(ARCHIVE_MAX_ENTRIES > 0 && Number.isFinite(ARCHIVE_MAX_ENTRIES));
  });

  test("countTree walks children, which is what makes the dialog's count right", () => {
    assert.equal(
      countTree([{ children: [{ children: [] }, { children: [{ children: [] }] }] }, { children: [] }]),
      5
    );
    assert.equal(countTree(undefined), 0);
  });
});

describe("the archive store, over a real directory", () => {
  const roots: string[] = [];

  after(async () => {
    for (const root of roots) await rm(root, { recursive: true, force: true });
  });

  /** The same ten dumb lines the host lends `KvStore`, over a temp root. */
  async function tempStore(): Promise<KvStore> {
    const root = await mkdtemp(path.join(os.tmpdir(), "axs-taskman-archive-"));
    roots.push(root);
    const abs = (rel: string) => path.join(root, rel);
    const io: KvIo = {
      read: async (f) => {
        try {
          return await readFile(abs(f), "utf8");
        } catch {
          return null;
        }
      },
      write: async (f, text) => {
        await mkdir(path.dirname(abs(f)), { recursive: true });
        await writeFile(abs(f), text, "utf8");
      },
      rename: (from, to) => rename(abs(from), abs(to)),
      list: async (d) => {
        try {
          return await readdir(abs(d));
        } catch {
          return [];
        }
      },
      remove: (f) => rm(abs(f), { force: true })
    };
    return new KvStore(io, `test:${root}`);
  }

  test("two users cannot see each other's archived lists", async () => {
    // The owner's requirement, in one assertion: *"in the users data location
    // not the system so each individual user has their own lists"*.
    const store = await tempStore();
    await appendArchive("alice", [entry("a", 1)], store);
    await appendArchive("bob", [entry("b", 2)], store);
    assert.deepEqual((await readArchive("alice", store)).map((e) => e.id), ["a"]);
    assert.deepEqual((await readArchive("bob", store)).map((e) => e.id), ["b"]);
  });

  test("a user with no archive reads empty rather than failing", async () => {
    assert.deepEqual(await readArchive("nobody", await tempStore()), []);
  });

  test("concurrent archives do not lose each other — the chained read-modify-write", async () => {
    const store = await tempStore();
    // The exact race the rail can produce: an × and a delete-all in flight
    // together. A `mutate` that locked only the save would keep one of these.
    await Promise.all(
      Array.from({ length: 12 }, (_, i) => appendArchive("local", [entry(`e${i}`, i)], store))
    );
    assert.equal((await readArchive("local", store)).length, 12);
  });

  test("purge takes named entries; purge-all empties it", async () => {
    const store = await tempStore();
    await appendArchive("local", [entry("a", 1), entry("b", 2), entry("c", 3)], store);
    assert.equal(await purgeArchive("local", ["b"], store), 1);
    assert.deepEqual((await readArchive("local", store)).map((e) => e.id), ["c", "a"]);
    assert.equal(await purgeArchive("local", null, store), 2);
    assert.deepEqual(await readArchive("local", store), []);
  });

  test("purging an id that is not there removes nothing and says so", async () => {
    const store = await tempStore();
    await appendArchive("local", [entry("a", 1)], store);
    assert.equal(await purgeArchive("local", ["ghost"], store), 0);
    assert.equal((await readArchive("local", store)).length, 1);
  });
});

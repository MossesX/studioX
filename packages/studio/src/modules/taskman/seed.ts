/**
 * @file The seeded task lists — the four GizmoX build efforts the dashboard's
 * `tasks` card shows, at exactly the counts MASTER §4.1/§5 pins:
 *
 *   Logo Lenny · animated Logo Studio            61 / 96
 *   Session History – the ALL tab                49 / 80
 *   One GizmoX identity – default-deny access     2 / 49
 *   AmberArt 1.0 — paint & art module            19 / 35
 *
 * Only the list CONTENTS are seeded — the store, the ops and the UI treat
 * these like any other lists. The trees nest two levels deep on purpose:
 * `countItems` walks `children` recursively, and a flat seed would leave that
 * recursion decorative. `test/taskman-seed.test.ts` locks all four counts.
 *
 * Everything here is deterministic — fixed ids, a fixed timestamp, no
 * `Date.now()`/`Math.random()` — because the seed is built independently in
 * the server and browser bundles and the two must agree or hydration tears.
 */
import type { ListKind, TaskItem, TaskList } from "./types";

/** One fixed stamp for every seeded node: the day the seed was authored. */
const SEED_STAMP = Date.UTC(2026, 7, 8);

/**
 * Declarative seed grammar: a string is one leaf; `{ gen, n }` is `n` leaves
 * titled "<gen> 1"…"<gen> n"; `{ title, children }` is a group node with a
 * subtree. Groups count as items themselves — the walk below and `countItems`
 * agree on that, which is what makes the totals below checkable by eye.
 */
type SeedNode = string | { gen: string; n: number } | { title: string; children: SeedNode[] };

interface SeedListSpec {
  id: string;
  name: string;
  kind: ListKind;
  color: string;
  icon: string;
  /** Items marked done, depth-first from the top — a build in progress reads
   *  as its early phases finished, not as random ticks. */
  done: number;
  children: SeedNode[];
}

function buildItems(spec: SeedListSpec): TaskItem[] {
  let serial = 0;
  let remainingDone = spec.done;

  const item = (title: string, children: TaskItem[]): TaskItem => {
    serial += 1;
    const done = remainingDone > 0;
    if (done) remainingDone -= 1;
    return {
      id: `seed_${spec.id}_${serial}`,
      title,
      done,
      type: children.length ? "milestone" : "task",
      action: "none",
      category: "",
      color: spec.color,
      icon: children.length ? "flag" : "task",
      priority: 0,
      notes: "",
      children,
      createdAt: SEED_STAMP,
      updatedAt: SEED_STAMP
    };
  };

  const build = (nodes: SeedNode[]): TaskItem[] => {
    const out: TaskItem[] = [];
    for (const node of nodes) {
      if (typeof node === "string") {
        out.push(item(node, []));
      } else if ("gen" in node) {
        for (let i = 1; i <= node.n; i++) out.push(item(`${node.gen} ${i}`, []));
      } else {
        // Depth-first, parent before children — the parent takes the earlier
        // done flag, so a finished phase shows its group ticked first.
        const group = item(node.title, []);
        group.children = build(node.children);
        out.push(group);
      }
    }
    return out;
  };

  return build(spec.children);
}

const g = (title: string, children: SeedNode[]): SeedNode => ({ title, children });
const gen = (genTitle: string, n: number): SeedNode => ({ gen: genTitle, n });

/* Per-list arithmetic (group nodes count): each `g` is 1 + its subtree. */
const SPECS: SeedListSpec[] = [
  {
    id: "lenny",
    name: "Logo Lenny · animated Logo Studio",
    kind: "project",
    color: "amber",
    icon: "folder",
    done: 61,
    // 12 + 14 + 20 + 12 + 16 + 11 + 11 = 96
    children: [
      g("Logo Lenny persona", [gen("Persona pass", 11)]),
      g("Animated Logo Studio canvas", [gen("Canvas step", 13)]),
      g("SMIL animation engine", [
        gen("Animation step", 12),
        g("Driven-not-free-run rewrite", [gen("Driver step", 6)])
      ]),
      g("Export & rasterisation", [gen("Export check", 11)]),
      g("Agent Forge skills field", [
        gen("Skill card", 9),
        g("Persona scan hardening", [gen("Scan fix", 5)])
      ]),
      g("Verification & cost control", [gen("Verify pass", 10)]),
      gen("Ship checklist item", 11)
    ]
  },
  {
    id: "allsessions",
    name: "Session History – the ALL tab",
    kind: "project",
    color: "blue",
    icon: "folder",
    done: 49,
    // 13 + 20 + 14 + 12 + 10 + 11 = 80
    children: [
      g("Session corpus scan", [gen("Corpus batch", 12)]),
      g("build_session_doc TS port", [
        gen("Port step", 13),
        g("Slot staleness fixes", [gen("Stale artifact", 5)])
      ]),
      g("ALL tab UI", [gen("Tab surface", 13)]),
      g("Backups clone integration", [gen("Clone step", 11)]),
      g("Verification over 842 sessions", [gen("Verify batch", 9)]),
      gen("Follow-up", 11)
    ]
  },
  {
    id: "identity",
    name: "One GizmoX identity – default-deny access",
    kind: "project",
    color: "red",
    icon: "folder",
    done: 2,
    // 11 + 13 + 10 + 9 + 6 = 49
    children: [
      g("Grants inventory", [gen("Grant audit", 10)]),
      g("Default-deny broker", [gen("Broker step", 12)]),
      g("Route guards", [gen("Guard route", 9)]),
      g("Admin regions & account UI", [gen("Region pane", 8)]),
      gen("Migration task", 6)
    ]
  },
  {
    id: "amberart",
    name: "AmberArt 1.0 — paint & art module",
    kind: "project",
    color: "orange",
    icon: "folder",
    done: 19,
    // 9 + 8 + 11 + 6 + 1 = 35
    children: [
      g("Paint surface", [gen("Brush step", 8)]),
      g("ArtGen pipeline", [gen("Pipeline stage", 7)]),
      g("Toolbar asset & tools point", [
        gen("Toolbar item", 6),
        g("SVG sanitize pass", [gen("Sanitize rule", 3)])
      ]),
      g("Packaging", [gen("Package step", 5)]),
      "Register in the asset registry"
    ]
  }
];

export const SEED_LISTS: TaskList[] = SPECS.map((spec) => ({
  id: `tlist_seed_${spec.id}`,
  name: spec.name,
  kind: spec.kind,
  color: spec.color,
  icon: spec.icon,
  items: buildItems(spec),
  createdAt: SEED_STAMP
}));

/**
 * The MODULE AGENT derivation — a module's declaration turned into the agent
 * that ships with it, its skills and its tools.
 *
 * ## Why a module has an agent at all
 *
 * `module-assistant` is one plugin with per-module CONTEXT (see its types.ts):
 * one window, one integration, and the module on screen rides each turn as a
 * context block. That answers "which module am I looking at". It does not
 * answer "who is answering" — every module got the same house persona, Amber,
 * who knows the framework but nothing specific about the surface in front of
 * her beyond the paragraph the window pasted in.
 *
 * A module agent is the other half: a persona AUTHORED FROM THE MODULE'S OWN
 * DECLARATION, with the module's real command names, real setting keys, real
 * context areas and real extension points written into it — and carried in the
 * module's own directory, so it travels wherever the module travels. The peel
 * copies `src/modules/<id>/` wholesale, which is exactly why the bundle lives
 * there and not in a registry somewhere else: a compiled app ships with its
 * agent because the agent is part of the module's source, not because a build
 * step remembered to copy it.
 *
 * ## Everything here is DERIVED, nothing here is invented
 *
 * The draft this file produces is a SUGGESTION with every field filled in from
 * `<id>.decl.ts` — the same data-only declaration the closure resolver reads.
 * The owner then edits it (scripts/module-agent.mjs prompts; the studio's
 * dialog, the PyQt6 fallback and the terminal form all edit the same draft),
 * and what is written to disk is what the owner accepted. Re-deriving never
 * silently overwrites an accepted bundle — see `writeBundle`'s `preserve`.
 *
 * The one thing derivation cannot know is the NAME. `nameSuggestions` offers
 * four, deterministically per module so a re-run suggests the same ones, and
 * the prompt exists precisely because that field is the owner's.
 *
 * ## Two senses of "tool", kept apart
 *
 *   - **CLI tools** (`tools:` in the frontmatter — Read, Grep, WebFetch…) are
 *     the tool names the `claude` CLI is allowed to use on the subscription
 *     path. Those are REAL: the broker passes them as `--allowed-tools`.
 *   - **Module tools** (`moduleTools:`, one JSON file each under `tools/`) are
 *     tool DEFINITIONS in the shape `forge.server.ts` already stores — name,
 *     description, input_schema. They are the authored feed for the MCP bridge
 *     `claude/points.ts` deferred to its first real consumer. Nothing executes
 *     them yet, and this file does not pretend otherwise; what it does is make
 *     the feed exist, per module, with the module's own vocabulary in it.
 *
 * Zero dependencies, `node:fs` only — framework tooling per INITIATION §0.1.
 * It ships nothing of itself into an app; the BUNDLE it writes is the output.
 */
import fs from "node:fs";
import path from "node:path";

/** Format tag on the bundle — versioned like `axf-peel/1`. */
export const AGENT_BUNDLE_FORMAT = "axf-module-agent/1";

/** A backtick, so generated markdown can carry code spans without every
 *  template literal in this file needing an escape. */
const C = "`";
const code = (s) => `${C}${s}${C}`;
/** "1 operation" / "3 operations" — a generated persona that says "1 operations"
 *  reads like a template, which is precisely what it must not read like. */
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ── where a bundle lives ─────────────────────────────────────────────────── */

/** `src/modules/<id>/agent/` — inside the module, so the peel's existing
 *  `cpSync(moduleDir, …)` carries it with no new copy step. */
export function bundleDir(moduleDir) {
  return path.join(moduleDir, "agent");
}

/** The stable id a module's agent is known by in the roster. Derived from the
 *  module id, NOT from the display name: the owner renames the persona freely
 *  and the `moduleAgents` pin that points at it must not break when they do. */
export function agentIdFor(moduleId) {
  return `${moduleId}-agent`;
}

/* ── name suggestions ─────────────────────────────────────────────────────── */

/**
 * The roster the first suggestion comes from. Short, sayable, and nothing
 * already taken by the house set (Amber, Molly, Logo Lenny) — an agent whose
 * name collides with a house persona is a chip nobody can read.
 */
const NAME_POOL = [
  "Ada", "Bix", "Cleo", "Dex", "Echo", "Fable", "Gus", "Hazel", "Iris", "Jax",
  "Kit", "Lumen", "Mox", "Nova", "Orla", "Pike", "Quill", "Rook", "Sable",
  "Tess", "Umber", "Vesper", "Wren", "Xen", "Yara", "Zeph"
];

/** Stable small hash — same module, same suggestions, every run. A prompt whose
 *  prefill moved between runs would make "press Enter to accept" a dice roll. */
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Four names for a module's agent, best first. The pool gives a persona a
 * NAME rather than a label; the title-derived forms are there because plenty
 * of owners want "the Task Manager assistant" and nothing cuter.
 *
 * `taken` is the set of names the OTHER modules' agents already use. Ten
 * modules drawing from one pool by hash collide about as often as ten people
 * share a birthday month, and two agents called Hazel in one roster is a chip
 * nobody can read — so a taken name steps to the next free one in the pool,
 * deterministically, starting from the same hash.
 */
export function nameSuggestions(decl, taken = new Set()) {
  const h = hash(decl.id);
  const free = [];
  for (let i = 0; i < NAME_POOL.length && free.length < 2; i++) {
    const candidate = NAME_POOL[(h + i * 7) % NAME_POOL.length];
    if (!taken.has(candidate) && !free.includes(candidate)) free.push(candidate);
  }
  const short = decl.title.split(/\s+/)[0];
  return [
    ...new Set([free[0], `${decl.title} Assistant`, `${short} Guide`, free[1]].filter(Boolean))
  ].slice(0, 4);
}

/* ── reading the declaration ──────────────────────────────────────────────── */

/** Every context-menu row in the decl that names a command, flattened with the
 *  area it belongs to. This is the module's VERB list — the closest thing a
 *  declaration has to "what the module does". */
export function commandRows(decl) {
  const areas = decl.menus?.items ?? {};
  const rows = [];
  for (const [areaId, items] of Object.entries(areas)) {
    for (const item of items ?? []) {
      if (!item.command || item.role === "separator") continue;
      rows.push({
        area: areaId,
        id: item.id,
        label: item.label,
        command: item.command,
        role: item.role ?? "item",
        enabledWhen: item.enabledWhen,
        checkedWhen: item.checkedWhen
      });
    }
  }
  return rows;
}

/** Flatten a declared nav menu into `label → command/route` lines. Nav shapes
 *  nest, so this walks; a menu with no items is simply no lines. */
function navRows(nav, out = [], depth = 0) {
  for (const item of nav?.items ?? []) {
    out.push({
      depth,
      label: item.label ?? item.id,
      command: item.command,
      route: item.route ?? item.href,
      role: item.role
    });
    if (item.items) navRows(item, out, depth + 1);
  }
  return out;
}

/* ── the skills ───────────────────────────────────────────────────────────── */

/**
 * One skill per FUNCTION of the module, not one skill per file it happens to
 * have. The clusters below are the ones a declaration can answer honestly:
 *
 *   - `<id>-overview`    what the module is, where it lives, what it is for
 *   - `<id>-<area>`      one per declared context area, with its real rows
 *   - `<id>-settings`    every declared row: key, kind, default, hint
 *   - `<id>-extensions`  the points it publishes and what a contribution owes
 *   - `<id>-navigation`  the declared nav tree
 *
 * A cluster with nothing in it produces NO skill — an "Extensions" page that
 * says "this module declares no points" is a page that costs the model tokens
 * to learn nothing. The overview is the only unconditional one.
 */
export function deriveSkills(decl) {
  const skills = [];
  const rows = commandRows(decl);
  const areas = decl.menus?.areas ?? [];
  const byArea = new Map();
  for (const row of rows) {
    if (!byArea.has(row.area)) byArea.set(row.area, []);
    byArea.get(row.area).push(row);
  }

  skills.push({
    slug: `${decl.id}-overview`,
    name: `${decl.title} — overview`,
    description:
      `What ${decl.title} is, the route it lives at, and the surfaces it publishes. Use for any ` +
      `question about what this module is for or where to find it.`,
    body: [
      `# ${decl.title}`,
      "",
      decl.summary,
      "",
      "## Where it is",
      "",
      `- Route: ${code(decl.route)}`,
      `- Module id: ${code(decl.id)} — contributions target it as ${code(`module:${decl.id}`)}`,
      decl.glyph ? `- Glyph: ${code(decl.glyph)}` : null,
      "",
      "## What it publishes",
      "",
      decl.points.length
        ? decl.points.map((p) => `- ${code(p.id)} — ${p.description}`).join("\n")
        : "- No extension points: nothing plugs into this module.",
      "",
      "## Surfaces",
      "",
      `- Context areas: ${areas.length ? areas.map((a) => code(a.id)).join(", ") : "none declared (the universal menu still covers every click)"}`,
      `- Settings: ${decl.settings ? `${decl.settings.rows.length} row(s) under ${code(decl.settings.ns)}` : "none declared"}`,
      `- Navigation: ${decl.nav ? code(decl.nav.id) : "none declared"}`,
      ""
    ]
      .filter((l) => l !== null)
      .join("\n")
  });

  for (const area of areas) {
    const areaRows = byArea.get(area.id) ?? [];
    if (!areaRows.length) continue;
    // An area whose title already says the module's name ("Task Manager
    // surface") must not become "Task Manager — Task Manager surface".
    const areaTitle = area.title.toLowerCase().includes(decl.title.toLowerCase())
      ? area.title
      : `${decl.title} — ${area.title}`;
    skills.push({
      slug: `${decl.id}-${area.id.split(".").pop()}`,
      name: areaTitle,
      description:
        `The operations available on ${area.title.toLowerCase()} in ${decl.title}: ${areaRows
          .map((r) => r.label)
          .slice(0, 6)
          .join(", ")}. Use when the user asks how to do one of these.`,
      body: [
        `# ${area.title}`,
        "",
        area.description,
        "",
        `Right-clicking this area (${code(area.id)}) composes these rows, plus every row the`,
        "areas around it contribute — the map walks outward through the DOM, so an item row",
        "inside a surface offers both.",
        "",
        "## Rows",
        "",
        "| Row | Command | Notes |",
        "| --- | --- | --- |",
        ...areaRows.map(
          (r) =>
            `| ${r.label} | ${code(r.command)} | ${
              [
                r.role === "danger" ? "destructive" : null,
                r.role === "toggle" ? "toggle" : null,
                r.enabledWhen ? `enabled when ${code(r.enabledWhen)}` : null,
                r.checkedWhen ? `checked when ${code(r.checkedWhen)}` : null
              ]
                .filter(Boolean)
                .join("; ") || "—"
            } |`
        ),
        "",
        "Name the row the user should click. The command id is what the row runs — say it only",
        "when the user is writing code or a binding against it.",
        ""
      ].join("\n")
    });
  }

  if (decl.settings?.rows?.length) {
    skills.push({
      slug: `${decl.id}-settings`,
      name: `${decl.title} — settings`,
      description:
        `Every setting ${decl.title} persists: ${decl.settings.rows
          .map((r) => r.label)
          .slice(0, 6)
          .join(", ")}. Use when asked what a setting does, where it is, or what it defaults to.`,
      body: [
        `# ${decl.title} settings`,
        "",
        `Stored under the kv namespace ${code(decl.settings.ns)}. The user reaches them through the`,
        "gear on the module header, or the \"Module settings\" row on any right-click.",
        "",
        "| Setting | Key | Kind | Default | What it does |",
        "| --- | --- | --- | --- | --- |",
        ...decl.settings.rows.map(
          (r) =>
            `| ${r.label} | ${code(r.key)} | ${r.kind}${
              r.options ? ` (${r.options.map((o) => o.value).join(" \\| ")})` : ""
            } | ${code(String(r.defaultValue))} | ${r.hint} |`
        ),
        "",
        "Quote the hint when the user asks what a row means — it is the text they can see beside",
        "it, so an answer that agrees with it is an answer they can check.",
        ""
      ].join("\n")
    });
  }

  if (decl.points?.length) {
    skills.push({
      slug: `${decl.id}-extensions`,
      name: `${decl.title} — extension points`,
      description:
        `The points ${decl.title} publishes and what a contribution to each must carry. Use for ` +
        `"how do I add to this module" and for diagnosing a contribution that renders nothing.`,
      body: [
        `# What plugs into ${decl.title}`,
        "",
        "A plugin contributes to one of these points; the module never imports the plugin. This is",
        "also the closure rule the peel uses — a plugin is carried into this module's standalone",
        `app exactly when it contributes to a point starting with ${code(`${decl.id}.`)}.`,
        "",
        ...decl.points.flatMap((p) => [
          `## ${code(p.id)} — ${p.title}`,
          "",
          p.description,
          "",
          `- Kind: ${p.kind} · cardinality: ${p.cardinality}${p.required ? " · required" : ""}`,
          p.requires?.length
            ? `- Payload must carry: ${p.requires.map(code).join(", ")}`
            : "- No declared payload requirements.",
          p.ordering ? `- Ordering: ${p.ordering}` : null,
          ""
        ]),
        "A contribution missing a required field is refused at registration and the pane renders",
        "the boundary, not the payload — check the registry report before assuming the component",
        "is at fault.",
        ""
      ]
        .filter((l) => l !== null)
        .join("\n")
    });
  }

  const nav = navRows(decl.nav);
  if (nav.length) {
    skills.push({
      slug: `${decl.id}-navigation`,
      name: `${decl.title} — navigation`,
      description: `The module's declared menu tree (${code(decl.nav.id)}) and what each entry does.`,
      body: [
        `# ${decl.title} navigation`,
        "",
        `Menu asset ${code(decl.nav.id)}${decl.nav.title ? ` — ${decl.nav.title}` : ""}. In a peeled app this`,
        "is the app's own menu bar; inside Studio the shell decides which surface renders it.",
        "",
        ...nav.map(
          (n) =>
            `${"  ".repeat(n.depth)}- ${n.label}${
              n.command ? ` → ${code(n.command)}` : n.route ? ` → ${code(n.route)}` : ""
            }`
        ),
        ""
      ].join("\n")
    });
  }

  return skills;
}

/* ── the tools ────────────────────────────────────────────────────────────── */

const str = (description) => ({ type: "string", description });

/**
 * The house set — tool definitions every module agent gets, because every one
 * of them is a question an in-app assistant is actually asked ("what else is
 * here", "take me to X", "what did that setting do"). They are module-agnostic
 * by construction: the module id is a parameter, never baked in.
 *
 * Written into each bundle rather than shared from one directory, so a bundle
 * stays self-contained — a peeled app carries its module's directory and
 * nothing else, and a tool feed with half its files in the dev tree is a feed
 * that works until the day it ships.
 */
export const HOUSE_TOOLS = [
  {
    name: "list-modules",
    description:
      "List the modules registered in this app — id, title, route and summary. Use before " +
      "claiming a capability lives somewhere else, and to answer \"what else can this app do\".",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "describe-module",
    description:
      "The full declaration of one module: route, extension points, context areas, settings " +
      "rows and nav. Use when a question is about a module other than the one on screen.",
    input_schema: {
      type: "object",
      properties: { moduleId: str("Module id, e.g. \"taskman\".") },
      required: ["moduleId"]
    }
  },
  {
    name: "open-route",
    description:
      "Navigate the app to a route. Use to take the user to the surface being discussed " +
      "instead of describing how to find it.",
    input_schema: {
      type: "object",
      properties: { route: str("Route path with a leading slash, e.g. \"/taskman\".") },
      required: ["route"]
    }
  },
  {
    name: "list-commands",
    description:
      "Every registered command name, optionally filtered by prefix. Use to check a command " +
      "exists before naming it, and to find the command behind a menu row.",
    input_schema: {
      type: "object",
      properties: { prefix: str("Only commands starting with this, e.g. \"taskman.\".") },
      required: []
    }
  },
  {
    name: "run-command",
    description:
      "Run a registered command by name. Ask first when the command is destructive — the " +
      "context menus mark those rows danger and this tool does not re-check.",
    input_schema: {
      type: "object",
      properties: {
        command: str("Registered command name, e.g. \"taskman.new-list\"."),
        data: { type: "object", description: "Command context, the shape the handler reads." }
      },
      required: ["command"]
    }
  },
  {
    name: "read-settings",
    description:
      "Read a settings namespace as stored — every key with its current value. Use to answer " +
      "\"what is this set to\" rather than quoting the declared default.",
    input_schema: {
      type: "object",
      properties: { ns: str("Settings namespace, e.g. \"taskman-settings\".") },
      required: ["ns"]
    }
  },
  {
    name: "write-setting",
    description:
      "Set one settings key. The value must match the row's declared kind; a switch takes a " +
      "boolean, a select takes one of its declared option values.",
    input_schema: {
      type: "object",
      properties: {
        ns: str("Settings namespace."),
        key: str("The row's key."),
        value: {
          description: "New value — boolean, number or string, matching the row's kind.",
          type: ["boolean", "number", "string"]
        }
      },
      required: ["ns", "key", "value"]
    }
  },
  {
    name: "list-points",
    description:
      "The registry report: declared extension points, what contributed to each, and any " +
      "violations. Use when a pane renders empty — a refused contribution shows up here.",
    input_schema: {
      type: "object",
      properties: { moduleId: str("Limit to one module's points.") },
      required: []
    }
  },
  {
    name: "list-menus",
    description:
      "The context-menu rows that compose for an area, in order, with their enabled/checked " +
      "predicates resolved. Use to answer \"what happens if I right-click here\".",
    input_schema: {
      type: "object",
      properties: { area: str("Context area id, e.g. \"taskman.item\".") },
      required: ["area"]
    }
  },
  {
    name: "capture-task",
    description:
      "Park a note or task in the Task Manager's capture inbox; it opens as a New item dialog " +
      "the next time that tab is looked at. Use when the user says \"remind me\" mid-conversation.",
    input_schema: {
      type: "object",
      properties: { text: str("The capture, in the user's own words."), title: str("Optional short title.") },
      required: ["text"]
    }
  },
  {
    name: "list-agents",
    description:
      "The assistant roster — every installed agent, where it came from, and which module each " +
      "is pinned to. Use when the user asks who else they can talk to.",
    input_schema: { type: "object", properties: {}, required: [] }
  },
  {
    name: "app-health",
    description:
      "The app's health report: registry violations, subsystem states, framework version. Use " +
      "when something is broken and you need facts before guessing.",
    input_schema: { type: "object", properties: {}, required: [] }
  }
];

/**
 * The module's OWN tools — the house set spoken in this module's vocabulary,
 * with its real command names and setting keys as enums. An enum is the whole
 * point: a model that can only pass a declared command cannot invent one.
 */
export function deriveTools(decl) {
  const tools = [];
  const rows = commandRows(decl);

  tools.push({
    name: `${decl.id}-open`,
    description: `Open ${decl.title} (${decl.route}). Use to put the module on screen before walking the user through it.`,
    input_schema: { type: "object", properties: {}, required: [] }
  });

  if (rows.length) {
    tools.push({
      name: `${decl.id}-run`,
      description:
        `Run one of ${decl.title}'s declared operations. Destructive rows are marked in the ` +
        `description — confirm with the user before running one.`,
      input_schema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: rows
              .map((r) => `${r.command} — ${r.label}${r.role === "danger" ? " (destructive)" : ""}`)
              .join("; "),
            enum: [...new Set(rows.map((r) => r.command))]
          },
          data: {
            type: "object",
            description:
              "Context the row would have carried — the item, list or selection the command acts on."
          }
        },
        required: ["command"]
      }
    });
  }

  if (decl.settings?.rows?.length) {
    tools.push({
      name: `${decl.id}-settings`,
      description: `Read or write ${decl.title}'s settings (namespace ${decl.settings.ns}).`,
      input_schema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["read", "write"], description: "read every row, or write one." },
          key: {
            type: "string",
            description: decl.settings.rows.map((r) => `${r.key} — ${r.label} (${r.kind})`).join("; "),
            enum: decl.settings.rows.map((r) => r.key)
          },
          value: {
            description: "The new value when writing; matches the row's declared kind.",
            type: ["boolean", "number", "string"]
          }
        },
        required: ["action"]
      }
    });
  }

  if (decl.points?.length) {
    tools.push({
      name: `${decl.id}-inspect`,
      description:
        `What is currently plugged into ${decl.title}'s extension points, and whether anything ` +
        `was refused. Use when one of its panes renders empty.`,
      input_schema: {
        type: "object",
        properties: {
          point: {
            type: "string",
            description: decl.points.map((p) => `${p.id} — ${p.title}`).join("; "),
            enum: decl.points.map((p) => p.id)
          }
        },
        required: []
      }
    });
  }

  return tools;
}

/**
 * The CLI tools the agent is allowed on the subscription path. Conservative on
 * purpose: reading and searching are how an assistant checks a claim before
 * making it, and nothing here writes. Editing tools are an owner decision, so
 * the prompt shows this list and lets them add `Edit`, `Write` or `Bash` if
 * that is what they want the module's agent to be.
 */
export const DEFAULT_CLI_TOOLS = ["Read", "Grep", "Glob", "WebFetch", "WebSearch"];

/* ── the persona ──────────────────────────────────────────────────────────── */

/** The system prompt, written from the declaration. Long enough to be useful,
 *  short enough to stay a chat window's persona rather than a manual — the
 *  detail lives in the skills, which is what skills are for. */
export function derivePersona(decl, name, skills, tools) {
  const rows = commandRows(decl);
  const areas = decl.menus?.areas ?? [];
  return [
    `# You are ${name}`,
    "",
    `You are **${name}**, the assistant that ships with **${decl.title}**. You are not a general`,
    "help desk: you are the person who knows this one surface completely, and you are talking to",
    "someone who has it open in front of them right now.",
    "",
    "## The module",
    "",
    decl.summary,
    "",
    `- Route: ${code(decl.route)} · module id: ${code(decl.id)}`,
    areas.length
      ? `- Right-click areas: ${areas.map((a) => code(a.id)).join(", ")}`
      : "- No context areas of its own; the universal right-click menu still applies.",
    rows.length
      ? `- ${plural(rows.length, "declared operation")} — see the skills for the exact rows.`
      : "- No declared context-menu operations.",
    decl.settings
      ? `- ${plural(decl.settings.rows.length, "persisted setting")} under ${code(decl.settings.ns)}.`
      : "- No persisted settings.",
    decl.points.length
      ? `- Publishes ${plural(decl.points.length, "extension point")}: ${decl.points
          .map((p) => code(p.id))
          .join(", ")}.`
      : "- Publishes no extension points.",
    "",
    "## How you answer",
    "",
    "- **Name the control.** \"Right-click the row and pick *Duplicate*\" beats \"there is a",
    "  duplicate operation available\". If a thing has a label the user can see, use that label.",
    "- **Ground it in what is on screen.** A `## Current module` block rides your context with the",
    "  live module's title, summary and points. When it names a module that is not this one, say",
    "  so plainly and answer for the surface they are actually on.",
    "- **Short.** This is a chat window beside someone's work. Two or three sentences, then stop.",
    "  Offer the longer version; do not deliver it unasked.",
    "- **Never invent a command, key or route.** Everything this module has is written in your",
    "  skills. If it is not there, say it is not there — a plausible command name costs the user",
    "  more time than an honest \"that does not exist\".",
    "- **Confirm before anything destructive.** Rows marked destructive delete the user's data.",
    "",
    "## What you carry",
    "",
    skills.length
      ? skills.map((s) => `- **${s.name}** (${code(s.slug)}) — ${s.description}`).join("\n")
      : "- No skills.",
    "",
    tools.length
      ? `Module tools available to you: ${tools.map((t) => code(t.name)).join(", ")}.`
      : null,
    ""
  ]
    // `null` is "this line did not apply"; `""` is a blank line the markdown
    // needs. Filtering both is how the first cut produced a persona with every
    // paragraph break removed.
    .filter((l) => l !== null)
    .join("\n");
}

/* ── the draft ────────────────────────────────────────────────────────────── */

/**
 * Everything the prompt shows, pre-filled. `nameOptions` rides along so the
 * dialog can offer them without re-deriving; the accepted `name` is the first
 * of them until the owner says otherwise.
 */
export function deriveDraft(decl, taken = new Set()) {
  const skills = deriveSkills(decl);
  const tools = [...deriveTools(decl), ...HOUSE_TOOLS];
  const nameOptions = nameSuggestions(decl, taken);
  const name = nameOptions[0];
  return {
    format: AGENT_BUNDLE_FORMAT,
    module: decl.id,
    id: agentIdFor(decl.id),
    name,
    nameOptions,
    description: `${decl.title}'s own assistant — knows its ${plural(
      commandRows(decl).length,
      "operation"
    )}, its settings and its extension points. ${decl.summary}`,
    cliTools: [...DEFAULT_CLI_TOOLS],
    skills,
    tools,
    persona: derivePersona(decl, name, skills, tools)
  };
}

/**
 * Apply the prompt's answers to a draft. Renaming re-derives the persona ONLY
 * when the owner did not edit it — an edited persona is the owner's text and a
 * regenerate that ate it would make editing pointless.
 */
export function applyEdits(decl, draft, edits) {
  const next = { ...draft, ...edits };
  next.skills = (edits.skills ?? draft.skills).filter(Boolean);
  next.tools = (edits.tools ?? draft.tools).filter(Boolean);
  next.cliTools = (edits.cliTools ?? draft.cliTools).filter(Boolean);
  const personaUntouched = !edits.persona || edits.persona.trim() === draft.persona.trim();
  if (personaUntouched && next.name !== draft.name) {
    next.persona = derivePersona(decl, next.name, next.skills, next.tools);
  } else if (edits.persona) {
    next.persona = edits.persona;
  }
  return next;
}

/* ── serialising ──────────────────────────────────────────────────────────── */

/** Inline list in the frontmatter dialect both readers already understand
 *  (`agents.server.ts`'s scalar parse, `forge.ts`'s tolerant `toolList`). */
const list = (values) => `[${values.map((v) => JSON.stringify(v)).join(", ")}]`;

export function serialiseAgentFile(draft) {
  const front = [
    "---",
    `name: ${draft.name}`,
    `description: ${draft.description.replace(/\s+/g, " ").trim()}`,
    `module: ${draft.module}`,
    draft.provider ? `provider: ${draft.provider}` : null,
    draft.model ? `model: ${draft.model}` : null,
    `tools: ${list(draft.cliTools)}`,
    `skills: ${list(draft.skills.map((s) => s.slug))}`,
    `moduleTools: ${list(draft.tools.map((t) => t.name))}`,
    "---",
    ""
  ].filter((l) => l !== null);
  return front.join("\n") + draft.persona.trim() + "\n";
}

export function serialiseSkillFile(skill) {
  return (
    ["---", `name: ${skill.name}`, `description: ${skill.description.replace(/\s+/g, " ").trim()}`, "---", ""].join(
      "\n"
    ) +
    skill.body.trim() +
    "\n"
  );
}

/* ── reading and writing a bundle ─────────────────────────────────────────── */

/** The tiny frontmatter reader, matching `agents.server.ts`'s dialect — scalars
 *  and `>`/`|` folds, parsed line by line so a person can repair the file with
 *  a text editor. Duplicated deliberately: this is build tooling under plain
 *  Node and must not import the app's TypeScript. */
export function parseFrontmatter(text) {
  const norm = text.replace(/\r\n/g, "\n");
  if (!norm.startsWith("---\n")) return { front: {}, body: norm.trim() };
  const end = norm.indexOf("\n---", 4);
  if (end < 0) return { front: {}, body: norm.trim() };
  const front = {};
  let folded = null;
  for (const line of norm.slice(4, end).split("\n")) {
    if (folded) {
      if (/^\s+\S/.test(line)) {
        folded.lines.push(line.trim());
        continue;
      }
      front[folded.key] = folded.lines.join(" ");
      folded = null;
    }
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (/^[>|][-+]?$/.test(value)) folded = { key, lines: [] };
    else front[key] = value;
  }
  if (folded) front[folded.key] = folded.lines.join(" ");
  return { front, body: norm.slice(end + 4).replace(/^-*\n?/, "").trim() };
}

/** `["a", "b"]`, `a, b` or `a` → `["a","b"]`. The tolerant form `forge.ts`
 *  reads, because a hand-edited frontmatter will use whichever it remembers. */
export function parseList(value) {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
  }
  return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Read a bundle back into draft shape, or null when the module has none. */
export function readBundle(moduleDir) {
  const dir = bundleDir(moduleDir);
  const agentFile = path.join(dir, "agent.md");
  if (!fs.existsSync(agentFile)) return null;
  const { front, body } = parseFrontmatter(fs.readFileSync(agentFile, "utf8"));
  const skills = [];
  const skillsDir = path.join(dir, "skills");
  if (fs.existsSync(skillsDir)) {
    // The frontmatter's `skills:` list is the AUTHORED ORDER — the order the
    // prompt showed and the order the chat route inlines them in. Directories
    // sort alphabetically, which is not the same thing, so the list leads and
    // anything on disk it does not name follows (a skill added by hand).
    const declared = parseList(front.skills);
    const onDisk = fs.readdirSync(skillsDir).sort();
    const ordered = [...declared.filter((s) => onDisk.includes(s)), ...onDisk.filter((s) => !declared.includes(s))];
    for (const slug of ordered) {
      const file = path.join(skillsDir, slug, "SKILL.md");
      if (!fs.existsSync(file)) continue;
      const parsed = parseFrontmatter(fs.readFileSync(file, "utf8"));
      skills.push({
        slug,
        name: parsed.front.name ?? slug,
        description: parsed.front.description ?? "",
        body: parsed.body
      });
    }
  }
  const tools = [];
  const toolsDir = path.join(dir, "tools");
  if (fs.existsSync(toolsDir)) {
    for (const f of fs.readdirSync(toolsDir).filter((f) => f.endsWith(".json")).sort()) {
      try {
        tools.push(JSON.parse(fs.readFileSync(path.join(toolsDir, f), "utf8")));
      } catch {
        // A corrupt definition costs that one tool, never the bundle.
      }
    }
  }
  return {
    format: AGENT_BUNDLE_FORMAT,
    module: front.module ?? path.basename(moduleDir),
    id: agentIdFor(front.module ?? path.basename(moduleDir)),
    name: front.name ?? "",
    description: front.description ?? "",
    provider: front.provider || undefined,
    model: front.model || undefined,
    cliTools: parseList(front.tools),
    skills,
    tools,
    persona: body
  };
}

/**
 * Write the bundle, whole. The directory is REGENERATED — `skills/` and
 * `tools/` are wiped first — because a skill the owner removed in the prompt
 * must actually leave, and a bundle that accumulates every skill it ever had
 * is a bundle nobody can reason about. `agent.md` is written from the accepted
 * draft, so an owner's edited persona survives exactly as they left it.
 */
export function writeBundle(moduleDir, draft) {
  const dir = bundleDir(moduleDir);
  fs.mkdirSync(dir, { recursive: true });
  for (const sub of ["skills", "tools"]) {
    fs.rmSync(path.join(dir, sub), { recursive: true, force: true });
  }
  const written = [];
  const agentFile = path.join(dir, "agent.md");
  fs.writeFileSync(agentFile, serialiseAgentFile(draft), "utf8");
  written.push(agentFile);
  for (const skill of draft.skills) {
    const file = path.join(dir, "skills", skill.slug, "SKILL.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, serialiseSkillFile(skill), "utf8");
    written.push(file);
  }
  for (const tool of draft.tools) {
    const file = path.join(dir, "tools", `${tool.name}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(tool, null, 2) + "\n", "utf8");
    written.push(file);
  }
  fs.writeFileSync(
    path.join(dir, "README.md"),
    [
      `# ${draft.name} — the agent that ships with ${draft.module}`,
      "",
      "Generated by `npm run agent " + draft.module + "` (packages/studio/scripts/module-agent.mjs)",
      "and regenerated whenever the module is built. Hand edits to `agent.md` and the skill bodies",
      "SURVIVE a re-run — the prompt shows them back to you pre-filled, and what you accept is what",
      "is written. Deleting this directory and re-running gives you a fresh derivation from the",
      "module's declaration.",
      "",
      "- `agent.md` — the persona. Its body IS the system prompt.",
      "- `skills/<slug>/SKILL.md` — one per function of the module, in the format Claude Code reads.",
      "- `tools/<name>.json` — tool definitions (name, description, input_schema) for the MCP bridge.",
      "",
      "The module-assistant scanner picks this up as agent id `" + draft.id + "`, source `module`,",
      "and pins it to `" + draft.module + "` automatically. It travels into a peeled app because it",
      "lives inside the module's own directory.",
      ""
    ].join("\n"),
    "utf8"
  );
  written.push(path.join(dir, "README.md"));
  return written;
}

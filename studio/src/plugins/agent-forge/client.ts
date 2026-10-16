"use client";

/**
 * @file The browser's half: `/api/agent-forge` for the roster, and core's kv
 * transport for the bindings.
 *
 * Two transports rather than one because they answer to two owners. The roster
 * is a scan of somebody's `.claude/` directory — this plugin's own route. The
 * BINDING is per-user preference state, which core already has a primitive for
 * (`httpKv` → `/api/axf/kv/<ns>`), and inventing a third route to store one
 * string per conversation would be a second store over the same job.
 *
 * The types here mirror `forge.ts` deliberately rather than importing it: that
 * file imports `node:fs`, and a client component reaching it for a TYPE would
 * pull the module into the browser graph. `test/agent-forge.test.ts` pins the
 * two shapes against each other so the mirror cannot drift silently.
 */
import { defaultKv } from "@axf/core";

import { AGENT_FORGE_NS, boundPersona, withBinding } from "./bindings";

export type ForgeScope = "project" | "user" | "studio";

export interface PersonaInfo {
  readonly id: string;
  readonly scope: ForgeScope;
  readonly slug: string;
  readonly file: string;
  readonly name: string;
  readonly description: string;
  readonly tools: readonly string[];
  readonly skills?: readonly string[];
  readonly model: string | null;
  readonly disabled: boolean;
  readonly shadowed: boolean;
  readonly bodyPreview: string;
}

export interface SkillInfo {
  readonly id: string;
  readonly scope: ForgeScope;
  readonly slug: string;
  readonly file: string;
  readonly name: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly shadowed: boolean;
}

export interface Roster {
  readonly repo: string;
  readonly personas: readonly PersonaInfo[];
  readonly skills: readonly SkillInfo[];
}

/**
 * What a tree carries: `.claude/` under it, `~/.claude/`, and the roster the
 * studio ships.
 *
 * `"studio"` asks for THIS INSTALL'S tree instead of a conversation's — the
 * `/forge` module's case, which has no conversation and therefore no cwd. It is
 * a named request rather than an omitted argument for the reason the route
 * gives: the two questions have different answers and must not be confusable.
 */
export async function fetchRoster(cwd: string | "studio"): Promise<Roster> {
  const query = cwd === "studio" ? "tree=studio" : `cwd=${encodeURIComponent(cwd)}`;
  const response = await fetch(`/api/agent-forge?${query}`, {
    cache: "no-store"
  });
  const body = (await response.json()) as Roster & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `agent-forge: HTTP ${response.status}`);
  return body;
}

/** One persona compiled into the text a session would receive. */
export async function fetchPersonaContext(
  cwd: string | "studio",
  personaId: string
): Promise<string> {
  const query = cwd === "studio" ? "tree=studio" : `cwd=${encodeURIComponent(cwd)}`;
  const response = await fetch(
    `/api/agent-forge?${query}&persona=${encodeURIComponent(personaId)}`,
    { cache: "no-store" }
  );
  const body = (await response.json()) as { context?: string; error?: string };
  if (!response.ok || typeof body.context !== "string") {
    throw new Error(body.error ?? `agent-forge: HTTP ${response.status}`);
  }
  return body.context;
}

/* ------------------------------------------------------------- bindings ---- */

/** The persona bound to a conversation, or null. */
export async function readBinding(conversationId: string): Promise<string | null> {
  const doc = await defaultKv().read(AGENT_FORGE_NS);
  return boundPersona(doc, conversationId);
}

/**
 * Bind (or, with null, unbind) a conversation's persona.
 *
 * Read-modify-write against the live document rather than against what the
 * panel last saw: the namespace holds ONE document for every conversation, so
 * writing a stale copy back would silently unbind every conversation bound
 * since the panel mounted.
 */
export async function writeBinding(
  conversationId: string,
  personaId: string | null
): Promise<void> {
  const kv = defaultKv();
  const doc = await kv.read(AGENT_FORGE_NS);
  await kv.write(AGENT_FORGE_NS, { ...withBinding(doc, conversationId, personaId) });
}

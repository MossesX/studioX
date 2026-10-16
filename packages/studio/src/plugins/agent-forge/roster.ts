/**
 * @file The two operations everything above needs, composed from `forge.ts`.
 * **Server-only** — it reads the filesystem, and the route and the context
 * provider are its only callers.
 *
 *   {@link scanRoster}     what personas and skills a working directory implies
 *   {@link personaContext} one persona, compiled into the text a session gets
 *
 * Why a second file rather than three more exports on `forge.ts`: that file is
 * a verbatim restore from the pre-strip archive, and keeping it verbatim is
 * what lets the next reader trust it against the original. Everything new is
 * here.
 *
 * ── the repo is the CONVERSATION'S working directory ────────────────────────
 *
 * Not a constant, and this is the whole reason the GizmoX original needed a
 * change to port: there, `gizmoxRoot()` answered "the project". Here a Claude
 * conversation is bound to a tree — its own `cwd`, or its project's — and the
 * personas that apply are the ones the CLI itself would load for that tree.
 * Reading `.claude/agents` from anywhere else would offer a roster the CLI has
 * never heard of.
 *
 * The STUDIO scope (2026-08-13) is the exception that proves it: it is not read
 * from the conversation's tree because it is not the conversation's — it is the
 * house roster AmberX ships, and it applies to every tree. See `forge.ts`.
 */
import fs from "node:fs";
import os from "node:os";

import {
  composePersonaContext,
  forgeRoots,
  scanPersonas,
  scanSkills,
  type PersonaInfo,
  type SkillInfo
} from "./forge";

export interface Roster {
  /** The tree the project-scope half was read from. */
  readonly repo: string;
  readonly personas: readonly PersonaInfo[];
  readonly skills: readonly SkillInfo[];
}

/**
 * Flag every entry a NEARER scope already declares under the same slug.
 *
 * Order is the caller's: the lists below are built project → user → studio, so
 * "nearer" is simply "earlier", and the first entry for a slug is the one a
 * fresh pick should get. That ordering is the CLI's own precedence for the two
 * scopes it owns, and the studio scope takes last place deliberately — a repo
 * that ships its own `molly.md` means it, and an app that silently preferred
 * its bundled copy would be composing a prompt the CLI would not.
 *
 * Nothing is DROPPED. This repo's `.claude/` is a generated mirror of the
 * studio roster, so three of its personas are shadowed here at all times; a
 * reader who saw only the winner could not tell that mirror from an override
 * somebody wrote by hand. `check:forge` is what proves the two are identical —
 * this function only reports which one wins.
 */
function markShadowed<T extends { slug: string; shadowed: boolean }>(entries: T[]): T[] {
  const seen = new Set<string>();
  return entries.map((entry) => {
    const key = entry.slug.toLowerCase();
    const shadowed = seen.has(key);
    seen.add(key);
    // A copy, never a mutation: `scanPersonas` hands back fresh objects today,
    // but a caller that ever memoises a scan would otherwise find its cache
    // re-flagged against a different repo's precedence.
    return shadowed === entry.shadowed ? entry : { ...entry, shadowed };
  });
}

/**
 * All three scopes, both kinds, for one tree.
 *
 * `home` and `studio` are parameters with defaults rather than calls to
 * `os.homedir()` / the shipped root inside, so a test can point either at a
 * fixture — the same reason `forgeRoots` takes them. Nothing here throws on a
 * missing directory: a tree with no `.claude/` is the normal case, not an
 * error, and `scanPersonas` already answers `[]` for one.
 */
export function scanRoster(repo: string, home: string = os.homedir(), studio?: string): Roster {
  const roots = forgeRoots(repo, home, studio);
  return {
    repo,
    personas: markShadowed([
      ...scanPersonas("project", roots.project.agents),
      ...scanPersonas("user", roots.user.agents),
      ...scanPersonas("studio", roots.studio.agents)
    ]),
    skills: markShadowed([
      ...scanSkills("project", roots.project.skills),
      ...scanSkills("user", roots.user.skills),
      ...scanSkills("studio", roots.studio.skills)
    ])
  };
}

/**
 * The context text one persona contributes, or null when the id names nothing.
 *
 * Null rather than a throw, and null rather than a placeholder string: the
 * caller is `#composeSystem`, which runs while a turn is being assembled. A
 * persona whose file was deleted since it was bound should cost the turn its
 * persona and nothing else — the same posture the service already takes for a
 * conversation whose project is gone.
 *
 * A DISABLED persona resolves to null too. `.md.disabled` is the CLI's own off
 * switch (its loader glob simply does not match the file), so honouring it here
 * is agreeing with the tool rather than inventing a second meaning for it.
 *
 * A SHADOWED one does not: the id names one file, and compiling the file that
 * was named is the least surprising thing this can do. Shadowing decides which
 * entry a fresh pick lands on, which is a question for the roster UI, not for a
 * binding somebody already made.
 */
export function personaContext(
  repo: string,
  personaId: string,
  home: string = os.homedir(),
  studio?: string
): string | null {
  const { personas, skills } = scanRoster(repo, home, studio);
  const persona = personas.find((p) => p.id === personaId);
  if (!persona || persona.disabled) return null;
  // The read is here rather than in `composePersonaContext` on purpose: that
  // function takes RAW TEXT so the composition stays a string function a test
  // can hold with no filesystem in the assertion path.
  let raw: string;
  try {
    // Synchronous, like the scan above it. Mixing the two would buy nothing but
    // a differently-coloured function on a path that reads one small file.
    raw = fs.readFileSync(persona.file, "utf8");
  } catch {
    return null;
  }
  return composePersonaContext(raw, persona.name, skills);
}

# The studio roster

The personas and skills **AmberX itself ships**. Imported from GizmoX on
2026-08-13 and versioned here like any other source.

```
forge/agents/<slug>.md            personas
forge/skills/<slug>/SKILL.md      skill bundles
```

Three personas (`amber`, `logo-lenny`, `molly`) and eight skills. The file
format is the `claude` CLI's own, unchanged — frontmatter plus a body — because
the point is that these are the same assets the CLI loads, not a second dialect
of them. A `.md.disabled` / `SKILL.md.disabled` rename is the off switch, and it
is the CLI's: its loader glob simply does not match the file.

## Why not just `.claude/`

That is where they were, and it made them assets the project *used* rather than
assets the project *owned*: untracked, in no build, in no diff, and visible only
to a conversation whose working directory happened to be this repo. Opened
anywhere else, the Forge was empty.

They are read from here through the `studio` scope in
`src/plugins/agent-forge/forge.ts`, which applies to every tree — alongside the
two scopes the CLI owns (`<repo>/.claude`, `~/.claude`).

## `.claude/` is a mirror of this directory

The CLI cannot read this path, so `npm run sync:forge` copies these files to
`<repo>/.claude/{agents,skills}` byte-for-byte. Studio's `postinstall` runs it,
and `.gitignore` ignores the two mirrored directories.

**One way only.** Editing `.claude/agents/molly.md` edits a generated file that
the next sync overwrites — the change belongs in `forge/agents/molly.md`.
`npm run check:forge` fails if the two have drifted, and names the file.

Files in `.claude/` that this directory does **not** ship are left alone: a repo
may keep personas of its own beside the mirrored ones. The mirror owns its own
slugs and nothing else.

## Precedence

`project` → `user` → `studio`, nearest first. A repo that ships its own
`molly.md` means it, and an app that silently preferred its bundled copy would
compile a prompt the CLI would not. Losers are listed and flagged `shadowed`
rather than dropped — `/forge` shows them dimmed, so a mirror is
distinguishable from a hand-written override. The workspace panel, being a
picker, shows winners only.

## Adding one

Drop the file in, run `npm run sync:forge`, restart nothing — the scan is per
request. If a persona declares `skills:`, every slug must name a bundle that
exists in some scope, or the compiled brief marks it `(UNRESOLVED)`;
`test/agent-forge.test.ts` asserts the shipped set has no such slug.

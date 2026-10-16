---
name: gizmox-brand-assets
description: >
  How a drawing becomes a real GizmoX asset — the asset taxonomy and lifecycle, logo-package vs
  branding-package, the branding package's role variables and why they make a pack recolour with
  the theme, the toolbar icon contract, and the verification duty. Use when asked to export a
  logo as an asset, add to a logo/branding pack, register a pack, wire a brand colour or icon into
  the theme, or when a brand asset renders in the wrong colours.
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# A logo becomes an asset

Drawing the mark is half the job. In GizmoX a deliverable only exists once it is **registered**,
and registration has a fixed shape that is identical for every asset type.

## 1. The taxonomy, in one screen

**u-assets** (`.claude/rules/asset-types.md`) — five types, and the distinction people get wrong:

| Type | Own process | Core access | `target` | The tell |
| --- | --- | --- | --- | --- |
| **module** | yes | direct (SDK bridge) | no | a whole screen with its own route |
| **subsystem** | core-side | direct (is core-level) | no | infrastructure the core loads |
| **plugin** | no (host) | only via its host | required | **adds** a new capability |
| **extension** | no (host) | only via its host | required | **augments** an existing feature |
| **add-on** | none (data) | none | required | pure declarative payload, no code |

Everything a designer touches is on the **same lifecycle** but is *not* a u-asset:
`logo-package`, `branding-package`, `style-theme`, `color-theme`, `layout-theme` (the full-theme
type), UI Forge's `ui-main` / `ui-wrapper` / `nav-menu` / `toolbar`, and `tutorial`.

**The lifecycle, every type, no exceptions:**

1. scaffold per the type's JSON Schema →
2. write and validate `manifest.json` →
3. register in `assets/registry.json` →
4. zip into `assets/archive/<type>/` →
5. raw files extracted at `assets/installed/<type>/<id>/`.

**Enable/disable is ONLY the `enabled` flag in the registry.** Files never move on a flip.

## 2. logo-package vs branding-package — pick correctly

| | `logo-package` | `branding-package` |
| --- | --- | --- |
| Contains | one identity's rendered outputs: mark/wordmark/lockup variants, the raster ladder, favicons, palette + type notes | the framework's whole drawing vocabulary: hundreds of role-coloured SVGs across categories (icons, marks, watermarks, patterns, spinners, badges…) |
| Consumers | anything that needs *that brand's* logo — model badges, headers, docs | the UI itself: toolbars, chrome, module headers |
| Example | `untitled-logo-logo-pack` (exported from Logo Studio) | `gizmox-brand` (the core pack, generated) |
| Authored how | Logo Studio composes and exports it | **generated** by `scripts/gen-branding-pack.ts` from `scripts/branding/glyphs.ts` |

**Rule of thumb:** one brand's deliverables → `logo-package`. A drawing the framework's own UI
will resolve by name → `branding-package`.

## 3. Registering a logo-package (what "export as asset" actually does)

`installLogoPack()` in `src/lib/server/logoPack.ts`, behind
`POST /api/logo-studio/pack`, runs the whole lifecycle and then **re-reads the disk** before
reporting success:

1. validate the manifest through the canonical Ajv core
   (`gizmox://schemas/manifest/logo-package`),
2. extract files to `assets/installed/logo-package/<id>/` (+ `manifest.json`),
3. zip to `assets/archive/logo-package/<id>-<version>.zip` (the studio's pure `zip.ts` writer —
   no shell dependency),
4. upsert `assets/registry.json` — `created` is preserved on re-export,
5. optionally install model-logo SVGs to `public/assets/model-logos/<slug>.svg`.

Two hard constraints that cause most failures:

- **The posted files must be exactly the manifest inventory.** A manifest promising a file it
  does not ship — or shipping an undeclared extra — never installs. Build the inventory from the
  files, not by hand.
- **Paths are validated**: `[A-Za-z0-9._-]` segments only, no `.`/`..`. Human-friendly layer
  names do not survive as file names; slugify them.

`GET /api/logo-studio/pack` lists the registered packs — that is the real source for any
"existing packs" dropdown. Never hand-maintain such a list.

## 4. Role colours — why a pack recolours with the theme

Every SVG in the branding package paints in **role variables with a hex fallback**:

```svg
<path d="…" fill="var(--gxb-accent, #FF7A1A)"/>
```

The roles: `--gxb-accent`, `--gxb-page`, `--gxb-ink`, `--gxb-dim`, `--gxb-edge`, `--gxb-ok`,
`--gxb-warn`, `--gxb-err`. They are published from the **live theme**, which is what makes one
variable change repaint the whole pack.

**The trap, and it bites every time:** `<img src="…svg">` and `background-image` load the SVG in
its own document, where `--gxb-*` does not exist — so you get the fallback palette forever. To
get theme colours the markup must be **inline in the page**. Use the pack's inline components /
`ToolbarIcon`, or inline the source yourself.

Corollaries when you author a drawing for the pack:

- Never hardcode a brand hex as the only value. Role variable + fallback, always.
- Do not use `currentColor` for a multi-role drawing — it collapses every role into one.
- Fallbacks should be the dark-theme values, since that is the default.
- Hand-editing `assets/installed/branding-package/**` is pointless: the next regeneration
  overwrites it. **Edit the generator** (`scripts/branding/glyphs.ts` → regenerate). See the
  `dx-brand-asset` skill for the full workflow.

## 5. Toolbar icons — one contract, no exceptions

Every toolbar's icons come from the **core branding package**, resolved through `ToolbarIcon` /
`toolbarIconId` in `@/lib/brand/toolbar-icons`. That resolver accepts the plain vocabulary
(`brush`, `export`, `undo`), a pack entry id (`icon-export`) or a MUI name — and lands all three
on a pack drawing.

- **Never** import `@mui/icons-material` for a toolbar button, and never ship a module-local
  icon set. That is what breaks recolouring.
- A name with no drawing means **adding a GLYPH to `scripts/branding/glyphs.ts` and
  regenerating** — never inlining a literal SVG at the call site. Append new glyphs at the END of
  the vocabulary.
- `export`, `download`, `file`, `folder`, `save` and `plugin` already resolve to real drawings.

## 6. Theme awareness — what a designer needs to know

- The theme engine is **175 fields across 14 subsystems**, generated into `spec.generated.ts`
  from `documentation/specs/THEME-ENGINE-SPEC.mdx`.
- `rollTheme` is a **seeded PRNG, not a model**: the seed *is* the theme. Same seed, same bytes.
- **Hard clamps** are validated, not hoped for: AA contrast, reduced motion honoured, minimum hit
  target, focus always visible, every required action reachable. A palette you hand the theme
  engine must survive those checks — so build it with measured contrast (see
  `brand-identity-system`).
- A **`layout-theme`** carries arrangement *and* all fourteen subsystems' values; a
  **`color-theme`** is palette only and hot-renders on selection with no confirm step.
- Rendering: `--gxt-*` from the theme engine, `--gxs-*` for the wider app, `--gxb-*` for the
  branding pack. Do not invent a fourth prefix.

## 7. Verification duty — the rule that exists because a log lied

A report claiming success is **not** success (`.claude/rules/direct-prompt-builds.md`; the
countdown-alarm incident, 2026-07-21: a job log claimed a registered build with no registry entry
and no zip on disk).

Before saying a pack is registered, confirm on disk:

```bash
ls assets/installed/logo-package/<id>/manifest.json
ls assets/archive/logo-package/<id>-*.zip
grep -n '"<id>"' assets/registry.json
```

`installLogoPack` already re-reads each artefact into `report.verified` — quote those flags *and*
the file listing, never the intent. If any of the three is missing, the export failed, whatever
the response body said.

One more concurrency note: `assets/registry.json` serialises itself through a lock
(`withRegistryLock()` in `src/lib/server/registry.ts`, `registry_lock()` in
`build/tools/asset_registry.py`). Never hand-roll a read-modify-write around it — twelve
concurrent writers against the unlocked version left exactly one survivor.

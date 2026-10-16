/**
 * @file Logo-kit data model — the shapes, ids and hard limits.
 *
 * A **logo kit** is a framework-authored bundle of logos (animated or static),
 * each a lightweight spec that names a motion from the motion registry. It is a
 * new asset TYPE (`logo_kit`, display name "logo kit") with the standard AmberX
 * asset lifecycle (schema + manifest + zip + installed dir + registry entry),
 * but no runtime code of its own — the studio-owned `LogoKitLogo` renderer
 * draws it, exactly as a tutorial player draws a tutorial.
 *
 * Types only here (no node/DOM imports), so the renderer and any client
 * component can import it in the browser graph.
 *
 * PORTED from GizmoX `src/lib/logo-kits/types.ts` (2026-08-15). The model is
 * unchanged; only the brand string moves to AmberX's namespace, because the
 * brand is what makes a hand-written object literal fail to typecheck and it
 * must not be forgeable by pasting the GizmoX one.
 */

export const LOGO_KIT_TYPE = "logo_kit" as const;
export const LOGO_KIT_DISPLAY_NAME = "logo kit";

/** Hard cap on logos in one kit (owner directive, 2026-08-15). */
export const MAX_LOGOS_PER_KIT = 40;

/** `lk001` … `lk999`. */
export const KIT_ID_RE = /^lk\d{3}$/;
/** A logo slug: lowercase, starts with a letter. `orbit`, `glow`, `flip-3d`. */
export const LOGO_SLUG_RE = /^[a-z][a-z0-9-]*$/;

export type LogoKind = "animated" | "static";

/** What the framework author writes per logo — only the slug, name and motion.
 *  `kind` and the render `engine` are DERIVED from the motion so they can never
 *  disagree with it. */
export interface LogoSpecInput {
  slug: string;
  name: string;
  /** A motion id from `MOTIONS` (`orbit`, `spin`, `none`, …). */
  motion: string;
  note?: string;
}

/** A fully-resolved logo, as it lands in the kit asset. */
export interface LogoSpec {
  /** Globally unique: `<kitId>-<slug>`, e.g. `lk001-orbit`. */
  id: string;
  slug: string;
  name: string;
  kind: LogoKind;
  motion: string;
  note?: string;
}

/** What a framework author hands to `defineLogoKit`. */
export interface LogoKitInput {
  id: string;
  name: string;
  version: string;
  description: string;
  logos: LogoSpecInput[];
}

/** A validated, framework-authored logo kit. The `__brand` field is why a plain
 *  object literal cannot stand in for one — only `defineLogoKit` produces it. */
export interface LogoKit {
  readonly __brand: "axf.logo_kit";
  id: string;
  name: string;
  version: string;
  type: typeof LOGO_KIT_TYPE;
  description: string;
  authored_by: "framework";
  logos: LogoSpec[];
}

/** Split a global logo id back into its kit id, or null if malformed. */
export function kitIdOf(logoId: string): string | null {
  const m = /^(lk\d{3})-[a-z][a-z0-9-]*$/.exec(logoId);
  return m ? m[1] : null;
}

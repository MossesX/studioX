/**
 * @file The **wire shape** of `GET /api/asset-browser` — what the disk half of
 * the catalog answers with.
 *
 * Its own file, client-safe, because both ends need it and only one end may
 * hold `node:fs`. `disk.server.ts` produces these; `catalog.ts` consumes them
 * in the browser. Putting them in the server file would make a client component
 * import a module that reaches the filesystem — which `isolatedModules` would
 * erase correctly today and which nothing would stop from becoming a value
 * import tomorrow. `accounts/adminApi.ts` splits the same way for the same
 * reason.
 *
 * Types only. No constants, no functions — a shape both sides agree on.
 */

/** How a caller learns something was wrong without the read having failed. */
export interface DiskNote {
  readonly level: "warn" | "error";
  readonly assetId?: string;
  /** Repo-relative, so a note is a path a person can paste into an editor. */
  readonly path?: string;
  readonly message: string;
}

/** One asset as the FILESYSTEM knows it. */
export interface DiskAsset {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly version: string;
  /** A registry flag only — enable/disable never moves a file. */
  readonly enabled: boolean;
  /** Registry-relative install directory, or null when the row names none. */
  readonly installed: string | null;
  readonly installedPresent: boolean;
  readonly archive: string | null;
  /** True only when `archive` is named AND the zip is on disk. */
  readonly archivePresent: boolean;
  readonly created: string | null;
  /** `"framework"` for the engine-authored kinds; null when nothing says. */
  readonly authoredBy: string | null;
  /** The generator's content signature, when the kind signs its output. */
  readonly signature: string | null;
  /** The parsed `manifest.json`, or null when it could not be read. */
  readonly manifest: unknown;
  readonly notes: readonly DiskNote[];
}

/** An installed directory with no registry row — see `disk.server.ts`. */
export interface DiskOrphan {
  readonly kind: string;
  readonly id: string;
  readonly path: string;
}

export interface DiskReport {
  readonly generatedAt: string;
  /** Repo-relative registry path, and whether it could be read at all. */
  readonly registry: { readonly path: string; readonly ok: boolean };
  readonly assets: readonly DiskAsset[];
  /**
   * Installed directories the registry does not claim. Surfaced rather than
   * dropped: an unregistered asset is invisible to the framework, and a manager
   * screen is where somebody would notice.
   */
  readonly orphans: readonly DiskOrphan[];
  readonly notes: readonly DiskNote[];
}

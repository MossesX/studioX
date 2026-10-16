/**
 * @file Types for `runtime-files.mjs`, so `next.config.ts` imports it with a
 * type rather than an implicit `any`.
 *
 * The declaration lives in `.mjs` rather than `.ts` because two of its three
 * consumers are plain `.mjs` scripts run by `node` with no compile step. A
 * `.d.mts` beside it is the cheap way to give the TypeScript consumer the same
 * shape without giving the scripts a build.
 */

export interface RuntimeFileGroup {
  readonly id: string;
  readonly base: "studio" | "repo";
  readonly globs: readonly string[];
  readonly reader: string;
  readonly why: string;
  readonly trace?: boolean;
}

export declare const PERSISTED_ROOT: string;
export declare const IMAGE_ASSETS_ROOT: string;
export declare const RUNTIME_FILES: readonly RuntimeFileGroup[];
export declare const TRACING_EXCLUDES: readonly string[];
export declare function tracingIncludes(): Record<string, string[]>;
export declare function tracingExcludes(): Record<string, string[]>;
export declare function repoGroups(): RuntimeFileGroup[];

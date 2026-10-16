/**
 * @file The suite's version number, as the banner prints it.
 *
 * The banner shows a version, so a version has to exist client-side — and the
 * two obvious ways to get one are both wrong here. Reading the registry means
 * `/api/plugins`, a GizmoX-gated route an `axv_session` cannot open since the
 * P7 split (`src/proxy.ts`); hardcoding it in the banner means the number on
 * screen drifts from `manifest.json` the first time the module is bumped.
 *
 * So it is a constant with a lock: `test/amberxvid-banner.test.ts` reads
 * `assets/installed/module/amberxvid/manifest.json` and fails if the two
 * disagree. Bump the manifest and this line together, or the test says so.
 */

/** Must equal `assets/installed/module/amberxvid/manifest.json`'s `version`. */
export const AMBERXVID_VERSION = "0.4.0";

/** How the banner prints it. */
export const AMBERXVID_VERSION_LABEL = `v${AMBERXVID_VERSION}`;

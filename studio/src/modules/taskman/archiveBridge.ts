/**
 * @file How the archive dialog is ASKED for — a window event, and nothing else.
 *
 * The same seam `capture.ts` uses for the new-item dialog, and for the same
 * reason: a command handler takes no arguments and knows no React, so it cannot
 * hold a `setOpen`. It dispatches; whichever surface is mounted answers.
 *
 * PURE — no React, no store, no fetch — so `taskman.commands.ts` can import it
 * without dragging the dialog's component into the boot bundle.
 */

/** The window event {@link openArchiveDialog} dispatches. */
export const ARCHIVE_DIALOG_EVENT = "axs:taskman-archive";

/** Ask for the archived-lists dialog. No-op where there is no window. */
export function openArchiveDialog(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ARCHIVE_DIALOG_EVENT));
}

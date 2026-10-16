/**
 * @file Slash-command completion, as data plus one matcher.
 *
 * P3 asks for *"slash-command completion"* in the composer. The subtlety is
 * WHAT is being completed, and getting that wrong makes the feature a liability
 * rather than a help.
 *
 * ── these are the CLI's commands, not this app's ─────────────────────────────
 *
 * A `/` at the start of a prompt is passed through to the `claude` CLI, which
 * has its own command set. This module does not implement any of them and must
 * not pretend to: completion here is a TYPING AID over names the CLI owns, and
 * the honest consequence is that the list can go stale when the CLI adds one.
 *
 * That is stated in the UI, and it is why nothing here refuses an unknown
 * command. A composer that rejected a `/` name it did not recognise would block
 * a command the CLI grew last week, which is a worse failure than offering a
 * name that has been retired.
 *
 * The list is deliberately short — the commands that are useful mid-conversation
 * in a headless session, not the whole of `claude --help`. Interactive-only
 * commands (`/login`, `/config`, `/terminal-setup`) are excluded on purpose:
 * offering them here would be offering something that cannot work down this
 * transport.
 *
 * PURE — no React, no DOM.
 */

export interface SlashCommand {
  /** Without the leading slash. */
  readonly name: string;
  readonly summary: string;
  /** Shown after the name, e.g. `<file>` — a hint, never inserted. */
  readonly argument?: string;
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "clear", summary: "Clear the conversation history the CLI is holding" },
  { name: "compact", summary: "Compact the history into a summary", argument: "[instructions]" },
  { name: "context", summary: "Show what is currently in the context window" },
  { name: "cost", summary: "Show the token and cost total for this session" },
  { name: "init", summary: "Write a CLAUDE.md describing the codebase" },
  { name: "memory", summary: "Edit the persistent memory files" },
  { name: "review", summary: "Review the working tree or a pull request", argument: "[target]" },
  { name: "security-review", summary: "Security review of the pending changes" },
  { name: "todos", summary: "List the current task list" },
  { name: "help", summary: "The CLI's own command list — the authority, not this one" }
];

export interface SlashMatch {
  /** The partial name typed after the slash. */
  readonly typed: string;
  /** Index of the `/` in the draft. */
  readonly start: number;
  readonly matches: readonly SlashCommand[];
}

/**
 * Is the caret inside a slash command, and what completes it?
 *
 * The rule is narrow on purpose: the `/` must be the first non-space character
 * of the draft, and the caret must be in the word that follows it. Anything
 * looser and the menu opens while someone is typing a file path — `src/claude`
 * — which is a popup appearing over the text you are writing, in the app where
 * people paste paths all day.
 */
export function slashMatch(draft: string, caret: number): SlashMatch | null {
  const before = draft.slice(0, caret);
  // A slash command occupies the whole draft's first line and nothing precedes
  // it but whitespace.
  const match = /^(\s*)\/(\S*)$/.exec(before);
  if (!match) return null;
  const typed = match[2]!.toLowerCase();
  const matches = SLASH_COMMANDS.filter((command) => command.name.startsWith(typed));
  return { typed, start: match[1]!.length, matches };
}

/** Replace the partial name with the full one, leaving a trailing space so the
 *  reader can type an argument without reaching for the spacebar first. */
export function applySlash(
  draft: string,
  caret: number,
  match: SlashMatch,
  command: SlashCommand
): { text: string; caret: number } {
  const head = `${draft.slice(0, match.start)}/${command.name} `;
  const tail = draft.slice(caret);
  return { text: `${head}${tail}`, caret: head.length };
}

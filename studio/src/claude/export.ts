/**
 * @file Conversation EXPORT — `axf-claude` P3's library verb, as pure
 * functions over a {@link ConversationRecord}.
 *
 * **Isomorphic and side-effect free.** It returns bytes and a filename; it does
 * not touch the filesystem, does not reach for `Blob`, and does not know what a
 * download is. The workspace turns the result into an object URL, and a route
 * could return the same bytes with no second formatter — which is the point.
 * An export whose formatting lives inside a click handler is an export nothing
 * else can ever call.
 *
 * Two formats, and the reason there are exactly two:
 *
 *   - **markdown** — what a person wants: readable, pasteable, diffable, and
 *     the format the transcript is already written in (assistant prose IS
 *     markdown, so the export is lossless for the part a reader cares about).
 *   - **json** — what a machine wants: the record verbatim, `format` tag
 *     included, so an export can be read back by anything that understands the
 *     store's own document. A re-import path does not exist yet; shipping the
 *     tag is what makes writing one later a read rather than a reverse-engineer.
 *
 * HTML was considered and refused: it is markdown plus a renderer, the renderer
 * already exists on screen, and a third format is a third thing to keep in step
 * with a record shape that is still moving.
 */
import type { ConversationRecord } from "./types";

export type ExportFormat = "markdown" | "json";

export interface ExportedConversation {
  readonly filename: string;
  readonly mediaType: string;
  readonly text: string;
}

/**
 * A conversation title as a safe file name stem.
 *
 * Everything outside `[a-z0-9-]` collapses to a hyphen — deliberately stricter
 * than "remove the illegal characters", because this string is offered as a
 * download name on an unknown OS and the interesting failures there are not the
 * obviously-illegal characters but the quiet ones: a trailing dot and a
 * reserved device name are both legal-looking and both break on Windows.
 */
export function fileStem(title: string, fallback: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function money(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0.00";
  return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
}

/**
 * The front matter every markdown export carries.
 *
 * A YAML block rather than prose, because the fields it records — the model,
 * the cwd, the CLI session id — are exactly what someone reading an exported
 * transcript six months later needs in order to reproduce it, and a sentence
 * saying the same thing cannot be parsed back.
 */
function frontMatter(record: ConversationRecord): string {
  const lines = [
    "---",
    `title: ${JSON.stringify(record.title)}`,
    `conversation: ${record.id}`,
    `created: ${record.createdAt}`,
    `updated: ${record.updatedAt}`,
    `model: ${record.model}`,
    `effort: ${record.effort ?? "(the CLI's own default)"}`,
    `permissionMode: ${record.permissionMode}`,
    `cwd: ${JSON.stringify(record.cwd)}`,
    `messages: ${record.messages.length}`,
    `costUsd: ${record.totalCostUsd.toFixed(6)}`
  ];
  // Only when there is one: a `cliSessionId: undefined` line reads as a field
  // whose value is the word "undefined".
  if (record.cliSessionId) lines.push(`cliSessionId: ${record.cliSessionId}`);
  if (record.system.trim()) lines.push("hasSystemContract: true");
  lines.push("---", "");
  return lines.join("\n");
}

/**
 * Assistant prose is markdown already and is emitted verbatim — reformatting it
 * would be this file editing the model's answer. A USER message is not
 * necessarily markdown, but it is quoted rather than escaped for the same
 * reason: a person's `#` is a heading to them too, and escaping it would change
 * what they wrote to protect a renderer.
 */
function messageBlock(role: "user" | "assistant", at: string, text: string, costUsd?: number): string {
  const stamp = at.replace("T", " ").slice(0, 19);
  const who = role === "user" ? "You" : "Claude";
  const cost = role === "assistant" && costUsd ? ` · ${money(costUsd)}` : "";
  return `## ${who} · ${stamp}${cost}\n\n${text.trimEnd()}\n`;
}

export function toMarkdown(record: ConversationRecord): string {
  const parts = [frontMatter(record), `# ${record.title}\n`];
  if (record.system.trim()) {
    // Fenced, not quoted: a system contract routinely contains markdown of its
    // own, and a blockquote of a fenced block renders as neither.
    parts.push(`## System contract\n\n\`\`\`\n${record.system.trim()}\n\`\`\`\n`);
  }
  if (!record.messages.length) {
    parts.push("_This conversation has no messages yet._\n");
  }
  for (const message of record.messages) {
    parts.push(messageBlock(message.role, message.at, message.text, message.costUsd));
  }
  return `${parts.join("\n")}\n`;
}

export function exportConversation(
  record: ConversationRecord,
  format: ExportFormat
): ExportedConversation {
  const stem = fileStem(record.title, `conversation-${record.id.slice(0, 8)}`);
  return format === "json"
    ? {
        filename: `${stem}.json`,
        mediaType: "application/json",
        text: `${JSON.stringify(record, null, 2)}\n`
      }
    : {
        filename: `${stem}.md`,
        mediaType: "text/markdown",
        text: toMarkdown(record)
      };
}

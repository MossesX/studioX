"use client";

/**
 * @file Tool calls, file-edit diffs, todo lists and nested subagent runs — the
 * four things that make a transcript a WORKSPACE rather than a chat log.
 *
 * ── the summary line is the feature ──────────────────────────────────────────
 *
 * A turn can carry forty tool calls. Expanded, that is a page of JSON between
 * the question and the answer; hidden, the reader cannot tell what the model
 * actually did. So a closed card has to say enough on ONE line to be skippable
 * without being opened — which is why {@link summarise} exists and why it is
 * shape-driven per tool rather than "the first 80 characters of the input".
 * `Bash: npm test` and `Read: src/claude/service.ts` are the whole point.
 *
 * ── nesting ─────────────────────────────────────────────────────────────────
 *
 * A subagent's work is already threaded under its spawning call by
 * `transcript.ts` (it has to be — the capture proves subagent traffic is
 * interleaved into one stream and separable only by `parent_tool_use_id`). This
 * file just draws the nesting, and draws it INDENTED WITH A RULE rather than as
 * a second transcript: a subagent's tool calls look exactly like the parent's,
 * and without a visual containment the reader cannot tell whose work they are.
 *
 * Depth is capped for rendering: a subagent that spawns a subagent that spawns
 * a subagent is legal and the indent is not. Past {@link MAX_NEST_DEPTH} the
 * children render flat with a note, rather than marching off the right edge.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { MONO, Tag, tokens as fmtTokens } from "./bits";
import CodeBlock from "./CodeBlock";
import DiffView from "./DiffView";
import type { SubagentRun, ToolItem, TodoItem } from "./transcript";
import { useNonce, useWorkspaceUi } from "./ui";

export const MAX_NEST_DEPTH = 3;

/* --------------------------------- summaries -------------------------------- */

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The tail of a path — a full Windows path is 90 characters of directory and
 *  8 of filename, and the filename is the part that identifies the call. */
function tailOf(path: string, segments = 2): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length <= segments ? path : `…/${parts.slice(-segments).join("/")}`;
}

/**
 * One line describing what a call DID.
 *
 * Keyed on the input's shape, with the tool name only as a fallback label —
 * the same rule `diff.ts` and `todoOpOf` follow, and for the same reason: a
 * renamed tool must degrade to a generic summary, not to a wrong one.
 */
export function summarise(item: ToolItem): string {
  const input = item.input;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const fields = input as Record<string, unknown>;

  const command = str(fields.command);
  if (command) return command.length > 120 ? `${command.slice(0, 119)}…` : command;

  const description = str(fields.description);
  const path = str(fields.file_path) ?? str(fields.path);
  if (path) return tailOf(path);

  const pattern = str(fields.pattern) ?? str(fields.query);
  if (pattern) return pattern;

  const prompt = str(fields.prompt);
  if (description) return description;
  if (prompt) return prompt.length > 120 ? `${prompt.slice(0, 119)}…` : prompt;

  const url = str(fields.url);
  if (url) return url;

  // Nothing recognised: show the field names rather than a JSON dump. It says
  // what KIND of call it was, which is what a skimming reader needs.
  const keys = Object.keys(fields);
  return keys.length ? `{ ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""} }` : "";
}

/** The output pane's language guess, so a JSON result highlights as JSON. */
function outputLang(text: string): string | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(text);
      return "json";
    } catch {
      // Looked like JSON and is not — a truncated result, most often. Falls
      // through to plain, which is right: half-highlighted JSON reads as broken.
    }
  }
  if (/^(diff --git|@@ |--- |\+\+\+ )/m.test(trimmed)) return "diff";
  return null;
}

/* ---------------------------------- subagent -------------------------------- */

function SubagentHeader({ run }: { run: SubagentRun }) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, flexWrap: "wrap", mb: 0.4 }}>
      <Tag tone={run.done ? "ok" : "accent"}>{run.subagentType ?? "subagent"}</Tag>
      {run.status && <Tag tone={run.status === "completed" ? "ok" : "dim"}>{run.status}</Tag>}
      {run.lastToolName && !run.done && <Tag tone="dim">{run.lastToolName}…</Tag>}
      {run.totalTokens !== null && (
        <Tag tone="dim" title="Tokens the subagent spent, as the CLI reported them.">
          {fmtTokens(run.totalTokens)} tok
        </Tag>
      )}
      {run.durationMs !== null && <Tag tone="dim">{(run.durationMs / 1000).toFixed(1)}s</Tag>}
    </Box>
  );
}

/* ----------------------------------- todos ---------------------------------- */

const TODO_TONE: Record<string, "dim" | "accent" | "ok" | "err"> = {
  pending: "dim",
  in_progress: "accent",
  completed: "ok",
  deleted: "err"
};

/**
 * The todo list, drawn as ONE living block.
 *
 * `transcript.ts` folds every `TaskCreate`/`TaskUpdate` into this rather than
 * drawing forty cards, because forty cards saying "Task #7 → completed" is not
 * a todo list — it is the log of one being maintained. What a reader wants is
 * the current state, which is this.
 */
export function TodoList({ item }: { item: TodoItem }) {
  const done = item.todos.filter((todo) => todo.status === "completed").length;
  const live = item.todos.filter((todo) => todo.status !== "deleted");
  return (
    <Box
      data-axf-area="claude-workspace.tool"
      data-axf-tool={item.id}
      sx={{
        my: 1,
        border: `1px solid ${token("edge")}`,
        borderRadius: token("radius-tight"),
        background: token("panel")
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, px: 1, py: 0.5 }}>
        <Glyph id="icon-layers" size={13} />
        <Typography sx={{ fontSize: 12, fontWeight: 700 }}>Plan</Typography>
        <Tag tone={done === live.length ? "ok" : "dim"}>
          {done}/{live.length}
        </Tag>
      </Box>
      <Box sx={{ px: 1, pb: 0.8 }}>
        {live.map((todo) => (
          <Box key={todo.id} sx={{ display: "flex", alignItems: "baseline", gap: 0.8, py: 0.15 }}>
            <Box
              component="span"
              aria-hidden
              sx={{ ...MONO, fontSize: 11, color: token(TODO_TONE[todo.status] ?? "dim") }}
            >
              {todo.status === "completed" ? "[x]" : todo.status === "in_progress" ? "[~]" : "[ ]"}
            </Box>
            <Typography
              sx={{
                fontSize: 12.5,
                color: todo.status === "completed" ? token("dim") : token("ink"),
                textDecoration: todo.status === "completed" ? "line-through" : undefined
              }}
            >
              {todo.subject}
            </Typography>
          </Box>
        ))}
        {!live.length && (
          <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
            Every task in this plan was deleted.
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/* --------------------------------- the card --------------------------------- */

export interface ToolCardProps {
  readonly item: ToolItem;
  readonly depth: number;
  readonly defaultOpen: boolean;
  /** Renders a nested transcript — passed in rather than imported, because
   *  `Transcript.tsx` imports this file and the cycle would be real. */
  readonly renderChildren: (items: ToolItem["children"], depth: number) => React.ReactNode;
}

export default function ToolCard({ item, depth, defaultOpen, renderChildren }: ToolCardProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const ui = useWorkspaceUi();
  useNonce(ui.expandNonce, () => setOpen(true));
  useNonce(ui.collapseNonce, () => setOpen(false));

  const running = item.result === null;
  const failed = item.result?.isError === true;
  const summary = summarise(item);
  const output = item.result?.text ?? "";
  const nested = item.children.length > 0;

  return (
    <Box
      data-axf-area="claude-workspace.tool"
      data-axf-tool={item.id}
      data-axf-tool-name={item.name}
      sx={{
        my: 0.6,
        border: `1px solid ${failed ? token("err") : token("edge")}`,
        borderRadius: token("radius-tight"),
        background: token("panel"),
        overflow: "hidden"
      }}
    >
      {/* ---------------------------------------------------- summary row */}
      <Box
        role="button"
        tabIndex={0}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.8,
          px: 1,
          py: 0.45,
          cursor: "pointer",
          "&:hover": { background: token("panel2") }
        }}
      >
        <Glyph id={open ? "icon-chevron-down" : "icon-chevron-up"} size={11} />
        <Typography sx={{ ...MONO, fontSize: 11.5, fontWeight: 700, color: token("accent2") }}>
          {item.name}
        </Typography>
        <Typography
          sx={{
            ...MONO,
            fontSize: 11.5,
            color: token("dim"),
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {summary}
        </Typography>
        {item.subagent && <Tag tone={item.subagent.done ? "ok" : "accent"}>{item.subagent.subagentType ?? "agent"}</Tag>}
        {item.diff && (
          <Tag tone="dim" title={item.diff.path ?? undefined}>
            +{item.diff.added} −{item.diff.removed}
          </Tag>
        )}
        {failed && <Tag tone="err">error</Tag>}
        {running && <Tag tone="accent">running…</Tag>}
      </Box>

      {/* A determinate-looking bar would be a lie: the CLI reports no progress
          for a tool call. An indeterminate one says "still going", which is the
          only true thing there is to say. */}
      {running && <LinearProgress sx={{ height: 2 }} />}

      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 1, pb: 1, borderTop: `1px solid ${token("edge")}` }}>
          {item.subagent && <Box sx={{ pt: 0.8 }}><SubagentHeader run={item.subagent} /></Box>}

          {/* -------------------------------------------------- the input */}
          {item.input === undefined ? (
            <Typography sx={{ fontSize: 11.5, color: token("dim"), pt: 0.8 }}>
              The arguments have not finished streaming.
            </Typography>
          ) : item.diff ? (
            <DiffView diff={item.diff} />
          ) : (
            <CodeBlock
              code={prettyInput(item.input)}
              lang="json"
              label={`the ${item.name} input`}
              maxLines={24}
            />
          )}

          {/* ------------------------------------------------- the output */}
          {item.result && (
            <Box sx={{ mt: 0.4 }}>
              <Typography sx={{ fontSize: 10.5, color: failed ? token("err") : token("dim"), mb: 0.2 }}>
                {failed ? "Failed" : "Result"}
              </Typography>
              {output ? (
                <CodeBlock
                  code={output}
                  lang={outputLang(output)}
                  label={`the ${item.name} output`}
                  maxLines={24}
                />
              ) : (
                <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
                  The call returned no text.
                </Typography>
              )}
            </Box>
          )}

          {/* ------------------------------------------- the nested agent */}
          {nested && (
            <Box sx={{ mt: 0.6 }}>
              {depth >= MAX_NEST_DEPTH ? (
                <>
                  <Tooltip title="Nesting is capped so a deep agent tree cannot march off the right edge. The work is all here — only the indent stops.">
                    <Typography sx={{ fontSize: 10.5, color: token("warn"), mb: 0.3 }}>
                      Nested {MAX_NEST_DEPTH} deep — shown flat below.
                    </Typography>
                  </Tooltip>
                  {renderChildren(item.children, depth)}
                </>
              ) : (
                <Box sx={{ pl: 1.2, borderLeft: `2px solid ${token("accent")}`, opacity: 0.95 }}>
                  {renderChildren(item.children, depth + 1)}
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

/**
 * A tool input as readable JSON.
 *
 * Multi-line string fields are the reason this is not a bare `JSON.stringify`:
 * a `Write`'s `content` or an `Agent`'s `prompt` is a whole document, and
 * `\n\n## Heading\n` escaped onto one line is unreadable. Those are lifted out
 * and printed after the object, which is what a person needs to see.
 */
export function prettyInput(input: unknown): string {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return JSON.stringify(input ?? null);
  const fields = input as Record<string, unknown>;
  const inline: Record<string, unknown> = {};
  const long: [string, string][] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string" && (value.includes("\n") || value.length > 200)) long.push([key, value]);
    else inline[key] = value;
  }
  const head = JSON.stringify(inline, null, 2);
  if (!long.length) return head;
  return [head, ...long.map(([key, value]) => `\n// ${key}:\n${value}`)].join("\n");
}

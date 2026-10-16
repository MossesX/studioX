"use client";

/**
 * @file A code block: highlighted, line-numbered on demand, with a REAL copy
 * button.
 *
 * "Real" is doing work in that sentence. P3 asks for *"syntax-highlighted code
 * with a real copy button"*, and the failure it is guarding against is the one
 * every chat UI ships at least once — a button that copies the RENDERED text,
 * so the line numbers, the `$` prompts and the highlighting's inserted
 * whitespace all come along and the pasted command does not run. This copies
 * {@link CodeBlockProps.code}, the string the parser produced, byte for byte.
 *
 * ── the streaming affordance ─────────────────────────────────────────────────
 *
 * `closed: false` means the model is still inside the fence. The block renders
 * immediately anyway (that is decision 1 in `markdown.ts`), and it says so — an
 * unterminated block is the normal state for several seconds and a reader
 * copying it mid-stream would otherwise get a truncated file with no warning.
 *
 * ── why the whole block is not virtualised ───────────────────────────────────
 *
 * A 4,000-line file in a transcript is real and a `<pre>` of 4,000 highlighted
 * lines is slow. It is CLAMPED instead of virtualised: past
 * {@link COLLAPSE_LINES} the block renders its head and offers "show all".
 * Virtualisation inside a scroller that is itself anchored to the bottom fights
 * the anchoring on every measurement, and the transcript's scroll behaviour is
 * the thing P3 is most explicit about not getting wrong.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";

import { token } from "@axf/core";

import { MONO, Tag } from "./bits";
import { isKnownLanguage, tokenize, type TokenKind } from "./highlight";
import { copyAndSay } from "./ui";

/** Lines shown before a block clamps itself. */
export const COLLAPSE_LINES = 40;

/**
 * Token kind → theme role.
 *
 * Data rather than a switch in the renderer, and every entry is a `token()`
 * call: the theme owns every colour with no exceptions, so a highlighter that
 * shipped its own palette would be the one surface a roll cannot restyle.
 * Roles are reused deliberately — `accent2`/`accent3` are the theme's own
 * secondary hues, which is what keeps a highlighted block inside the palette
 * rather than beside it.
 */
const KIND_ROLE: Record<TokenKind, string> = {
  plain: "ink",
  comment: "dim",
  string: "ok",
  number: "accent3",
  keyword: "accent",
  type: "accent2",
  function: "info",
  punct: "dim",
  meta: "accent3",
  added: "ok",
  removed: "err"
};

export interface CodeBlockProps {
  readonly code: string;
  readonly lang: string | null;
  /** False while the closing fence has not arrived — the streaming case. */
  readonly closed?: boolean;
  /** Line numbers. Off inside tool cards, where the code is an argument rather
   *  than a file and the numbers would be a lie about where it came from. */
  readonly lineNumbers?: boolean;
  /** What the copy toast calls it. */
  readonly label?: string;
  readonly maxLines?: number;
}

export default function CodeBlock({
  code,
  lang,
  closed = true,
  lineNumbers = false,
  label = "the code",
  maxLines = COLLAPSE_LINES
}: CodeBlockProps) {
  const [expanded, setExpanded] = React.useState(false);
  const lines = React.useMemo(() => code.split("\n"), [code]);
  const clamped = !expanded && lines.length > maxLines;
  const shown = clamped ? lines.slice(0, maxLines).join("\n") : code;

  // Tokenising is the expensive part and the text changes on every delta while
  // streaming, so it is memoised on exactly the string being drawn.
  const tokens = React.useMemo(() => tokenize(shown, lang), [shown, lang]);

  return (
    <Box
      sx={{
        position: "relative",
        my: 1,
        borderRadius: token("radius-tight"),
        border: `1px solid ${token("edge")}`,
        background: token("panel2"),
        overflow: "hidden"
      }}
    >
      {/* header: language, streaming state, copy */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.8,
          px: 1,
          py: 0.4,
          borderBottom: `1px solid ${token("edge")}`,
          background: token("panel")
        }}
      >
        {lang && (
          <Tag
            tone={isKnownLanguage(lang) ? "dim" : "warn"}
            title={
              isKnownLanguage(lang)
                ? undefined
                : `No highlighter for "${lang}" — shown uncoloured rather than mis-coloured.`
            }
          >
            {lang}
          </Tag>
        )}
        {!closed && <Tag tone="accent">still writing…</Tag>}
        <Box sx={{ flex: 1 }} />
        {lines.length > maxLines && (
          <Button size="small" variant="text" onClick={() => setExpanded((v) => !v)} sx={{ fontSize: 11, py: 0 }}>
            {clamped ? `Show all ${lines.length} lines` : "Show less"}
          </Button>
        )}
        <Tooltip
          title={
            closed
              ? "Copy exactly the source below — no line numbers, no formatting."
              : "This block is still streaming; you will copy what has arrived so far."
          }
        >
          <Button
            size="small"
            variant="outlined"
            onClick={() => void copyAndSay(code, label)}
            sx={{ fontSize: 11, py: 0, minWidth: 0, px: 1 }}
          >
            Copy
          </Button>
        </Tooltip>
      </Box>

      <Box
        component="pre"
        sx={{
          m: 0,
          p: 1,
          overflowX: "auto",
          ...MONO,
          fontSize: 12,
          lineHeight: 1.55,
          // `pre` alone would let a long line stretch the transcript's whole
          // column; the scroller belongs to the block.
          whiteSpace: "pre",
          tabSize: 2
        }}
      >
        <Box component="code" sx={{ display: "block", minWidth: "max-content" }}>
          {lineNumbers ? (
            <NumberedTokens tokens={tokens} />
          ) : (
            tokens.map((tok, index) => (
              <Box key={index} component="span" sx={{ color: token(KIND_ROLE[tok.kind]!) }}>
                {tok.text}
              </Box>
            ))
          )}
        </Box>
      </Box>

      {clamped && (
        <Box
          sx={{
            px: 1,
            py: 0.3,
            fontSize: 11,
            color: token("dim"),
            borderTop: `1px solid ${token("edge")}`
          }}
        >
          {lines.length - maxLines} more line{lines.length - maxLines === 1 ? "" : "s"} hidden
        </Box>
      )}
    </Box>
  );
}

/**
 * The same tokens, with a gutter.
 *
 * The tokens are re-split by line rather than the source being highlighted per
 * line: a block comment or a template literal spans lines, and tokenising each
 * line on its own would restart the lexer inside them and colour the remainder
 * as code.
 */
function NumberedTokens({ tokens }: { tokens: readonly { kind: TokenKind; text: string }[] }) {
  const rows: { kind: TokenKind; text: string }[][] = [[]];
  for (const tok of tokens) {
    const pieces = tok.text.split("\n");
    pieces.forEach((piece, index) => {
      if (index > 0) rows.push([]);
      if (piece) rows[rows.length - 1]!.push({ kind: tok.kind, text: piece });
    });
  }
  const width = String(rows.length).length;
  return (
    <>
      {rows.map((row, index) => (
        <Box key={index} sx={{ display: "flex" }}>
          <Box
            component="span"
            aria-hidden
            sx={{
              color: token("dim"),
              opacity: 0.55,
              pr: 1.2,
              textAlign: "right",
              minWidth: `${width + 1}ch`,
              // Excluded from selection so a copy taken with the mouse — rather
              // than with the button — still pastes as runnable code.
              userSelect: "none"
            }}
          >
            {index + 1}
          </Box>
          <Box component="span" sx={{ flex: 1 }}>
            {row.map((tok, i) => (
              <Box key={i} component="span" sx={{ color: token(KIND_ROLE[tok.kind]!) }}>
                {tok.text}
              </Box>
            ))}
            {"\n"}
          </Box>
        </Box>
      ))}
    </>
  );
}

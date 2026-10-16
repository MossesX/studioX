"use client";

/**
 * @file Renders the block model from `markdown.ts` as MUI.
 *
 * ── the security posture, stated once ────────────────────────────────────────
 *
 * There is no `dangerouslySetInnerHTML` anywhere in this file and there must
 * never be one. The text being rendered is arbitrary model output; every span
 * and block below becomes a React element, so markup in the source is TEXT by
 * construction rather than by sanitisation. `markdown.ts` does not parse HTML
 * for the same reason, and a future "just render the HTML" would undo both
 * halves at once.
 *
 * Link `href`s are the one place a string reaches an attribute, so they are
 * filtered to http/https/mailto — `javascript:` is the whole attack and it is
 * one line to refuse.
 *
 * ── why blocks are keyed on the parser's ids ─────────────────────────────────
 *
 * `markdown.ts` mints `<kind>:<ordinal>` ids precisely so a growing document
 * keeps stable element identity: a paragraph does not remount as its text
 * arrives, and a block appearing after it does not remount everything below.
 * That is what keeps a text selection alive and a `<pre>`'s horizontal scroll
 * from resetting on every delta of a streaming answer.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { MONO } from "./bits";
import CodeBlock from "./CodeBlock";
import { parseMarkdown } from "./markdown";
import type { MdBlock, MdListItem, MdSpan } from "./markdown";

/** http, https and mailto only. Everything else renders as plain text, which
 *  is what `javascript:` deserves and what a relative path in a model's answer
 *  honestly is — it points at nothing this app can resolve. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null;
}

function Spans({ spans }: { spans: readonly MdSpan[] }) {
  return (
    <>
      {spans.map((span, index) => {
        switch (span.kind) {
          case "text":
            return <React.Fragment key={index}>{span.text}</React.Fragment>;
          case "strong":
            return (
              <Box key={index} component="strong" sx={{ fontWeight: 700 }}>
                <Spans spans={span.spans} />
              </Box>
            );
          case "em":
            return (
              <Box key={index} component="em" sx={{ fontStyle: "italic" }}>
                <Spans spans={span.spans} />
              </Box>
            );
          case "strike":
            return (
              <Box key={index} component="s" sx={{ opacity: 0.7 }}>
                <Spans spans={span.spans} />
              </Box>
            );
          case "code":
            return (
              <Box
                key={index}
                component="code"
                sx={{
                  ...MONO,
                  fontSize: "0.92em",
                  px: 0.4,
                  py: "1px",
                  borderRadius: 0.5,
                  background: token("panel2"),
                  border: `1px solid ${token("edge")}`,
                  // A long path or symbol must be able to break, or one inline
                  // code span sets the minimum width of the whole column.
                  wordBreak: "break-word"
                }}
              >
                {span.text}
              </Box>
            );
          case "link": {
            const href = safeHref(span.href);
            if (!href) {
              return (
                <React.Fragment key={index}>
                  <Spans spans={span.spans} />
                </React.Fragment>
              );
            }
            return (
              <Link
                key={index}
                href={href}
                target="_blank"
                // `noopener` is the one that matters — a `target="_blank"`
                // without it hands the opened page a handle on this one.
                rel="noopener noreferrer"
                sx={{ color: token("accent"), textDecorationColor: token("edge") }}
              >
                <Spans spans={span.spans} />
              </Link>
            );
          }
        }
      })}
    </>
  );
}

function ListItems({ items, ordered }: { items: readonly MdListItem[]; ordered: boolean }) {
  return (
    <Box
      component={ordered ? "ol" : "ul"}
      sx={{
        my: 0.5,
        pl: 2.6,
        // Task lists carry their own marker; a bullet beside a checkbox is two
        // markers for one item.
        listStyle: items.every((item) => item.checked !== null) ? "none" : undefined,
        "& > li": { mb: 0.25 }
      }}
    >
      {items.map((item, index) => (
        <Box component="li" key={index} sx={{ pl: item.checked === null ? 0 : 0 }}>
          {item.checked !== null && (
            <Box
              component="span"
              aria-hidden
              sx={{ ...MONO, color: item.checked ? token("ok") : token("dim"), mr: 0.6 }}
            >
              {item.checked ? "[x]" : "[ ]"}
            </Box>
          )}
          <Box
            component="span"
            sx={item.checked ? { opacity: 0.65, textDecoration: "line-through" } : undefined}
          >
            <Spans spans={item.spans} />
          </Box>
          {item.children && <Blocks blocks={[item.children]} />}
        </Box>
      ))}
    </Box>
  );
}

function Block({ block }: { block: MdBlock }) {
  switch (block.kind) {
    case "paragraph":
      return (
        <Typography
          sx={{
            fontSize: token("size-body"),
            lineHeight: 1.6,
            my: 0.7,
            // The parser preserves a hard break as a newline; without this the
            // two-space break renders as a space.
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          }}
        >
          <Spans spans={block.spans} />
        </Typography>
      );

    case "heading": {
      // Sizes step down deliberately gently: these headings sit INSIDE a
      // message, and an `h1` at document scale would out-shout the app's chrome.
      const size = [0, 19, 17, 15.5, 14.5, 13.8, 13.2][block.level] ?? 14;
      return (
        <Typography
          component={`h${block.level}` as "h1"}
          sx={{ fontSize: size, fontWeight: 700, mt: 1.4, mb: 0.5, lineHeight: 1.3 }}
        >
          <Spans spans={block.spans} />
        </Typography>
      );
    }

    case "code":
      return <CodeBlock code={block.code} lang={block.lang} closed={block.closed} />;

    case "list":
      return <ListItems items={block.items} ordered={block.ordered} />;

    case "quote":
      return (
        <Box
          sx={{
            my: 0.8,
            pl: 1.2,
            borderLeft: `3px solid ${token("edge")}`,
            color: token("dim")
          }}
        >
          <Blocks blocks={block.blocks} />
        </Box>
      );

    case "rule":
      return <Box sx={{ my: 1.2, height: "1px", background: token("edge") }} />;

    case "table":
      return (
        <Box sx={{ my: 1, overflowX: "auto", border: `1px solid ${token("edge")}`, borderRadius: token("radius-tight") }}>
          <Table size="small" sx={{ "& td, & th": { fontSize: 12.5, py: 0.4 } }}>
            <TableHead>
              <TableRow>
                {block.head.map((cell, index) => (
                  <TableCell key={index} align={block.align[index] ?? "left"} sx={{ fontWeight: 700 }}>
                    <Spans spans={cell} />
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {block.rows.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {row.map((cell, index) => (
                    <TableCell key={index} align={block.align[index] ?? "left"}>
                      <Spans spans={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      );
  }
}

function Blocks({ blocks }: { blocks: readonly MdBlock[] }) {
  return (
    <>
      {blocks.map((block) => (
        <Block key={block.id} block={block} />
      ))}
    </>
  );
}

/**
 * Render markdown.
 *
 * The parse is memoised on the source string, which is what makes re-running a
 * whole-document parse on every delta affordable: React re-renders the message
 * for other reasons far more often than the text actually changes.
 */
export default function Markdown({ source }: { source: string }) {
  const blocks = React.useMemo(() => parseMarkdown(source), [source]);
  return (
    <Box
      sx={{
        // First and last margins collapse into the message's own padding, or
        // every message carries an extra line of space at both ends.
        "& > *:first-of-type": { mt: 0 },
        "& > *:last-child": { mb: 0 }
      }}
    >
      <Blocks blocks={blocks} />
    </Box>
  );
}

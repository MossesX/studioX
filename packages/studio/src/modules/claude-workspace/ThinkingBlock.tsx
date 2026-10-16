"use client";

/**
 * @file A collapsible thinking block.
 *
 * Small, and one of the two places in this module where a measured finding from
 * the capture drives the design outright (`claudeEvents.ts` finding 5):
 *
 * > *ten `thinking_delta` events carrying an EMPTY string — while the same turn
 * > reports 813 thinking tokens.*
 *
 * So a thinking block that renders only when there is TEXT shows nothing at all
 * for a redacted think, and the reader watches a frozen screen through the
 * slowest part of the turn. This block therefore exists from `thinking_start`,
 * before any text, and falls back to the token count as its progress signal.
 *
 * Collapsed by default, always. Thinking is not the answer, it is routinely
 * longer than the answer (capture-b: twenty-nine unbroken blocks), and a reader
 * who wants it can open it. Whether it appears at all is the one genuine
 * setting — see `settings.ts` on why that question has no right default.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { Caret, Tag, tokens as fmtTokens } from "./bits";
import Markdown from "./MarkdownView";
import type { ThinkingItem } from "./transcript";

export default function ThinkingBlock({ item }: { item: ThinkingItem }) {
  const [open, setOpen] = React.useState(false);
  const redacted = item.text.trim() === "";

  return (
    <Box
      sx={{
        maxWidth: "min(94%, 74rem)",
        border: `1px dashed ${token("edge")}`,
        borderRadius: token("radius-tight"),
        background: token("panel"),
        opacity: 0.92
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-expanded={open}
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
          py: 0.4,
          cursor: redacted ? "default" : "pointer",
          "&:hover": { background: redacted ? undefined : token("panel2") }
        }}
      >
        <Glyph id={open ? "icon-chevron-down" : "icon-chevron-up"} size={11} />
        <Typography sx={{ fontSize: 11.5, color: token("dim"), fontStyle: "italic" }}>
          {item.active ? "Thinking" : "Thought"}
        </Typography>
        {item.tokens > 0 && (
          <Tag tone="dim" title="Thinking tokens, as the CLI reported them.">
            {fmtTokens(item.tokens)} tok
          </Tag>
        )}
        {redacted && !item.active && (
          <Tag
            tone="warn"
            title="The CLI streamed this thinking block with its text redacted. The tokens above are the only record that it happened — this is not a rendering failure."
          >
            redacted
          </Tag>
        )}
        {item.active && <Caret />}
      </Box>

      {/* No expander for a redacted block: opening it to find nothing is worse
          than being told there is nothing to open. */}
      {!redacted && (
        <Collapse in={open} unmountOnExit>
          <Box sx={{ px: 1, pb: 0.8, borderTop: `1px solid ${token("edge")}`, color: token("dim") }}>
            <Markdown source={item.text} />
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

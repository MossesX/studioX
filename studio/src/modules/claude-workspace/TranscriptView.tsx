"use client";

/**
 * @file The transcript, and its scrolling.
 *
 * ── "scroll anchoring that does not fight the reader" ────────────────────────
 *
 * That is P3's wording and it is the hardest thing in this module to get right,
 * because the two obvious implementations are both wrong in ways people notice
 * immediately:
 *
 *   - **Always scroll to the bottom on new content.** Now the reader cannot
 *     read anything while a turn is streaming: they scroll up to check a tool
 *     result and are yanked back down 20 times a second. This is the common
 *     one, and it is what makes people copy an answer into a text editor.
 *   - **Never scroll.** Now the answer arrives off-screen and the reader has to
 *     chase it by hand.
 *
 * The rule here is a latch, and only the READER moves it:
 *
 *   1. The transcript is PINNED to the bottom while the reader is at (or within
 *      {@link PIN_SLACK_PX} of) the bottom.
 *   2. Scrolling up **unpins**. Nothing else does — not a new message, not a
 *      pane resize, not a tool card expanding.
 *   3. Scrolling back to the bottom **re-pins**, as does sending a message and
 *      the explicit "jump to latest" affordance. Sending is included because
 *      typing a message is an unambiguous statement that you are done reading
 *      back.
 *   4. While unpinned, a pill appears saying how far behind the reader is. A
 *      silent unpin is how someone concludes the answer stopped coming.
 *
 * `overflowAnchor: "none"` on the scroller is deliberate and is the subtle
 * half. The browser's native scroll anchoring keeps the viewport's content
 * still when things grow ABOVE it — which sounds like exactly what is wanted,
 * and is precisely wrong here: a streaming block grows and the browser
 * compensates by moving the scroll position, which fights rule 1 by undoing the
 * pin every frame. The latch above is the anchoring; the browser's is turned
 * off so there is one mechanism rather than two arguing.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { Caret, MONO, Stamp, Tag } from "./bits";
import Markdown from "./MarkdownView";
import { useClaudeSettings } from "./settings";
import ThinkingBlock from "./ThinkingBlock";
import ToolCard, { TodoList } from "./ToolCard";
import type { TranscriptItem, TranscriptModel } from "./transcript";
import { useNonce, useWorkspaceUi } from "./ui";

/** How close to the bottom still counts as "at the bottom". Generous enough to
 *  survive a sub-pixel layout wobble, tight enough that a deliberate scroll of
 *  one line unpins. */
export const PIN_SLACK_PX = 72;

/* --------------------------------- messages --------------------------------- */

function UserMessage({ item }: { item: Extract<TranscriptItem, { kind: "user" }> }) {
  return (
    <Box
      data-axf-area="claude-workspace.message"
      data-axf-message={item.id}
      sx={{
        alignSelf: "flex-end",
        maxWidth: "min(78%, 62rem)",
        px: 1.2,
        py: 0.8,
        borderRadius: token("radius"),
        border: `1px solid ${token("edge")}`,
        // The reader's own words sit on the accent-tinted surface. `color-mix`
        // rather than an alpha over a hex, so it holds up under any rolled
        // palette — the same reasoning as the diff row tints.
        background: `color-mix(in srgb, ${token("accent")} 10%, ${token("panel")})`
      }}
    >
      {item.fromAgent && (
        <Box sx={{ mb: 0.4 }}>
          <Tag tone="accent">subagent prompt</Tag>
        </Box>
      )}
      <Typography sx={{ fontSize: token("size-body"), whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {item.text}
      </Typography>
      {item.at && (
        <Box sx={{ textAlign: "right", mt: 0.2 }}>
          <Stamp at={item.at} />
        </Box>
      )}
    </Box>
  );
}

function AssistantMessage({ item }: { item: Extract<TranscriptItem, { kind: "assistant" }> }) {
  return (
    <Box
      data-axf-area="claude-workspace.message"
      data-axf-message={item.id}
      sx={{ maxWidth: "min(94%, 74rem)", px: 0.2 }}
    >
      <Markdown source={item.text} />
      {/* Drawn even when the text is still empty: that is the gap between "the
          turn started" and the first delta, and a bare caret is what says the
          connection is alive rather than stalled. */}
      {item.streaming && <Caret />}
    </Box>
  );
}

function Notice({ item }: { item: Extract<TranscriptItem, { kind: "notice" }> }) {
  const [open, setOpen] = React.useState(false);
  const role = item.tone === "error" ? "err" : item.tone === "warn" ? "warn" : "dim";
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "baseline",
        gap: 0.8,
        flexWrap: "wrap",
        px: 1,
        py: 0.4,
        borderLeft: `2px solid ${token(role)}`,
        background: token("panel"),
        borderRadius: token("radius-tight")
      }}
    >
      <Typography sx={{ fontSize: 12, color: token(role), fontWeight: 600 }}>{item.title}</Typography>
      {item.detail && (
        <Typography sx={{ fontSize: 11.5, color: token("dim") }}>{item.detail}</Typography>
      )}
      {item.payload !== undefined && (
        <>
          <Button size="small" variant="text" sx={{ fontSize: 11, py: 0 }} onClick={() => setOpen((v) => !v)}>
            {open ? "hide" : "show the event"}
          </Button>
          {open && (
            <Box
              component="pre"
              sx={{ ...MONO, fontSize: 11, width: "100%", m: 0, mt: 0.4, overflowX: "auto", color: token("dim") }}
            >
              {JSON.stringify(item.payload, null, 2)}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}

/* --------------------------------- the list --------------------------------- */

function Items({ items, depth }: { items: readonly TranscriptItem[]; depth: number }) {
  const settings = useClaudeSettings();
  const renderChildren = React.useCallback(
    (children: readonly TranscriptItem[], childDepth: number) => (
      <Items items={children} depth={childDepth} />
    ),
    []
  );

  return (
    <>
      {items.map((item) => {
        switch (item.kind) {
          case "user":
            return <UserMessage key={item.id} item={item} />;
          case "assistant":
            return <AssistantMessage key={item.id} item={item} />;
          case "thinking":
            return settings.showThinking ? <ThinkingBlock key={item.id} item={item} /> : null;
          case "tool":
            return (
              <ToolCard
                key={item.id}
                item={item}
                depth={depth}
                defaultOpen={settings.autoExpandTools}
                renderChildren={renderChildren}
              />
            );
          case "todo":
            return <TodoList key={item.id} item={item} />;
          case "notice":
            return <Notice key={item.id} item={item} />;
        }
      })}
    </>
  );
}

/* ------------------------------- the scroller ------------------------------- */

export default function Transcript({
  model,
  loading,
  emptyState
}: {
  model: TranscriptModel;
  loading: boolean;
  emptyState: React.ReactNode;
}) {
  const scroller = React.useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = React.useState(true);
  const [behind, setBehind] = React.useState(0);
  const ui = useWorkspaceUi();

  const toBottom = React.useCallback((behaviour: ScrollBehavior = "auto") => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: behaviour });
    setPinned(true);
    setBehind(0);
  }, []);

  useNonce(ui.jumpNonce, () => toBottom("smooth"));

  const onScroll = React.useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setBehind(distance);
    // Rule 2 and 3: only this handler moves the latch, and it moves it purely
    // from where the reader actually is.
    setPinned(distance <= PIN_SLACK_PX);
  }, []);

  // `useLayoutEffect`, not `useEffect`: the scroll must be applied in the same
  // frame the new content is laid out, or the reader sees the transcript jump
  // after painting one frame at the old position.
  React.useLayoutEffect(() => {
    if (!pinned) {
      const el = scroller.current;
      if (el) setBehind(el.scrollHeight - el.scrollTop - el.clientHeight);
      return;
    }
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [model.items, model.status, pinned]);

  const empty = !model.items.length && !loading;

  return (
    <Box sx={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <Box
        ref={scroller}
        onScroll={onScroll}
        data-axf-area="claude-workspace.transcript"
        data-axf-pinned={pinned ? "1" : "0"}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          overflowX: "hidden",
          px: 1.6,
          py: 1.2,
          display: "flex",
          flexDirection: "column",
          gap: 0.8,
          // See the header: the browser's own anchoring fights the latch.
          overflowAnchor: "none"
        }}
      >
        {empty ? emptyState : <Items items={model.items} depth={0} />}
        {loading && (
          <Typography sx={{ fontSize: 12, color: token("dim") }}>Loading the conversation…</Typography>
        )}
        {model.streaming && model.status && (
          <Typography sx={{ ...MONO, fontSize: 11, color: token("dim") }}>{model.status}…</Typography>
        )}
      </Box>

      {/* Rule 4: never unpin silently. */}
      {!pinned && behind > PIN_SLACK_PX && (
        <Button
          size="small"
          variant="contained"
          onClick={() => toBottom("smooth")}
          startIcon={<Glyph id="icon-chevron-down" size={12} />}
          sx={{
            position: "absolute",
            bottom: 10,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: 11.5,
            py: 0.2,
            boxShadow: token("shadow")
          }}
        >
          {model.streaming ? "Still answering — jump to latest" : "Jump to latest"}
        </Button>
      )}
    </Box>
  );
}

"use client";

/**
 * @file The composer: multiline editing, a history ring, slash completion, and
 * whatever `claude-workspace.composer-action` contributes.
 *
 * ── the three things that make a composer feel wrong ─────────────────────────
 *
 *  1. **The draft is lost.** Sending a turn takes minutes; a reader who wrote
 *     three paragraphs, hit send, and got a refusal ("a turn is already
 *     running") must still have the three paragraphs. So the draft is cleared
 *     only AFTER the send is accepted, and restored if it is refused.
 *  2. **The height fights you.** A single-line box that scrolls internally
 *     hides what you wrote; a fixed tall box wastes the transcript. It grows
 *     with the content up to a ceiling and then scrolls — MUI's `TextField
 *     multiline` with `minRows`/`maxRows` does exactly that, so there is no
 *     hand-rolled auto-size here.
 *  3. **Enter is ambiguous.** Send-on-Enter is right for chat and wrong for
 *     writing a prompt with a code block in it. That is the one genuine
 *     setting; both directions are implemented and neither is the "real" one.
 *
 * ── history ─────────────────────────────────────────────────────────────────
 *
 * Up-arrow walks back through what you have sent, shell-style, and ONLY from an
 * empty draft or from the first line — otherwise Up would stop being a cursor
 * key inside a multiline editor, which is a much worse trade than it sounds.
 * The ring is per browser profile and per conversation-less: prompts are reused
 * across conversations far more often than within one.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import MenuList from "@mui/material/MenuList";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { CAPTURE_TRIGGER, captureFromDraft, openNewTaskItem } from "../taskman/capture";
import { MONO } from "./bits";
import { composerActionContributions } from "./points";
import { useClaudeSettings } from "./settings";
import { applySlash, slashMatch, type SlashCommand, type SlashMatch } from "./slash";
import { useNonce, useWorkspaceUi, workspaceUi } from "./ui";

const HISTORY_KEY = "axs:claude-workspace-history@1";
/** Prompts kept. Long enough to reach last week's, short enough that the
 *  localStorage document stays small when someone pastes a file into a prompt. */
const HISTORY_MAX = 60;

function loadHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const doc = JSON.parse(raw) as { v?: number; items?: unknown };
    return doc?.v === 1 && Array.isArray(doc.items)
      ? doc.items.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function saveHistory(items: readonly string[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify({ v: 1, items: items.slice(0, HISTORY_MAX) }));
  } catch {
    /* quota or private mode — the ring stays in memory for the session */
  }
}

export interface ComposerProps {
  readonly disabled: boolean;
  readonly streaming: boolean;
  /** Resolves when the send was ACCEPTED; rejects when it was refused, which is
   *  what tells this component whether it may clear the draft. */
  readonly onSend: (text: string) => Promise<void>;
  readonly onStop: () => void;
  readonly placeholder?: string;
}

export default function Composer({ disabled, streaming, onSend, onStop, placeholder }: ComposerProps) {
  const settings = useClaudeSettings();
  const ui = useWorkspaceUi();
  const [draft, setDraft] = React.useState("");
  const [caret, setCaret] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [history, setHistory] = React.useState<string[]>([]);
  const [historyAt, setHistoryAt] = React.useState(-1);
  const [slashIndex, setSlashIndex] = React.useState(0);
  const input = React.useRef<HTMLTextAreaElement | null>(null);

  // The standing hydration rule: localStorage is read after mount, never during
  // a render, so the server and the first client frame agree.
  React.useEffect(() => setHistory(loadHistory()), []);

  const actions = composerActionContributions();
  const slash: SlashMatch | null = React.useMemo(() => slashMatch(draft, caret), [draft, caret]);
  const showSlash = Boolean(slash && slash.matches.length && !disabled);

  React.useEffect(() => setSlashIndex(0), [slash?.typed]);

  /* ------------------------------------------------- the UI channel hooks */

  const insertAtCaret = React.useCallback(
    (text: string) => {
      const el = input.current;
      const at = el ? (el.selectionStart ?? draft.length) : draft.length;
      const next = `${draft.slice(0, at)}${text}${draft.slice(at)}`;
      setDraft(next);
      setCaret(at + text.length);
      // The focus and selection have to be restored after React commits, or the
      // caret lands at the end of the box rather than after the insertion.
      window.requestAnimationFrame(() => {
        const node = input.current;
        if (!node) return;
        node.focus();
        node.setSelectionRange(at + text.length, at + text.length);
      });
    },
    [draft]
  );

  useNonce(ui.insert.nonce, () => insertAtCaret(ui.insert.text));
  useNonce(ui.clearDraftNonce, () => setDraft(""));
  useNonce(ui.historyPrevNonce, () => stepHistory(1));

  /* ------------------------------------------------------------- capture */

  /**
   * `.newtask.` opens the Task Manager's capture dialog with whatever follows
   * it already entered — owner, 2026-08-13.
   *
   * It fires from `onChange` rather than on send, because "anytime i type" is
   * what was asked for and because waiting for Enter would send the trigger to
   * the CLI on any of the several paths that submit a draft. The draft is
   * cleared as the dialog opens: leaving `.newtask.` behind in the box means the
   * next keystroke re-fires it, which is a dialog that will not stay shut.
   *
   * Everything after the trigger comes along, so a pasted `.newtask. ring the
   * bank` arrives as a filled-in capture rather than an empty one. Typed live,
   * that text is usually empty — and the dialog focuses its title field, so the
   * sentence continues where it was going anyway.
   */
  const capture = React.useCallback((text: string) => {
    setDraft("");
    setCaret(0);
    openNewTaskItem(text.trim());
  }, []);

  /* ------------------------------------------------------------- history */

  function stepHistory(direction: 1 | -1): void {
    if (!history.length) return;
    const next = Math.min(history.length - 1, Math.max(-1, historyAt + direction));
    setHistoryAt(next);
    setDraft(next < 0 ? "" : history[next]!);
  }

  /* ---------------------------------------------------------------- send */

  const send = React.useCallback(async () => {
    const text = draft.trim();
    if (!text || busy || disabled) return;
    // Belt and braces for the capture: a draft that begins with the trigger is
    // never a prompt for the CLI, however it came to be submitted (a paste
    // followed immediately by Enter beats the onChange path by a frame).
    const captured = captureFromDraft(text);
    if (captured !== null) {
      capture(captured);
      return;
    }
    setBusy(true);
    try {
      await onSend(text);
      // Cleared only on acceptance — point 1 in the header.
      setDraft("");
      setCaret(0);
      setHistoryAt(-1);
      setHistory((previous) => {
        // Re-sending the same prompt should not fill the ring with copies of it.
        const next = [text, ...previous.filter((item) => item !== text)].slice(0, HISTORY_MAX);
        saveHistory(next);
        return next;
      });
    } catch (err) {
      workspaceUi.say(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, busy, disabled, onSend, capture]);

  /* ------------------------------------------------------------- the keys */

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const el = input.current;

    if (showSlash && slash) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSlashIndex((i) => (i + delta + slash.matches.length) % slash.matches.length);
        return;
      }
      if (event.key === "Tab" || (event.key === "Enter" && slash.matches.length)) {
        event.preventDefault();
        chooseSlash(slash.matches[slashIndex] ?? slash.matches[0]!);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        // Ending the token with a space closes the menu without editing what
        // was typed — Escape must not delete the reader's characters.
        insertAtCaret(" ");
        return;
      }
    }

    if (event.key === "Enter") {
      const sends = settings.sendOnEnter ? !event.shiftKey : event.ctrlKey || event.metaKey;
      // A composition (an IME candidate window) also ends with Enter, and
      // sending there would post a half-typed word in every non-Latin script.
      if (sends && !event.nativeEvent.isComposing) {
        event.preventDefault();
        void send();
      }
      return;
    }

    if (event.key === "ArrowUp" && el) {
      // Only from the first line — otherwise Up stops being a cursor key.
      const upToCaret = draft.slice(0, el.selectionStart ?? 0);
      if (!upToCaret.includes("\n")) {
        event.preventDefault();
        stepHistory(1);
      }
      return;
    }
    if (event.key === "ArrowDown" && el && historyAt >= 0) {
      const afterCaret = draft.slice(el.selectionEnd ?? draft.length);
      if (!afterCaret.includes("\n")) {
        event.preventDefault();
        stepHistory(-1);
      }
    }
  }

  function chooseSlash(command: SlashCommand): void {
    if (!slash) return;
    const applied = applySlash(draft, caret, slash, command);
    setDraft(applied.text);
    setCaret(applied.caret);
    window.requestAnimationFrame(() => {
      const node = input.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(applied.caret, applied.caret);
    });
  }

  async function runAction(action: (typeof actions)[number]): Promise<void> {
    try {
      const text = await action.payload.run();
      if (typeof text === "string" && text) insertAtCaret(text);
    } catch (err) {
      // A plugin's action must not be able to break the composer — the same
      // posture the service takes with observer contributions.
      workspaceUi.say(
        `"${action.payload.label}" failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // The capture trigger is named in the hint because a feature you have to be
  // told about in a changelog is a feature nobody uses.
  const hint =
    (settings.sendOnEnter ? "Enter sends · Shift+Enter for a new line" : "Ctrl+Enter sends") +
    ` · ${CAPTURE_TRIGGER} captures a task`;

  return (
    <Box
      data-axf-area="claude-workspace.composer"
      sx={{ position: "relative", borderTop: `1px solid ${token("edge")}`, p: 1, background: token("panel") }}
    >
      {/* -------------------------------------------- slash completion menu */}
      {showSlash && slash && (
        <Paper
          elevation={6}
          sx={{
            position: "absolute",
            bottom: "calc(100% - 4px)",
            left: 12,
            right: 12,
            maxHeight: 240,
            overflowY: "auto",
            zIndex: 3,
            border: `1px solid ${token("edge")}`
          }}
        >
          <MenuList dense disablePadding>
            {slash.matches.map((command, index) => (
              <MenuItem
                key={command.name}
                selected={index === slashIndex}
                onMouseDown={(e) => {
                  // `mousedown`, not `click`: a click would blur the textarea
                  // first, and the caret position the insertion needs is gone
                  // by the time the handler runs.
                  e.preventDefault();
                  chooseSlash(command);
                }}
                sx={{ alignItems: "baseline", gap: 1 }}
              >
                <Typography sx={{ ...MONO, fontSize: 12, color: token("accent") }}>
                  /{command.name}
                </Typography>
                {command.argument && (
                  <Typography sx={{ ...MONO, fontSize: 11, color: token("dim") }}>
                    {command.argument}
                  </Typography>
                )}
                <Typography sx={{ fontSize: 11.5, color: token("dim") }}>{command.summary}</Typography>
              </MenuItem>
            ))}
          </MenuList>
          <Box sx={{ px: 1.2, py: 0.4, borderTop: `1px solid ${token("edge")}` }}>
            <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
              These are the CLI&apos;s commands, completed here as a typing aid — the CLI is the
              authority, and an unlisted one still sends.
            </Typography>
          </Box>
        </Paper>
      )}

      <TextField
        inputRef={input}
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          const captured = captureFromDraft(next);
          if (captured !== null) {
            capture(captured);
            return;
          }
          setDraft(next);
          setCaret(e.target.selectionStart ?? next.length);
        }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        multiline
        minRows={2}
        maxRows={14}
        fullWidth
        size="small"
        placeholder={placeholder ?? "Ask Claude…  (/ for commands, ↑ for history)"}
        sx={{ "& textarea": { fontSize: token("size-body"), lineHeight: 1.55 } }}
      />

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.8, mt: 0.6, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 10.5, color: token("dim") }}>{hint}</Typography>
        <Box sx={{ flex: 1 }} />

        {actions.map((action) => (
          <Tooltip key={`${action.from}:${action.payload.id}`} title={`Contributed by ${action.from}`}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => void runAction(action)}
              startIcon={action.payload.glyph ? <Glyph id={action.payload.glyph} size={12} /> : undefined}
              sx={{ fontSize: 11.5, py: 0.2 }}
            >
              {action.payload.label}
            </Button>
          </Tooltip>
        ))}

        {streaming ? (
          <Tooltip title="Kill the CLI process. Everything already streamed is persisted.">
            <Button size="small" variant="outlined" color="warning" onClick={onStop} sx={{ fontSize: 11.5, py: 0.2 }}>
              Stop
            </Button>
          </Tooltip>
        ) : (
          <Button
            size="small"
            variant="contained"
            disabled={disabled || busy || !draft.trim()}
            onClick={() => void send()}
            sx={{ fontSize: 11.5, py: 0.2 }}
          >
            {busy ? "Sending…" : "Send"}
          </Button>
        )}
      </Box>
    </Box>
  );
}

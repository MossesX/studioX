"use client";

/**
 * @file The live browser viewer — a remote desktop onto a server-side page.
 *
 * The pane renders the session's JPEG frame stream and (when `interactive`)
 * forwards gestures back as `BrowserAction`s: clicks land at page
 * coordinates scaled from the displayed image, wheel deltas accumulate into
 * scroll actions, and keystrokes buffer into `type` actions (specials go as
 * `press`). Because every gesture crosses the same `act()` seam server-side,
 * whatever you do here is recordable — the Recorder tab is this pane plus a
 * log.
 *
 * The stream is one GET per mounted pane; unmount aborts it, and the server
 * stops screenshotting when the last viewer leaves.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { sendAction, streamSession } from "./browserClient";
import type { BrowserAction, BrowserEvent } from "./types";

const SPECIAL_KEYS = new Set([
  "Enter",
  "Backspace",
  "Delete",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown"
]);

export interface BrowserPaneProps {
  readonly sessionId: string;
  /** Forward pointer/keyboard gestures to the page. */
  readonly interactive: boolean;
  /** URL bar + back/forward/reload controls. */
  readonly chrome: boolean;
  /** Every stream event, after the pane consumed it — the recorder's log tap. */
  readonly onEvent?: (event: BrowserEvent) => void;
}

export default function BrowserPane({ sessionId, interactive, chrome, onEvent }: BrowserPaneProps) {
  const [frame, setFrame] = React.useState<string | null>(null);
  const [frameSize, setFrameSize] = React.useState({ w: 1280, h: 800 });
  const [url, setUrl] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [urlDraft, setUrlDraft] = React.useState("");
  const [connected, setConnected] = React.useState(false);
  const [recording, setRecording] = React.useState(false);
  const urlEditing = React.useRef(false);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const typeBuffer = React.useRef("");
  const typeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheel = React.useRef({ dx: 0, dy: 0, timer: null as ReturnType<typeof setTimeout> | null });
  const onEventRef = React.useRef(onEvent);
  onEventRef.current = onEvent;

  React.useEffect(() => {
    const controller = new AbortController();
    setConnected(false);
    void streamSession(sessionId, controller.signal, (event) => {
      switch (event.type) {
        case "hello":
          setConnected(true);
          setUrl(event.url);
          setRecording(event.recording);
          if (!urlEditing.current) setUrlDraft(event.url === "about:blank" ? "" : event.url);
          break;
        case "frame":
          setFrame(event.data);
          setFrameSize({ w: event.w, h: event.h });
          setUrl(event.url);
          setTitle(event.title);
          if (!urlEditing.current) setUrlDraft(event.url === "about:blank" ? "" : event.url);
          break;
        case "nav":
          setUrl(event.url);
          setTitle(event.title);
          if (!urlEditing.current) setUrlDraft(event.url === "about:blank" ? "" : event.url);
          break;
        case "recording":
          setRecording(event.on);
          break;
        case "closed":
          setConnected(false);
          break;
        default:
          break;
      }
      onEventRef.current?.(event);
    }).catch(() => setConnected(false));
    return () => controller.abort();
  }, [sessionId]);

  /* ── gesture forwarding ────────────────────────────────────────────── */

  const pageCoords = (e: React.MouseEvent): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img) return null;
    const rect = img.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * frameSize.w;
    const y = ((e.clientY - rect.top) / rect.height) * frameSize.h;
    if (x < 0 || y < 0 || x > frameSize.w || y > frameSize.h) return null;
    return { x: Math.round(x), y: Math.round(y) };
  };

  const flushType = () => {
    if (typeTimer.current) clearTimeout(typeTimer.current);
    typeTimer.current = null;
    if (typeBuffer.current) {
      sendAction(sessionId, { kind: "type", text: typeBuffer.current });
      typeBuffer.current = "";
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!interactive) return;
    if (e.ctrlKey || e.metaKey || e.altKey) {
      const printable = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      flushType();
      sendAction(sessionId, {
        kind: "press",
        key: `${e.ctrlKey ? "Control+" : ""}${e.metaKey ? "Meta+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${printable}`
      });
      e.preventDefault();
      return;
    }
    if (e.key.length === 1) {
      typeBuffer.current += e.key;
      if (typeTimer.current) clearTimeout(typeTimer.current);
      typeTimer.current = setTimeout(flushType, 350);
      e.preventDefault();
      return;
    }
    if (SPECIAL_KEYS.has(e.key)) {
      flushType();
      sendAction(sessionId, { kind: "press", key: e.key });
      e.preventDefault();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!interactive) return;
    wheel.current.dx += e.deltaX;
    wheel.current.dy += e.deltaY;
    if (!wheel.current.timer) {
      wheel.current.timer = setTimeout(() => {
        const { dx, dy } = wheel.current;
        wheel.current = { dx: 0, dy: 0, timer: null };
        sendAction(sessionId, { kind: "scroll", dx: Math.round(dx), dy: Math.round(dy) });
      }, 140);
    }
  };

  const go = (target?: string) => {
    const raw = (target ?? urlDraft).trim();
    if (!raw) return;
    urlEditing.current = false;
    sendAction(sessionId, { kind: "goto", url: raw });
  };

  const send = (action: BrowserAction) => sendAction(sessionId, action);

  /* ── render ────────────────────────────────────────────────────────── */

  return (
    <Stack sx={{ minHeight: 0, height: "100%" }}>
      {chrome && (
        <Stack direction="row" sx={{ gap: 0.5, alignItems: "center", px: 1, py: 0.5, borderBottom: `1px solid ${token("edge")}` }}>
          <Tooltip title="Back">
            <IconButton size="small" sx={{ fontSize: 14, width: 26, height: 26 }} onClick={() => send({ kind: "back" })}>
              ←
            </IconButton>
          </Tooltip>
          <Tooltip title="Forward">
            <IconButton size="small" sx={{ fontSize: 14, width: 26, height: 26 }} onClick={() => send({ kind: "forward" })}>
              →
            </IconButton>
          </Tooltip>
          <Tooltip title="Reload">
            <IconButton size="small" sx={{ fontSize: 14, width: 26, height: 26 }} onClick={() => send({ kind: "reload" })}>
              ↻
            </IconButton>
          </Tooltip>
          <TextField
            size="small"
            fullWidth
            placeholder="https://…"
            value={urlDraft}
            onFocus={() => {
              urlEditing.current = true;
            }}
            onBlur={() => {
              urlEditing.current = false;
            }}
            onChange={(e) => setUrlDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") go();
              e.stopPropagation();
            }}
            sx={{ "& .MuiInputBase-input": { fontSize: 12, py: 0.5 } }}
          />
          <Button size="small" variant="outlined" sx={{ fontSize: 11, minWidth: 44 }} onClick={() => go()}>
            Go
          </Button>
          {recording && <Chip size="small" color="error" label="● REC" sx={{ fontSize: 10.5, fontWeight: 700 }} />}
        </Stack>
      )}
      <Box
        tabIndex={interactive ? 0 : -1}
        onKeyDown={onKeyDown}
        onWheel={onWheel}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "#101010",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          outline: "none",
          "&:focus-visible": { boxShadow: `inset 0 0 0 2px ${token("accent")}` }
        }}
      >
        {frame ? (
          /* eslint-disable-next-line @next/next/no-img-element -- streamed data URI frames, not an asset */
          <img
            ref={imgRef}
            src={`data:image/jpeg;base64,${frame}`}
            alt={title || "live browser"}
            draggable={false}
            onClick={(e) => {
              if (!interactive) return;
              const at = pageCoords(e);
              if (at) {
                flushType();
                sendAction(sessionId, { kind: "click", x: at.x, y: at.y });
                (e.currentTarget.parentElement as HTMLElement | null)?.focus();
              }
            }}
            style={{
              width: "100%",
              height: "auto",
              maxWidth: frameSize.w,
              cursor: interactive ? "crosshair" : "default",
              userSelect: "none",
              display: "block"
            }}
          />
        ) : (
          <Typography sx={{ fontSize: 12.5, color: token("dim"), py: 6 }}>
            {connected ? "Waiting for the first frame…" : "Connecting to the live browser…"}
          </Typography>
        )}
      </Box>
      <Stack direction="row" sx={{ gap: 1, alignItems: "center", px: 1, py: 0.25, borderTop: `1px solid ${token("edge")}` }}>
        <Box
          sx={{
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: connected ? token("ok") : token("err"),
            flexShrink: 0
          }}
        />
        <Typography noWrap sx={{ fontSize: 10.5, color: token("dim"), flex: 1 }}>
          {url === "about:blank" || !url ? "blank page" : url}
        </Typography>
        {title && (
          <Typography noWrap sx={{ fontSize: 10.5, color: token("dim"), maxWidth: "40%" }}>
            {title}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

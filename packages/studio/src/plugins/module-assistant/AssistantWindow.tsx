/**
 * @file The floating chat window — the GizmoX dialog, rebuilt on this
 * framework's tokens.
 *
 * The shape is a deliberate replica of GizmoX's floating AI dialog
 * (`FloatWindow.tsx` + Logo Studio's `AiPanel.tsx`), because the owner asked
 * for "exactly like the dialog in gizmox" and those two files are the
 * reference: a `position: fixed` Paper portalled to `document.body` (a fixed
 * element still paints inside its nearest stacking context — the portal is
 * what stops the shell chrome covering the close button), a header that IS
 * the drag handle with the agent and model as chips, a transcript of tinted
 * bubbles (user accent-tinted from the left, assistant dim from the right,
 * system in the error tint), a composer with Enter-to-send, minimize to a
 * pill, and edge/corner resize with a viewport clamp so the window can never
 * be dragged somewhere it cannot be dragged back from.
 *
 * Geometry persists in localStorage (where you put the window is a
 * preference); everything conversational persists in the store's
 * sessionStorage — see `store.ts` for why the split.
 */
"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, registry, token } from "@axf/core";

import AssistantSettings from "./AssistantSettings";
import { assistant } from "./store";
import type { ChatMessage, LogoPrefs, LogoTone } from "./store";

const GEO_KEY = "axs:assistant-window@1";
const MIN_W = 320;
const MIN_H = 300;
const KEEP_VISIBLE = 80;

interface Geo {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clampGeo(g: Geo): Geo {
  if (typeof window === "undefined") return g;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return {
    w: Math.min(Math.max(g.w, MIN_W), vw),
    h: Math.min(Math.max(g.h, MIN_H), vh),
    x: Math.min(Math.max(g.x, KEEP_VISIBLE - g.w), vw - KEEP_VISIBLE),
    y: Math.min(Math.max(g.y, 0), vh - KEEP_VISIBLE)
  };
}

function defaultGeo(): Geo {
  const w = 420;
  const h = Math.min(640, typeof window === "undefined" ? 640 : window.innerHeight - 96);
  return clampGeo({
    w,
    h,
    x: typeof window === "undefined" ? 0 : window.innerWidth - w - 32,
    y: 72
  });
}

/** Tone role → the theme variable it publishes. The drawing itself paints in
 *  the pack's `--gxb-*` identity roles, so the tone is applied by re-pointing
 *  those at ONE theme role on the watermark's own container — a local
 *  custom-property override. No hex anywhere; a theme roll re-tints it live. */
const TONE_VARS: Record<LogoTone, string> = {
  accent: "var(--axf-accent)",
  accent2: "var(--axf-accent2)",
  accent3: "var(--axf-accent3)",
  ink: "var(--axf-ink)",
  dim: "var(--axf-dim)"
};

/**
 * The always-present watermark behind the transcript.
 *
 * The pack's animated drawings are SMIL (`<animate>` / `<animateTransform>`),
 * which CSS `animation-play-state` cannot reach — SMIL runs on the SVG's own
 * document timeline. So play-state is driven on the `<svg>` element itself:
 * `unpauseAnimations()` while a reply streams, `pauseAnimations()` +
 * `setCurrentTime(0)` at rest, so stopping returns the drawing to its rest
 * pose rather than freezing mid-motion. `dur` has no CSS counterpart either,
 * so the speed multiplier rewrites each `dur` from a base kept on the element.
 */
function Watermark({ streaming, logo }: { streaming: boolean; logo: LogoPrefs }) {
  const boxRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const svg = boxRef.current?.querySelector("svg");
    if (!svg) return;
    for (const el of Array.from(
      svg.querySelectorAll<SVGElement>("animate, animateTransform, animateMotion")
    )) {
      const base = el.dataset.axsBaseDur ?? el.getAttribute("dur");
      if (!base) continue;
      el.dataset.axsBaseDur = base;
      const secs = parseFloat(base);
      if (Number.isFinite(secs) && secs > 0) el.setAttribute("dur", `${secs / logo.speed}s`);
    }
  }, [logo.asset, logo.speed]);

  React.useEffect(() => {
    const svg = boxRef.current?.querySelector("svg");
    if (!svg || typeof svg.pauseAnimations !== "function") return;
    if (streaming) {
      svg.unpauseAnimations();
    } else {
      svg.pauseAnimations();
      svg.setCurrentTime(0);
    }
  }, [streaming, logo.asset]);

  const tone = TONE_VARS[logo.tone];
  return (
    <Box
      ref={boxRef}
      aria-hidden
      data-axs-assistant-watermark
      data-axs-assistant-watermark-streaming={streaming ? "" : undefined}
      sx={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        background: "transparent"
      }}
      style={
        {
          opacity: logo.opacity,
          "--gxb-accent": tone,
          "--gxb-ink": tone,
          "--axf-brand-accent": tone,
          "--axf-brand-ink": tone
        } as React.CSSProperties
      }
    >
      <Glyph id={logo.asset} size="min(58%, 220px)" title="" />
    </Box>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const mine = m.role === "user";
  const system = m.role === "system";
  return (
    <Box
      sx={{
        mb: 0.9,
        ml: mine ? 3 : 0,
        mr: mine ? 0 : 3,
        p: 0.9,
        borderRadius: "8px",
        fontSize: 12.5,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        bgcolor: mine
          ? `color-mix(in srgb, ${token("accent")} 11%, transparent)`
          : system
            ? `color-mix(in srgb, ${token("err")} 8%, transparent)`
            : `color-mix(in srgb, ${token("dim")} 7%, transparent)`,
        border: `1px solid ${
          mine ? `color-mix(in srgb, ${token("accent")} 30%, transparent)` : token("edge")
        }`,
        color: system ? token("err") : token("ink")
      }}
    >
      {m.text}
      {m.role === "assistant" && m.model && (
        <Typography sx={{ mt: 0.4, fontSize: 9.5, fontFamily: token("mono"), color: token("dim") }}>
          {m.provider} · {m.model}
        </Typography>
      )}
    </Box>
  );
}

export default function AssistantWindow() {
  const state = React.useSyncExternalStore(
    assistant.subscribe,
    assistant.getState,
    assistant.getServerState
  );
  const [geo, setGeo] = React.useState<Geo | null>(null);
  const [input, setInput] = React.useState("");
  const [agentMenu, setAgentMenu] = React.useState<HTMLElement | null>(null);
  const transcriptRef = React.useRef<HTMLDivElement | null>(null);
  const geoRef = React.useRef<Geo | null>(null);
  geoRef.current = geo;

  // Geometry resolves in an effect, never during render — SSR-safe, and the
  // stored rect is clamped so an old rect from a larger monitor stays usable.
  React.useEffect(() => {
    let stored: Geo | null = null;
    try {
      const raw = window.localStorage.getItem(GEO_KEY);
      if (raw) stored = JSON.parse(raw) as Geo;
    } catch {
      /* fresh geometry */
    }
    setGeo(clampGeo(stored ?? defaultGeo()));
  }, []);

  React.useEffect(() => {
    if (state.open) {
      assistant.syncModule();
      void assistant.loadConfig();
      void assistant.loadAgents();
    }
  }, [state.open]);

  const transcript = assistant.transcript(state.moduleId);

  // Pin the transcript to the latest line while streaming.
  React.useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript.messages.length, transcript.draft]);

  const persistGeo = (g: Geo) => {
    try {
      window.localStorage.setItem(GEO_KEY, JSON.stringify(g));
    } catch {
      /* quota */
    }
  };

  /** Pointer-based drag/resize — header is the handle, buttons excluded. */
  const startGesture =
    (mode: "move" | "e" | "s" | "se") => (e: React.PointerEvent) => {
      if (mode === "move" && (e.target as HTMLElement).closest("button")) return;
      const start = geoRef.current;
      if (!start) return;
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        const next =
          mode === "move"
            ? { ...start, x: start.x + dx, y: start.y + dy }
            : {
                ...start,
                w: mode !== "s" ? start.w + dx : start.w,
                h: mode !== "e" ? start.h + dy : start.h
              };
        setGeo(clampGeo(next));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const final = geoRef.current;
        if (final) persistGeo(final);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };

  const sendNow = () => {
    const text = input;
    setInput("");
    void assistant.send(state.moduleId, text);
  };

  if (!state.open || !geo || typeof document === "undefined") return null;

  const mod = registry.module(state.moduleId);
  const moduleTitle = mod?.title ?? "the shell";
  // The agent for THIS module — its pin if it has one, the default otherwise.
  // Resolved through the store, which resolves through the same function the
  // chat route does, so the chip cannot name an agent that is not answering.
  const agentId = assistant.agentIdFor(state.moduleId);
  const nameOf = (id: string) => state.agents?.find((a) => a.id === id)?.name ?? id;
  const agentName = state.config ? nameOf(agentId) : "Amber";
  const pinned = assistant.isAgentPinned(state.moduleId);
  const defaultAgentName = state.config ? nameOf(state.config.agentId) : "Amber";

  /* ── minimized: a pill in the corner, like GizmoX's MinimizedDock ─────── */
  if (state.minimized) {
    return createPortal(
      <Paper
        elevation={8}
        onClick={() => assistant.minimize(false)}
        sx={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 1300,
          px: 1.2,
          py: 0.5,
          display: "flex",
          alignItems: "center",
          gap: 0.8,
          cursor: "pointer",
          borderRadius: 999,
          border: `1px solid color-mix(in srgb, ${token("accent")} 35%, transparent)`,
          bgcolor: token("panel")
        }}
        data-axf-assistant-pill
      >
        <Glyph id="icon-chat" size={14} />
        <Typography sx={{ fontSize: 11.5, fontWeight: 700 }}>Assistant</Typography>
        {transcript.streaming && <CircularProgress size={11} />}
      </Paper>,
      document.body
    );
  }

  return createPortal(
    <Paper
      elevation={14}
      data-axf-assistant-window
      sx={{
        position: "fixed",
        left: geo.x,
        top: geo.y,
        width: geo.w,
        height: geo.h,
        zIndex: 1300,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        border: `1px solid color-mix(in srgb, ${token("accent")} 28%, transparent)`,
        borderRadius: "10px",
        boxShadow: "0 22px 60px rgba(0,0,0,0.62)",
        bgcolor: token("panel")
      }}
    >
      {/* ── title bar: the drag handle ─────────────────────────────────── */}
      <Box
        onPointerDown={startGesture("move")}
        sx={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 0.6,
          px: 1,
          py: 0.5,
          cursor: "grab",
          userSelect: "none",
          touchAction: "none",
          bgcolor: `color-mix(in srgb, ${token("accent")} 9%, transparent)`,
          borderBottom: `1px solid ${token("edge")}`,
          "&:active": { cursor: "grabbing" }
        }}
      >
        <Glyph id="icon-chat" size={15} />
        <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>Assistant</Typography>
        <Tooltip
          title={
            pinned
              ? `${agentName} is pinned to ${moduleTitle} — click to change it for this module only`
              : `Following the default agent (${defaultAgentName}) — click to pin one to ${moduleTitle}`
          }
        >
          <Chip
            // The dot marks a module with an agent of its OWN. Without it the
            // chip reads the same whether this module was chosen deliberately
            // or is just following the default, and those behave differently
            // the moment the default changes.
            label={pinned ? `${agentName} •` : agentName}
            size="small"
            onClick={(e) => setAgentMenu(e.currentTarget)}
            data-axs-assistant-agent={agentId}
            data-axs-assistant-agent-pinned={pinned ? "" : undefined}
            sx={{
              height: 18,
              fontSize: 10,
              fontWeight: 700,
              color: token("accent"),
              bgcolor: `color-mix(in srgb, ${token("accent")} 12%, transparent)`,
              border: `1px solid color-mix(in srgb, ${token("accent")} ${pinned ? 70 : 45}%, transparent)`
            }}
          />
        </Tooltip>
        <Tooltip title="Provider · model — click for settings">
          <Chip
            label={`${state.config?.provider ?? "…"} · ${state.config?.model ?? ""}`}
            size="small"
            onClick={() => assistant.setView(state.view === "settings" ? "chat" : "settings")}
            sx={{
              height: 18,
              fontSize: 10,
              fontFamily: token("mono"),
              color: token("dim"),
              bgcolor: "transparent",
              border: `1px solid ${token("edge")}`
            }}
          />
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        {transcript.streaming && (
          <Tooltip title="Stop the response — keeps what has streamed so far">
            <IconButton
              size="small"
              sx={{ p: 0.4, color: token("err") }}
              onClick={() => assistant.stop()}
              aria-label="Stop the response"
              data-axs-assistant-stop
            >
              <Typography component="span" sx={{ fontSize: 12, lineHeight: 1 }}>
                ■
              </Typography>
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="Clear this module's conversation">
          <IconButton
            size="small"
            sx={{ p: 0.4, color: token("dim") }}
            onClick={() => assistant.clearTranscript(state.moduleId)}
            aria-label="Clear conversation"
          >
            <Glyph id="icon-trash" size={13} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Settings">
          <IconButton
            size="small"
            sx={{ p: 0.4, color: state.view === "settings" ? token("accent") : token("dim") }}
            onClick={() => assistant.setView(state.view === "settings" ? "chat" : "settings")}
            aria-label="Assistant settings"
          >
            <Glyph id="icon-gear" size={13} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Minimize">
          <IconButton
            size="small"
            sx={{ p: 0.4, color: token("dim") }}
            onClick={() => assistant.minimize(true)}
            aria-label="Minimize assistant"
          >
            <Typography component="span" sx={{ fontSize: 13, lineHeight: 1 }}>
              –
            </Typography>
          </IconButton>
        </Tooltip>
        <Tooltip title="Close">
          <IconButton
            size="small"
            sx={{ p: 0.4, color: token("dim"), "&:hover": { color: token("err") } }}
            onClick={() => assistant.close()}
            aria-label="Close assistant"
          >
            <Typography component="span" sx={{ fontSize: 13, lineHeight: 1 }}>
              ×
            </Typography>
          </IconButton>
        </Tooltip>
      </Box>

      {/* Agent menu — the header chip's dropdown. Selecting SAVES, and it saves
          FOR THIS MODULE: the pin goes into `moduleAgents[moduleId]` in the
          stored config, so every module keeps its own agent and keeps it across
          reloads and across tabs. The first row is the way back out — a pin set
          to the default agent still stops following the default, so "unpin" has
          to be its own act rather than "pick the default again". */}
      <Menu anchorEl={agentMenu} open={Boolean(agentMenu)} onClose={() => setAgentMenu(null)}>
        <Typography
          sx={{ px: 2, py: 0.5, fontSize: 10, letterSpacing: "0.08em", color: token("dim") }}
        >
          AGENT FOR {moduleTitle.toUpperCase()}
        </Typography>
        <MenuItem
          selected={!pinned}
          onClick={() => {
            setAgentMenu(null);
            void assistant.setModuleAgent(state.moduleId, null);
          }}
        >
          <Box>
            <Typography sx={{ fontSize: 12.5 }}>Use the default ({defaultAgentName})</Typography>
            <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
              Follow whatever the settings tab&apos;s default agent is, now and later.
            </Typography>
          </Box>
        </MenuItem>
        <Divider />
        {(state.agents ?? []).map((a) => (
          <MenuItem
            key={a.id}
            selected={pinned && a.id === agentId}
            onClick={() => {
              setAgentMenu(null);
              void assistant.setModuleAgent(state.moduleId, a.id);
            }}
          >
            <Box>
              <Typography sx={{ fontSize: 12.5 }}>{a.name}</Typography>
              <Typography sx={{ fontSize: 10.5, color: token("dim") }}>
                {a.description || a.source}
              </Typography>
            </Box>
          </MenuItem>
        ))}
        {!state.agents?.length && <MenuItem disabled>Reading the agent roster…</MenuItem>}
      </Menu>

      {state.view === "settings" ? (
        <AssistantSettings state={state} />
      ) : (
        <>
          {/* Context strip: which module this conversation is about. */}
          <Box
            sx={{
              px: 1,
              py: 0.4,
              borderBottom: `1px solid ${token("edge")}`,
              display: "flex",
              alignItems: "center",
              gap: 0.6
            }}
          >
            <Typography sx={{ fontSize: 10.5, color: token("dim") }}>assisting</Typography>
            <Typography sx={{ fontSize: 10.5, fontWeight: 700, color: token("accent") }}>
              {moduleTitle}
            </Typography>
            {mod && (
              <Typography sx={{ fontSize: 10.5, fontFamily: token("mono"), color: token("dim") }}>
                {mod.route}
              </Typography>
            )}
          </Box>

          {/* ── transcript, over the always-present watermark ──────────── */}
          <Box
            sx={{
              position: "relative",
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column"
            }}
          >
            <Watermark streaming={transcript.streaming} logo={state.logo} />
            {/* `position: relative` so the transcript paints ABOVE the
                absolute watermark by DOM order — its own background stays
                transparent, so the drawing shows through between bubbles. */}
            <Box
              ref={transcriptRef}
              sx={{ position: "relative", flex: 1, minHeight: 0, overflow: "auto", px: 1, py: 0.8 }}
            >
            {transcript.messages.length === 0 && !transcript.draft && (
              <Typography sx={{ fontSize: 11.5, color: token("dim"), textAlign: "center", mt: 3 }}>
                Ask {agentName} about {moduleTitle} — what a control does, where a setting lives,
                how the pieces fit.
              </Typography>
            )}
            {transcript.messages.map((m) => (
              <Bubble key={m.id} m={m} />
            ))}
            {transcript.streaming && (
              <Box
                sx={{
                  mb: 0.9,
                  mr: 3,
                  p: 0.9,
                  borderRadius: "8px",
                  fontSize: 12.5,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  bgcolor: `color-mix(in srgb, ${token("dim")} 7%, transparent)`,
                  border: `1px solid ${token("edge")}`
                }}
              >
                {transcript.draft || <CircularProgress size={12} />}
              </Box>
            )}
            </Box>
          </Box>

          {/* ── composer ───────────────────────────────────────────────── */}
          <Box sx={{ p: 0.8, borderTop: `1px solid ${token("edge")}` }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "flex-end",
                gap: 0.5,
                px: 0.9,
                py: 0.4,
                borderRadius: "8px",
                border: `1px solid ${token("edge")}`,
                bgcolor: token("page"),
                "&:focus-within": { borderColor: token("accent") }
              }}
            >
              <InputBase
                multiline
                maxRows={6}
                fullWidth
                placeholder={`Message ${agentName}…`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!transcript.streaming) sendNow();
                  }
                }}
                sx={{ fontSize: 12.5, py: 0.3 }}
                inputProps={{ "aria-label": "Message the assistant" }}
              />
              {transcript.streaming ? (
                <IconButton
                  size="small"
                  onClick={() => assistant.stop()}
                  aria-label="Stop the response"
                  sx={{ color: token("err") }}
                >
                  <Typography component="span" sx={{ fontSize: 14, lineHeight: 1 }}>
                    ■
                  </Typography>
                </IconButton>
              ) : (
                <IconButton
                  size="small"
                  onClick={sendNow}
                  disabled={!input.trim()}
                  aria-label="Send"
                  sx={{ color: token("accent") }}
                >
                  <Glyph id="icon-play" size={14} />
                </IconButton>
              )}
            </Box>
          </Box>
        </>
      )}

      {/* ── resize strips: E, S edges + SE corner with a chevron ─────────── */}
      <Box
        onPointerDown={startGesture("e")}
        sx={{ position: "absolute", top: 10, right: 0, bottom: 16, width: 6, cursor: "ew-resize" }}
      />
      <Box
        onPointerDown={startGesture("s")}
        sx={{ position: "absolute", left: 10, right: 16, bottom: 0, height: 6, cursor: "ns-resize" }}
      />
      <Box
        onPointerDown={startGesture("se")}
        sx={{
          position: "absolute",
          right: 0,
          bottom: 0,
          width: 16,
          height: 16,
          cursor: "nwse-resize",
          "&::after": {
            content: '""',
            position: "absolute",
            right: 3,
            bottom: 3,
            width: 8,
            height: 8,
            borderRight: "2px solid rgba(255,255,255,0.3)",
            borderBottom: "2px solid rgba(255,255,255,0.3)"
          }
        }}
      />
    </Paper>,
    document.body
  );
}

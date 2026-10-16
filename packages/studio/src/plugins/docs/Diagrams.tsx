/**
 * @file The chain diagrams — inline SVG, painted entirely in theme variables.
 *
 * Deliberately NOT drawings in a brand pack, and the distinction is worth
 * stating because `no-hand-rolled-ui.md` would otherwise look violated. A pack
 * entry is a piece of IDENTITY — a mark, a lockup, an icon — swapped when the
 * brand swaps. These are CONTENT: a sentence about the theme chain, drawn
 * instead of written. Putting a diagram of `resolve.ts` into the branding pack
 * would mean every future brand had to redraw it, which is exactly backwards.
 *
 * They are still theme-driven. Every stroke and fill resolves against
 * `--axf-*`, so a roll recolours them along with everything else, and neither
 * light nor dark is assumed anywhere.
 *
 * The one rule these follow, from `artifact-diagramming`'s framing: a diagram
 * earns its place by showing the MECHANISM — what is handed to what, and what
 * gets picked up on the way. A box-and-arrow picture that only repeats the
 * section heading is worse than the heading, because it costs a scroll.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";

/* ─────────────────────────────────────────────────────────── primitives ─── */

const INK = "var(--axf-ink, #f4efe7)";
const DIM = "var(--axf-dim, #a89b8a)";
const EDGE = "var(--axf-edge, #453521)";
const ACCENT = "var(--axf-accent, #f0982e)";
const ACCENT2 = "var(--axf-accent2, #6faeea)";
const ACCENT3 = "var(--axf-accent3, #ffa02e)";
const PANEL = "var(--axf-panel, #1e1914)";
const PANEL2 = "var(--axf-panel2, #2a231b)";
const ERR = "var(--axf-err, #e8739a)";
const OK = "var(--axf-ok, #7fd4a0)";

const MONO = "var(--axf-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";
const SANS = "var(--axf-font-sans, system-ui, sans-serif)";

function Node({
  x,
  y,
  w = 168,
  h = 46,
  title,
  sub,
  tone = "plain"
}: {
  x: number;
  y: number;
  w?: number;
  h?: number;
  title: string;
  sub?: string;
  tone?: "plain" | "accent" | "accent2" | "accent3" | "danger" | "ok";
}) {
  const stroke =
    tone === "accent"
      ? ACCENT
      : tone === "accent2"
        ? ACCENT2
        : tone === "accent3"
          ? ACCENT3
          : tone === "danger"
            ? ERR
            : tone === "ok"
              ? OK
              : EDGE;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill={tone === "plain" ? PANEL : PANEL2}
        stroke={stroke}
        strokeWidth={tone === "plain" ? 1 : 1.5}
      />
      <text
        x={x + w / 2}
        y={sub ? y + h / 2 - 3 : y + h / 2 + 4}
        textAnchor="middle"
        fill={INK}
        fontSize={12}
        fontFamily={SANS}
        fontWeight={600}
      >
        {title}
      </text>
      {sub ? (
        <text
          x={x + w / 2}
          y={y + h / 2 + 13}
          textAnchor="middle"
          fill={DIM}
          fontSize={10}
          fontFamily={MONO}
        >
          {sub}
        </text>
      ) : null}
    </g>
  );
}

/** An arrow with an optional label naming what travels along it. */
function Arrow({
  from,
  to,
  label,
  dashed = false,
  tone = "plain",
  labelDy = -6
}: {
  from: [number, number];
  to: [number, number];
  label?: string;
  dashed?: boolean;
  tone?: "plain" | "accent" | "accent2" | "danger";
  labelDy?: number;
}) {
  const colour =
    tone === "accent" ? ACCENT : tone === "accent2" ? ACCENT2 : tone === "danger" ? ERR : DIM;
  const [x1, y1] = from;
  const [x2, y2] = to;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={colour}
        strokeWidth={1.4}
        strokeDasharray={dashed ? "4 4" : undefined}
        markerEnd="url(#axf-doc-arrow)"
      />
      {label ? (
        <text
          x={mx}
          y={my + labelDy}
          textAnchor="middle"
          fill={colour}
          fontSize={9.5}
          fontFamily={MONO}
        >
          {label}
        </text>
      ) : null}
    </g>
  );
}

/** A note tethered to a step — where the DYNAMIC data enters the chain. */
function Pickup({ x, y, text, w = 200 }: { x: number; y: number; text: string; w?: number }) {
  const lines = text.split("\n");
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={14 + lines.length * 12}
        rx={4}
        fill="transparent"
        stroke={ACCENT3}
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.75}
      />
      {lines.map((l, i) => (
        <text
          key={i}
          x={x + 7}
          y={y + 16 + i * 12}
          fill={ACCENT3}
          fontSize={9.5}
          fontFamily={MONO}
          opacity={0.95}
        >
          {l}
        </text>
      ))}
    </g>
  );
}

function Frame({
  viewBox,
  height,
  children,
  label
}: {
  viewBox: string;
  height: number;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <Box sx={{ overflowX: "auto", width: "100%", py: 1 }}>
      <Box
        component="svg"
        viewBox={viewBox}
        role="img"
        aria-label={label}
        sx={{ display: "block", minWidth: 720, width: "100%", height }}
      >
        <defs>
          <marker
            id="axf-doc-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={DIM} />
          </marker>
        </defs>
        {children}
      </Box>
    </Box>
  );
}

function Legend() {
  return (
    <Box
      sx={{
        display: "flex",
        gap: 2,
        flexWrap: "wrap",
        alignItems: "center",
        fontSize: 11,
        color: "text.secondary",
        px: 1,
        pb: 1
      }}
    >
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
        <Box
          component="span"
          sx={{ width: 18, height: 0, borderTop: "1.5px dashed", borderColor: "warning.main" }}
        />
        dynamic data picked up here
      </Box>
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
        <Box
          component="span"
          sx={{ width: 18, height: 0, borderTop: "1.5px dashed", borderColor: "text.disabled" }}
        />
        a different runtime / process
      </Box>
    </Box>
  );
}

/* ─────────────────────────────────────────────── 1 · the drawing chain ─── */

export function GlyphChainDiagram() {
  return (
    <>
      <Legend />
      <Frame viewBox="0 0 980 300" height={300} label="How a drawing reaches the screen">
        <Node x={8} y={20} w={150} title="<Glyph id=… />" sub="any surface" tone="accent" />
        <Arrow from={[158, 43]} to={[204, 43]} />
        <Node x={206} y={20} w={168} title="useResolvedStyle()" sub="useSyncExternalStore" />
        <Arrow from={[374, 43]} to={[420, 43]} />
        <Node x={422} y={20} w={168} title="PackRegistry.resolved()" sub="branding ∪ logo" />
        <Arrow from={[590, 43]} to={[636, 43]} label="entry" />
        <Node x={638} y={20} w={168} title="entry.svg" sub="inline markup" />
        <Arrow from={[806, 43]} to={[852, 43]} />
        <Node x={854} y={20} w={118} title="the DOM" sub="innerHTML" tone="accent2" />

        <Pickup
          x={206}
          y={82}
          w={384}
          text={
            "axf:packs@1  (localStorage — the user's selection)\n" +
            "axf_packs    (cookie — so the SERVER can render it)\n" +
            "<PacksSeed>  (a prop — the client module graph)"
          }
        />
        <Arrow from={[290, 66]} to={[290, 82]} tone="accent" />
        <Pickup
          x={638}
          y={82}
          w={334}
          text={
            "width/height stripped (they beat any container)\n" +
            "100%/100% + preserveAspectRatio\n" +
            "height derived from the viewBox aspect"
          }
        />
        <Arrow from={[722, 66]} to={[722, 82]} tone="accent" />

        <Node x={854} y={168} w={118} h={54} title="painted" sub="var(--gxb-*)" tone="ok" />
        <Arrow from={[913, 66]} to={[913, 168]} label="fill / stroke" tone="accent" labelDy={-4} />

        <Node x={422} y={182} w={280} h={40} title="resolveVariables(theme, pack)" sub="theme/resolve.ts — the ONE resolver" tone="accent" />
        <Arrow from={[702, 202]} to={[852, 197]} label="ten role values ×2 families" tone="accent" />

        <text x={8} y={196} fill={DIM} fontSize={10.5} fontFamily={MONO}>
          identity roles ← the pack
        </text>
        <text x={8} y={212} fill={DIM} fontSize={10.5} fontFamily={MONO}>
          surface roles ← the THEME
        </text>
        <Arrow from={[196, 202]} to={[418, 202]} dashed />

        <text x={8} y={268} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          Everything above the line happens per render. The colours below it change with ONE style write —
        </text>
        <text x={8} y={284} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          no component re-renders to recolour, which is what makes a pack swap repaint hundreds of SVGs at once.
        </text>
      </Frame>
    </>
  );
}

/* ────────────────────────────────────────────────── 2 · the theme chain ─── */

export function ThemeChainDiagram() {
  return (
    <>
      <Legend />
      <Frame viewBox="0 0 980 420" height={420} label="How a theme reaches the screen">
        <Node x={8} y={16} w={132} title="seed" sub="6 characters" tone="accent" />
        <Arrow from={[140, 39]} to={[186, 39]} />
        <Node x={188} y={16} w={168} title="rollTheme()" sub="mulberry32 · clamped" />
        <Arrow from={[356, 39]} to={[402, 39]} label="48 dials" />
        <Node x={404} y={16} w={168} title="ThemeStore" sub="preview | applied" tone="accent" />
        <Arrow from={[572, 39]} to={[618, 39]} />
        <Node x={620} y={16} w={200} title="resolveVariables()" sub="the ONE resolver" tone="accent" />

        <Pickup
          x={404}
          y={78}
          w={196}
          text={"axf:theme@1  seed+options\n+ hand overrides\naxf_theme    cookie"}
        />
        <Arrow from={[488, 62]} to={[488, 78]} tone="accent" />

        <Node x={620} y={96} w={200} h={40} title="themeVariables()" sub="every dial via its cssVar" />
        <Node x={620} y={142} w={200} h={40} title="derivedVariables()" sub="type scale · shadow · pad" />
        <Node x={620} y={188} w={200} h={40} title="the brand bridge" sub="--axf-brand-* + --gxb-*" tone="accent3" />
        <Arrow from={[720, 62]} to={[720, 96]} />

        {/* CSS branch */}
        <Node x={330} y={262} w={230} h={46} title="AxfStyleRoot" sub="applyVariables — DIFFED" tone="accent" />
        <Arrow from={[618, 210]} to={[562, 280]} label="51+ properties" />
        <Node x={330} y={334} w={230} h={40} title=":root custom properties" sub="token() surfaces read these" tone="ok" />
        <Arrow from={[445, 308]} to={[445, 334]} />

        {/* MUI branch */}
        <Node x={620} y={262} w={230} h={46} title="muiThemeFrom(values)" sub="RESOLVED hex, never var()" tone="accent2" />
        <Arrow from={[760, 232]} to={[740, 262]} />
        <Node x={620} y={334} w={230} h={40} title="<ThemeProvider>" sub="every MUI component" tone="ok" />
        <Arrow from={[735, 308]} to={[735, 334]} />
        <Pickup
          x={862}
          y={262}
          w={112}
          text={"adopted in a\nLAYOUT effect —\nbefore paint"}
        />

        {/* pre-paint branch */}
        <Node x={22} y={262} w={266} h={46} title="themeBootScript()" sub="blocking <head> script" tone="accent3" />
        <Arrow from={[330, 285]} to={[290, 285]} label="signed cache" dashed />
        <Node x={22} y={334} w={266} h={40} title="app/layout.tsx (SERVER)" sub="reads axf_theme cookie" tone="accent3" />
        <Arrow from={[155, 308]} to={[155, 334]} dashed />

        <text x={22} y={398} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          The left column exists because emotion bakes literal hex into the SSR&apos;d CSS and the browser paints it BEFORE hydration.
        </text>
        <text x={22} y={412} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          A boot script can fix custom properties; only the cookie can fix MUI. Both were needed, and both are in place.
        </text>
      </Frame>
    </>
  );
}

/* ───────────────────────────────────────────────── 3 · the chrome chain ─── */

export function ChromeChainDiagram() {
  return (
    <>
      <Legend />
      <Frame viewBox="0 0 980 280" height={280} label="How a banner or nav menu is chosen and drawn">
        <Node x={8} y={24} w={186} title="bannerBar / navMenu" sub="chrome dials · text" tone="accent" />
        <Arrow from={[194, 47]} to={[240, 47]} label="asset id" />
        <Node x={242} y={24} w={200} title="useAppliedThemeValues()" sub="applied, not previewed" />
        <Arrow from={[442, 47]} to={[488, 47]} />
        <Node x={490} y={24} w={200} title="SurfaceRegistry.resolve()" sub="registry default = FLOOR" tone="accent" />
        <Arrow from={[690, 47]} to={[736, 47]} />
        <Node x={738} y={24} w={200} title="<Toolbar> / <NavMenu>" sub="9 item kinds · roles" tone="accent2" />

        <Node x={242} y={140} w={200} h={44} title="chrome-assets.json" sub="kv · data/axf/kv/local" tone="accent3" />
        <Node x={490} y={140} w={200} h={44} title="defineToolbar()" sub="validated on save AND load" tone="accent3" />
        <Arrow from={[442, 162]} to={[488, 162]} />
        <Arrow from={[590, 140]} to={[590, 72]} label="registered" tone="accent" />

        <Node x={8} y={140} w={186} h={44} title="designer tabs" sub="Toolbar · Nav menu" />
        <Arrow from={[194, 162]} to={[240, 162]} label="save" />

        <Node x={738} y={140} w={200} h={44} title="<Glyph>" sub="→ the drawing chain" tone="ok" />
        <Arrow from={[838, 70]} to={[838, 140]} label="brand items" />

        <text x={8} y={228} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          The dials are OPTIONLESS text, so `rollTheme` never randomises them — a roll must not swap your banner for a stranger&apos;s.
        </text>
        <text x={8} y={244} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          They are ordinary dials in every other respect, so a saved look restores its own bar and menu with no separate machinery.
        </text>
        <text x={8} y={266} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          A stale id degrades to the registry default. That floor is why a deleted custom bar leaves a working banner, not a blank one.
        </text>
      </Frame>
    </>
  );
}

/* ───────────────────────────────────────────────── 4 · the module chain ─── */

export function ModuleChainDiagram() {
  return (
    <>
      <Legend />
      <Frame viewBox="0 0 980 340" height={340} label="How a module renders, and how it peels">
        <text x={8} y={16} fill={ACCENT2} fontSize={11} fontFamily={MONO}>
          SERVER RUNTIME
        </text>
        <rect x={4} y={22} width={520} height={112} rx={10} fill="none" stroke={ACCENT2} strokeDasharray="5 5" opacity={0.55} />
        <Node x={20} y={40} w={150} title="<id>.decl.ts" sub="data only" tone="accent3" />
        <Arrow from={[170, 63]} to={[212, 63]} />
        <Node x={214} y={40} w={150} title="boot()" sub="server registry" />
        <Arrow from={[364, 63]} to={[406, 63]} />
        <Node x={406} y={40} w={106} title="SSR html" />

        <text x={8} y={166} fill={ACCENT} fontSize={11} fontFamily={MONO}>
          CLIENT RUNTIME — a separate module graph, with its OWN empty registry
        </text>
        <rect x={4} y={172} width={520} height={112} rx={10} fill="none" stroke={ACCENT} strokeDasharray="5 5" opacity={0.55} />
        <Node x={20} y={190} w={150} title="BootedHost" sub="boot() again" tone="accent" />
        <Arrow from={[170, 213]} to={[212, 213]} />
        <Node x={214} y={190} w={150} title="ModuleHost id=…" sub="resolves, never imports" tone="accent" />
        <Arrow from={[364, 213]} to={[406, 213]} />
        <Node x={406} y={190} w={106} title="Boundary" sub="module tier" tone="danger" />

        <Arrow from={[264, 134]} to={[264, 172]} label="same declaration, idempotent" dashed labelDy={-4} />

        <Node x={556} y={190} w={150} title="<Slot point=…>" sub="contribution tier" tone="danger" />
        <Arrow from={[512, 213]} to={[554, 213]} />
        <Node x={556} y={40} w={150} title="registry.closureOf()" sub="+ ClosureSources" tone="accent3" />

        <Node x={748} y={40} w={216} h={46} title="peel.mjs" sub="vendors core · generates boot" tone="accent3" />
        <Arrow from={[706, 63]} to={[746, 63]} label="closure" />
        <Node x={748} y={110} w={216} h={46} title="package.json" sub="deps ← core's PEERS" tone="ok" />
        <Arrow from={[856, 86]} to={[856, 110]} />
        <Node x={748} y={180} w={216} h={46} title="a standalone app" sub="/api/health declared vs active" tone="ok" />
        <Arrow from={[856, 156]} to={[856, 180]} />

        <text x={8} y={312} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          The two dashed boxes are the finding that recurs: a module singleton is not a channel between the graphs — a PROP is.
        </text>
        <text x={8} y={328} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          It has now bitten twice (the registry, then the pack identity) and will bite every registry the framework grows.
        </text>
      </Frame>
    </>
  );
}

/* ──────────────────────────────────────────── 5 · the context-menu chain ─── */

export function CtxChainDiagram() {
  return (
    <>
      <Legend />
      <Frame viewBox="0 0 980 300" height={300} label="How a right-click composes a menu">
        <Node x={8} y={20} w={150} title="right-click" sub="anywhere" tone="accent" />
        <Arrow from={[158, 43]} to={[200, 43]} />
        <Node x={202} y={20} w={172} title="ContextMenuRoot" sub="ONE document listener" tone="accent" />
        <Arrow from={[374, 43]} to={[416, 43]} />
        <Node x={418} y={20} w={172} title="resolveAreaPath()" sub="walk up · cap 4" />
        <Arrow from={[590, 43]} to={[632, 43]} label="area path" />
        <Node x={634} y={20} w={172} title="MenuMap.itemsFor()" sub="+ edits overlay on read" />
        <Arrow from={[806, 43]} to={[848, 43]} />
        <Node x={850} y={20} w={122} title="composeMenu" tone="accent2" />

        <Pickup
          x={418}
          y={84}
          w={214}
          text={"every data-axf-* up the chain\n→ MenuContext.data\n(which row you clicked)"}
        />
        <Arrow from={[504, 66]} to={[504, 84]} tone="accent" />

        <Node x={646} y={92} w={148} h={38} title="universal band" sub="appended, always" tone="accent3" />
        <Arrow from={[720, 92]} to={[720, 66]} />

        <Node x={634} y={162} w={172} h={44} title="predicates" sub="when · enabledWhen" />
        <Arrow from={[806, 184]} to={[848, 184]} />
        <Node x={850} y={162} w={122} h={44} title="rowModel" sub="+ disabledReason" />
        <Arrow from={[911, 66]} to={[911, 162]} />

        <Node x={634} y={232} w={172} h={44} title="placeAtPoint()" sub="flip + clamp on screen" />
        <Node x={850} y={232} w={122} h={44} title="commands.run" sub="by NAME" tone="ok" />
        <Arrow from={[806, 254]} to={[848, 254]} />
        <Arrow from={[911, 206]} to={[911, 232]} />

        <text x={8} y={182} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          Items are DATA naming a command
        </text>
        <text x={8} y={198} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          and predicates by NAME. No inline
        </text>
        <text x={8} y={214} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          closures — which is the entire
        </text>
        <text x={8} y={230} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          reason a UI can edit the map.
        </text>
        <text x={8} y={256} fill={ERR} fontSize={10.5} fontFamily={SANS}>
          A disabled row carries its REASON.
        </text>
        <text x={8} y={272} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          There is no bare `disabled` boolean,
        </text>
        <text x={8} y={288} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          so a silently inert row cannot exist.
        </text>
      </Frame>
    </>
  );
}

/* ──────────────────────────────────────────────────── 6 · the build chain ─── */

export function BuildChainDiagram() {
  return (
    <>
      <Legend />
      <Frame viewBox="0 0 980 280" height={280} label="How a build runs">
        <Node x={8} y={24} w={168} title="<id>.bmpx" sub="phases · steps · notes" tone="accent3" />
        <Arrow from={[176, 47]} to={[218, 47]} />
        <Node x={220} y={24} w={186} title="/api/bmpx/run" sub="spawn · confirm real" tone="accent" />
        <Arrow from={[406, 47]} to={[448, 47]} label="--control-file" />
        <Node x={450} y={24} w={186} title="bmpx_builder.py" sub="the SINGLE writer" tone="accent" />
        <Arrow from={[636, 47]} to={[678, 47]} />
        <Node x={680} y={24} w={186} title="real code on disk" tone="ok" />

        <Node x={450} y={104} w={186} h={44} title="RUN lock (.running)" sub="staleness by PID liveness" tone="danger" />
        <Arrow from={[543, 70]} to={[543, 104]} />
        <Node x={450} y={164} w={186} h={44} title="WRITE lock + atomic" sub="tmp + replace, always" tone="danger" />
        <Arrow from={[543, 148]} to={[543, 164]} />

        <Node x={680} y={104} w={186} h={44} title="events.ndjson" sub="served by byte offset" tone="accent2" />
        <Arrow from={[636, 126]} to={[678, 126]} label="stdout" />
        <Node x={680} y={164} w={186} h={44} title="the UI overlay" sub="the session IS the file" tone="accent2" />
        <Arrow from={[773, 148]} to={[773, 164]} />

        <Node x={680} y={224} w={186} h={40} title="archive + registry" sub="verified BEFORE deletion" tone="ok" />
        <Arrow from={[773, 208]} to={[773, 224]} />

        <text x={8} y={126} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          The switches and update routes
        </text>
        <text x={8} y={142} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          REFUSE writes while a run is live.
        </text>
        <text x={8} y={172} fill={ERR} fontSize={10.5} fontFamily={SANS}>
          Process listing is NOT how you
        </text>
        <text x={8} y={188} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          decide what is a duplicate — a run&apos;s
        </text>
        <text x={8} y={204} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          tree contains python children with
        </text>
        <text x={8} y={220} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          builder-matching command lines.
        </text>
        <text x={8} y={244} fill={DIM} fontSize={10.5} fontFamily={SANS}>
          The lock is the authority.
        </text>
      </Frame>
    </>
  );
}

export const CHAIN_DIAGRAMS: Record<string, () => React.ReactElement> = {
  glyph: GlyphChainDiagram,
  theme: ThemeChainDiagram,
  chrome: ChromeChainDiagram,
  module: ModuleChainDiagram,
  ctx: CtxChainDiagram,
  build: BuildChainDiagram
};

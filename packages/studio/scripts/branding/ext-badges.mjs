/**
 * @file 25 badges and 50 animated badges for the brand-extension.
 *
 * A badge is the smallest thing the pack draws — the staged set nominates
 * `size: 10` for most of them — so the discipline is different from an icon's:
 * one idea, one or two paints, nothing under 4 units wide. Anything finer than
 * that is a grey smudge at the size a badge is actually used, which is a corner
 * of a tab.
 *
 * `animated-badge` is a THIRTEENTH category. The staged pack had animated
 * counterparts for icons, logos and watermarks but not for badges, which is the
 * one category whose entire job is to say "something is happening" — the
 * category that most wanted motion was the one without it.
 *
 * Motion here is deliberately shorter-cycled than a logo's (1.2–2.6s against
 * 3–8s): a badge is read in passing, and a five-second cycle means most glances
 * catch it mid-nothing.
 */
import {
  blink, circle, drawOn, fill, flicker, float, morphPath, orbitDot, circlePath, ping,
  poly, pulse, rect, rectS, ring, shimmerSet, spin, stroke, text, v
} from "./kit.mjs";

const A = () => v("accent");
const A2 = () => v("accent2");
const A3 = () => v("accent3");
const INK = () => v("ink");
const DIM = () => v("dim");
const OK = () => v("ok");
const WARN = () => v("warn");
const ERR = () => v("err");
const PAGE = () => v("page");

/** A badge caption — always uppercase, always inside a plate that fits it. */
const caption = (t, { color = PAGE(), size = 26, y = 51 } = {}) =>
  text(t, { x: 50, y, size, weight: 800, ls: 1, color });

/* ------------------------------------------------------------ 25 flat badges */

export const BADGES = [
  { id: "badge-alpha", label: "Badge · Alpha", style: "solid", tags: ["badge", "release"],
    build: () => rect(6, 30, 88, 40, 20, A()) + caption("ALPHA", { size: 24 }) },
  { id: "badge-rc", label: "Badge · Release candidate", style: "solid", tags: ["badge", "release"],
    build: () => rect(18, 30, 64, 40, 20, A3()) + caption("RC", { size: 28 }) },
  { id: "badge-pro", label: "Badge · Pro", style: "duotone", tags: ["badge", "tier"],
    build: () => rect(14, 30, 72, 40, 20, A()) + caption("PRO", { size: 26 }) },
  { id: "badge-plus", label: "Badge · Plus", style: "solid", tags: ["badge", "action"],
    build: () => circle(50, 50, 30, A()) + stroke("M50 34v32M34 50h32", { color: PAGE(), width: 9 }) },
  { id: "badge-minus", label: "Badge · Minus", style: "solid", tags: ["badge", "action"],
    build: () => circle(50, 50, 30, DIM()) + stroke("M34 50h32", { color: PAGE(), width: 9 }) },
  { id: "badge-shield-tick", label: "Badge · Shield tick", style: "duotone", tags: ["badge", "status"],
    build: () => fill("M50 12 82 24v22c0 20-14 30-32 38-18-8-32-18-32-38V24Z", OK()) + stroke("M38 50l9 10 17-20", { color: PAGE(), width: 8 }) },
  { id: "badge-shield-bang", label: "Badge · Shield alert", style: "duotone", tags: ["badge", "status"],
    build: () => fill("M50 12 82 24v22c0 20-14 30-32 38-18-8-32-18-32-38V24Z", ERR()) + stroke("M50 32v20", { color: PAGE(), width: 8 }) + circle(50, 64, 5, PAGE()) },
  { id: "badge-clock", label: "Badge · Pending", style: "line", tags: ["badge", "status"],
    build: () => ring(50, 50, 30, WARN(), 8) + stroke("M50 32v20l14 8", { color: WARN(), width: 7 }) },
  { id: "badge-sync", label: "Badge · Syncing", style: "line", tags: ["badge", "status"],
    build: () => stroke("M78 50a28 28 0 1 1-10-21", { color: A2(), width: 9 }) + fill("M80 18 82 42 58 36Z", A2()) },
  { id: "badge-cloud", label: "Badge · Cloud", style: "solid", tags: ["badge", "status"],
    build: () => fill("M32 70a16 16 0 0 1 0-32 22 22 0 0 1 41-6 15 15 0 0 1-3 38Z", A2()) },
  { id: "badge-offline", label: "Badge · Offline", style: "duotone", tags: ["badge", "status"],
    build: () => circle(50, 50, 26, DIM()) + stroke("M30 30 70 70", { color: PAGE(), width: 9 }) },
  { id: "badge-hex-dot", label: "Badge · Hex dot", style: "solid", tags: ["badge", "indicator"],
    build: () => fill(poly(50, 50, 32, 6), A()) + circle(50, 50, 10, PAGE()) },
  { id: "badge-hex-ring", label: "Badge · Hex ring", style: "line", tags: ["badge", "indicator"],
    build: () => stroke(poly(50, 50, 30, 6), { color: A3(), width: 9 }) },
  { id: "badge-square-dot", label: "Badge · Square dot", style: "duotone", tags: ["badge", "indicator"],
    build: () => rect(20, 20, 60, 60, 14, A()) + circle(50, 50, 11, PAGE()) },
  { id: "badge-triangle", label: "Badge · Triangle", style: "solid", tags: ["badge", "indicator"],
    build: () => fill(poly(50, 54, 34, 3), WARN()) },
  { id: "badge-triangle-ink", label: "Badge · Triangle ink", style: "duotone", tags: ["badge", "indicator"],
    build: () => fill(poly(50, 54, 34, 3), INK()) + stroke("M50 42v14", { color: PAGE(), width: 8 }) + circle(50, 66, 4.5, PAGE()) },
  { id: "badge-chevron", label: "Badge · Chevron", style: "line", tags: ["badge", "nav"],
    build: () => stroke("M38 24 66 50 38 76", { color: A(), width: 11 }) },
  { id: "badge-double-chevron", label: "Badge · Double chevron", style: "line", tags: ["badge", "nav"],
    build: () => stroke("M22 26 46 50 22 74", { color: A(), width: 10 }) + stroke("M52 26 76 50 52 74", { color: A3(), width: 10 }) },
  { id: "badge-bolt", label: "Badge · Bolt", style: "solid", tags: ["badge", "indicator"],
    build: () => fill("M56 8 24 54h20l-4 38 34-50H52Z", A()) },
  { id: "badge-flame", label: "Badge · Hot", style: "duotone", tags: ["badge", "indicator"],
    build: () => fill("M52 6c4 18 24 22 24 44a26 26 0 0 1-52 0c0-12 8-18 12-28 2 8 6 12 10 12 6 0 8-16 6-28Z", A()) + fill("M50 52c2 8 10 10 10 18a10 10 0 0 1-20 0c0-8 8-10 10-18Z", WARN()) },
  { id: "badge-heart", label: "Badge · Favourite", style: "solid", tags: ["badge", "indicator"],
    build: () => fill("M50 82 20 54a17 17 0 0 1 30-18 17 17 0 0 1 30 18Z", ERR()) },
  { id: "badge-flag", label: "Badge · Flagged", style: "duotone", tags: ["badge", "status"],
    build: () => stroke("M28 14v74", { color: DIM(), width: 8 }) + fill("M32 18h44l-9 15 9 15H32Z", A()) },
  { id: "badge-eye", label: "Badge · Watching", style: "duotone", tags: ["badge", "status"],
    build: () => fill("M8 50c14-19 27-28 42-28s28 9 42 28c-14 19-27 28-42 28S22 69 8 50Z", A2()) + circle(50, 50, 12, PAGE()) },
  { id: "badge-mute", label: "Badge · Muted", style: "duotone", tags: ["badge", "status"],
    build: () => fill("M18 38h14L52 20v60L32 62H18Z", DIM()) + stroke("M64 38 86 62M86 38 64 62", { color: ERR(), width: 8 }) },
  { id: "badge-target", label: "Badge · Target", style: "line", tags: ["badge", "indicator"],
    build: () => ring(50, 50, 30, A(), 8) + ring(50, 50, 16, A3(), 8) + circle(50, 50, 5, A()) }
].map((s) => ({
  ...s,
  category: "badge",
  size: 10,
  shape: "square",
  animated: false,
  motion: "none",
  dir: "badges",
  tags: [...s.tags, s.style, "extension"]
}));

if (BADGES.length !== 25) throw new Error(`ext-badges: expected 25 badges, have ${BADGES.length}`);

/* -------------------------------------------------------- 50 animated badges */

export const ANIMATED_BADGES = [
  { id: "anim-badge-dot-pulse", label: "Badge · Dot pulse", motion: "pulse", style: "solid",
    build: () => pulse(circle(50, 50, 22, A()), { dur: 1.6, lo: 0.8, hi: 1.15 }) },
  { id: "anim-badge-dot-ping", label: "Badge · Dot ping", motion: "pulse", style: "duotone",
    build: () => ping(50, 50, 20, 44, A(), { dur: 1.8 }) + circle(50, 50, 18, A()) },
  { id: "anim-badge-dot-breathe", label: "Badge · Dot breathe", motion: "pulse", style: "solid",
    build: () => `<circle cx="50" cy="50" r="24" fill="${A()}"><animate attributeName="opacity" values="1;0.35;1" dur="2.6s" repeatCount="indefinite"/></circle>` },
  { id: "anim-badge-dot-blink", label: "Badge · Dot blink", motion: "flicker", style: "solid",
    build: () => blink(circle(50, 50, 22, ERR()), { dur: 1.2 }) },
  { id: "anim-badge-ring-spin", label: "Badge · Ring spin", motion: "spin", style: "line",
    build: () => ring(50, 50, 28, DIM(), 9, { opacity: "0.3" }) + spin(stroke("M50 22a28 28 0 0 1 28 28", { color: A(), width: 9 }), { dur: 1.2 }) },
  { id: "anim-badge-ring-dash-spin", label: "Badge · Dashed ring spin", motion: "spin", style: "line",
    build: () => spin(stroke(circlePath(50, 50, 28), { color: A2(), width: 9, dash: "14 12" }), { dur: 3 }) },
  { id: "anim-badge-ring-draw", label: "Badge · Ring draw", motion: "draw", style: "line",
    build: () => drawOn([circlePath(50, 50, 28)], { color: A(), dur: 2.4, len: 60, gap: 120, width: 9 }) },
  { id: "anim-badge-ring-sweep", label: "Badge · Ring sweep", motion: "sweep", style: "duotone",
    build: () => ring(50, 50, 28, DIM(), 9, { opacity: "0.28" }) + spin(stroke("M50 22a28 28 0 0 1 24 14", { color: A3(), width: 9 }), { dur: 1.6 }) },
  { id: "anim-badge-live-ping", label: "Badge · Live ping", motion: "pulse", style: "duotone",
    build: () => ping(50, 50, 18, 42, OK(), { dur: 2 }) + circle(50, 50, 17, OK()) },
  { id: "anim-badge-live-blink", label: "Badge · Live blink", motion: "flicker", style: "duotone",
    build: () => circle(50, 50, 17, OK()) + blink(ring(50, 50, 31, OK(), 5), { dur: 1.4, lo: 0.1 }) },
  { id: "anim-badge-rec-pulse", label: "Badge · Recording", motion: "pulse", style: "solid",
    build: () => pulse(circle(50, 50, 20, ERR()), { dur: 1.3, lo: 0.85, hi: 1.12 }) + ring(50, 50, 32, ERR(), 5, { opacity: "0.35" }) },
  { id: "anim-badge-ok-draw", label: "Badge · Confirm draw", motion: "draw", style: "duotone",
    build: () => ring(50, 50, 30, OK(), 6, { opacity: "0.4" }) + drawOn(["M34 51 46 63 68 39"], { color: OK(), dur: 2.2, len: 24, gap: 70, width: 9 }) },
  { id: "anim-badge-err-flicker", label: "Badge · Error flicker", motion: "flicker", style: "duotone",
    build: () => circle(50, 50, 30, ERR(), { opacity: "0.2" }) + flicker(stroke("M34 34 66 66M66 34 34 66", { color: ERR(), width: 10 }), { dur: 1.4 }) },
  { id: "anim-badge-warn-flicker", label: "Badge · Warning flicker", motion: "flicker", style: "solid",
    build: () => flicker(fill(poly(50, 54, 34, 3), WARN()) + stroke("M50 42v13", { color: PAGE(), width: 8 }) + circle(50, 66, 4.5, PAGE()), { dur: 1.6 }) },
  { id: "anim-badge-bang-pulse", label: "Badge · Attention", motion: "pulse", style: "duotone",
    build: () => pulse(circle(50, 50, 28, WARN()) + stroke("M50 32v22", { color: PAGE(), width: 9 }) + circle(50, 66, 5, PAGE()), { dur: 1.8, lo: 0.9, hi: 1.08 }) },
  { id: "anim-badge-spark-shimmer", label: "Badge · Spark shimmer", motion: "shimmer", style: "duotone",
    build: () => shimmerSet([fill("M50 14 58 42 86 50 58 58 50 86 42 58 14 50 42 42Z", A()), fill("M78 16 82 26 92 30 82 34 78 44 74 34 64 30 74 26Z", A3())], { dur: 1.8 }) },
  { id: "anim-badge-star-spin", label: "Badge · Star spin", motion: "spin", style: "solid",
    build: () => spin(fill("M50 12 61 40 90 42 68 61 75 89 50 74 25 89 32 61 10 42 39 40Z", A()), { dur: 7 }) },
  { id: "anim-badge-star-pulse", label: "Badge · Star pulse", motion: "pulse", style: "solid",
    build: () => pulse(fill("M50 12 61 40 90 42 68 61 75 89 50 74 25 89 32 61 10 42 39 40Z", WARN()), { dur: 2, lo: 0.86, hi: 1.1 }) },
  { id: "anim-badge-diamond-spin", label: "Badge · Diamond spin", motion: "spin", style: "solid",
    build: () => spin(rect(28, 28, 44, 44, 8, A3(), { transform: "rotate(45 50 50)" }), { dur: 6 }) },
  { id: "anim-badge-diamond-pulse", label: "Badge · Diamond pulse", motion: "pulse", style: "duotone",
    build: () => pulse(rect(28, 28, 44, 44, 8, A(), { transform: "rotate(45 50 50)" }) + circle(50, 50, 9, PAGE()), { dur: 2.2, lo: 0.88, hi: 1.08 }) },
  { id: "anim-badge-hex-spin", label: "Badge · Hex spin", motion: "spin", style: "line",
    build: () => spin(stroke(poly(50, 50, 30, 6), { color: A2(), width: 9 }), { dur: 6.5 }) },
  { id: "anim-badge-hex-pulse", label: "Badge · Hex pulse", motion: "pulse", style: "solid",
    build: () => pulse(fill(poly(50, 50, 32, 6), A()) + circle(50, 50, 10, PAGE()), { dur: 2, lo: 0.88, hi: 1.08 }) },
  { id: "anim-badge-triangle-flicker", label: "Badge · Triangle flicker", motion: "flicker", style: "solid",
    build: () => flicker(fill(poly(50, 50, 34, 3), A3()), { dur: 1.8 }) },
  { id: "anim-badge-square-spin", label: "Badge · Square spin", motion: "spin", style: "duotone",
    build: () => spin(rectS(24, 24, 52, 52, 12, A(), 9), { dur: 5 }) + circle(50, 50, 9, A2()) },
  { id: "anim-badge-bar-sweep", label: "Badge · Bar sweep", motion: "sweep", style: "duotone",
    build: () => rect(10, 42, 80, 16, 8, DIM(), { opacity: "0.3" }) +
      `<rect x="10" y="42" width="26" height="16" rx="8" fill="${A()}"><animate attributeName="x" values="10;64;10" dur="2.2s" repeatCount="indefinite"/></rect>` },
  { id: "anim-badge-bar-fill", label: "Badge · Bar fill", motion: "draw", style: "duotone",
    build: () => rect(10, 42, 80, 16, 8, DIM(), { opacity: "0.3" }) +
      `<rect x="10" y="42" width="8" height="16" rx="8" fill="${A2()}"><animate attributeName="width" values="8;80;8" dur="2.8s" repeatCount="indefinite"/></rect>` },
  { id: "anim-badge-count-pulse", label: "Badge · Count pulse", motion: "pulse", style: "solid",
    build: () => pulse(circle(50, 50, 30, A()) + caption("9", { size: 34, y: 52 }), { dur: 1.8, lo: 0.9, hi: 1.06 }) },
  { id: "anim-badge-count-orbit", label: "Badge · Count orbit", motion: "orbit", style: "duotone",
    build: () => circle(50, 50, 26, A()) + caption("3", { size: 30, y: 52 }) + orbitDot(circlePath(50, 50, 36), 5, A2(), { dur: 3.2 }) },
  { id: "anim-badge-new-shimmer", label: "Badge · New shimmer", motion: "shimmer", style: "solid",
    build: () => shimmerSet([rect(6, 32, 88, 36, 18, A())], { dur: 2 }) + caption("NEW", { size: 22 }) },
  { id: "anim-badge-beta-shimmer", label: "Badge · Beta shimmer", motion: "shimmer", style: "solid",
    build: () => shimmerSet([rect(6, 32, 88, 36, 18, A3())], { dur: 2.2 }) + caption("BETA", { size: 21 }) },
  { id: "anim-badge-pro-shimmer", label: "Badge · Pro shimmer", motion: "shimmer", style: "solid",
    build: () => shimmerSet([rect(14, 32, 72, 36, 18, WARN())], { dur: 2 }) + caption("PRO", { size: 23 }) },
  { id: "anim-badge-plus-spin", label: "Badge · Plus spin", motion: "spin", style: "duotone",
    build: () => circle(50, 50, 30, A(), { opacity: "0.2" }) + spin(stroke("M50 30v40M30 50h40", { color: A(), width: 10 }), { dur: 4 }) },
  { id: "anim-badge-arrow-up-float", label: "Badge · Arrow up float", motion: "float", style: "duotone",
    build: () => circle(50, 50, 30, OK(), { opacity: "0.18" }) + float(stroke("M50 70V32M34 46 50 30l16 16", { color: OK(), width: 9 }), { dur: 1.8, amp: 5 }) },
  { id: "anim-badge-arrow-down-float", label: "Badge · Arrow down float", motion: "float", style: "duotone",
    build: () => circle(50, 50, 30, ERR(), { opacity: "0.18" }) + float(stroke("M50 30v38M34 54 50 70l16-16", { color: ERR(), width: 9 }), { dur: 1.8, amp: 5 }) },
  { id: "anim-badge-chevron-float", label: "Badge · Chevron float", motion: "float", style: "line",
    build: () => float(stroke("M36 24 64 50 36 76", { color: A(), width: 11 }), { dur: 1.6, amp: 5, axis: "x" }) },
  { id: "anim-badge-sync-spin", label: "Badge · Sync spin", motion: "spin", style: "line",
    build: () => spin(stroke("M78 50a28 28 0 1 1-10-21", { color: A2(), width: 9 }) + fill("M80 18 82 42 58 36Z", A2()), { dur: 1.6 }) },
  { id: "anim-badge-cloud-float", label: "Badge · Cloud float", motion: "float", style: "solid",
    build: () => float(fill("M32 70a16 16 0 0 1 0-32 22 22 0 0 1 41-6 15 15 0 0 1-3 38Z", A2()), { dur: 3.4, amp: 4 }) },
  { id: "anim-badge-lock-morph", label: "Badge · Lock morph", motion: "morph", style: "duotone",
    build: () => morphPath(["M36 48V38a14 14 0 0 1 28 0v10", "M36 48V30a14 14 0 0 1 28 0v4"], A2(), { kind: "stroke", dur: 3, width: 8 }) + rect(28, 48, 44, 34, 8, A()) },
  { id: "anim-badge-pin-float", label: "Badge · Pin float", motion: "float", style: "duotone",
    build: () => float(fill("M50 12a22 22 0 0 1 22 22c0 16-22 42-22 42S28 50 28 34a22 22 0 0 1 22-22Z", A()) + circle(50, 34, 9, PAGE()), { dur: 2.8, amp: 4 }) },
  { id: "anim-badge-flame-flicker", label: "Badge · Hot flicker", motion: "flicker", style: "duotone",
    build: () => fill("M52 8c4 18 24 22 24 44a26 26 0 0 1-52 0c0-12 8-18 12-28 2 8 6 12 10 12 6 0 8-16 6-28Z", A()) +
      flicker(fill("M50 52c2 8 10 10 10 18a10 10 0 0 1-20 0c0-8 8-10 10-18Z", WARN()), { dur: 1.2 }) },
  { id: "anim-badge-bolt-flicker", label: "Badge · Bolt flicker", motion: "flicker", style: "solid",
    build: () => flicker(fill("M56 8 24 54h20l-4 38 34-50H52Z", A()), { dur: 1.3 }) },
  { id: "anim-badge-heart-pulse", label: "Badge · Favourite pulse", motion: "pulse", style: "solid",
    build: () => pulse(fill("M50 82 20 54a17 17 0 0 1 30-18 17 17 0 0 1 30 18Z", ERR()), { dur: 1.4, lo: 0.88, hi: 1.12 }) },
  { id: "anim-badge-eye-morph", label: "Badge · Watching morph", motion: "morph", style: "duotone",
    build: () => morphPath([
      "M8 50c14-19 27-28 42-28s28 9 42 28c-14 19-27 28-42 28S22 69 8 50Z",
      "M8 50c14-7 27-10 42-10s28 3 42 10c-14 7-27 10-42 10S22 57 8 50Z"
    ], A2(), { dur: 3 }) + pulse(circle(50, 50, 11, PAGE()), { dur: 3, lo: 1, hi: 0.6 }) },
  { id: "anim-badge-target-pulse", label: "Badge · Target pulse", motion: "pulse", style: "line",
    build: () => ring(50, 50, 30, A(), 8) + pulse(ring(50, 50, 16, A3(), 8), { dur: 2, lo: 0.7, hi: 1.15 }) + circle(50, 50, 5, A()) },
  { id: "anim-badge-radar-sweep", label: "Badge · Radar sweep", motion: "sweep", style: "duotone",
    build: () => ring(50, 50, 30, DIM(), 5, { opacity: "0.45" }) + circle(50, 50, 7, A()) +
      spin(stroke("M50 50 50 20", { color: A(), width: 7 }), { dur: 2.4 }) },
  { id: "anim-badge-orbit-dot", label: "Badge · Orbit dot", motion: "orbit", style: "duotone",
    build: () => circle(50, 50, 14, A()) + orbitDot(circlePath(50, 50, 32), 7, A2(), { dur: 2.6 }) },
  { id: "anim-badge-orbit-duo", label: "Badge · Orbit duo", motion: "orbit", style: "duotone",
    build: () => circle(50, 50, 12, A3()) + orbitDot(circlePath(50, 50, 32), 6, A(), { dur: 3 }) +
      orbitDot(circlePath(50, 50, 32), 6, A2(), { dur: 3, begin: "-1.5s" }) },
  { id: "anim-badge-trio-pulse", label: "Badge · Trio pulse", motion: "pulse", style: "solid",
    build: () => shimmerSet([circle(22, 50, 11, A()), circle(50, 50, 11, A()), circle(78, 50, 11, A())], { dur: 1.5 }) },
  { id: "anim-badge-progress-draw", label: "Badge · Progress draw", motion: "draw", style: "duotone",
    build: () => ring(50, 50, 30, DIM(), 8, { opacity: "0.28" }) +
      `<circle cx="50" cy="50" r="30" fill="none" stroke="${A()}" stroke-width="8" stroke-linecap="round" stroke-dasharray="189" stroke-dashoffset="189" transform="rotate(-90 50 50)">` +
      `<animate attributeName="stroke-dashoffset" values="189;0;189" dur="3.2s" repeatCount="indefinite"/></circle>` },
  { id: "anim-badge-notch-shimmer", label: "Badge · Notch shimmer", motion: "shimmer", style: "duotone",
    build: () => shimmerSet([fill("M14 14h72v22L36 86H14Z", A()), fill("M52 62h34v24H52Z", A3())], { dur: 2.2 }) }
].map((s) => ({
  ...s,
  category: "animated-badge",
  size: 12,
  shape: "square",
  animated: true,
  dir: "animated-badges",
  tags: ["badge", "animated", s.motion, "extension"]
}));

if (ANIMATED_BADGES.length !== 50) {
  throw new Error(`ext-badges: expected 50 animated badges, have ${ANIMATED_BADGES.length}`);
}

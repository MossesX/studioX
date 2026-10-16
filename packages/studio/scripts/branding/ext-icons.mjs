/**
 * @file 50 animated icons for the brand-extension.
 *
 * Every glyph here is NEW — none of the 28 `animated-icon` entries the staged
 * pack already carries is redrawn, so the extension adds shapes rather than
 * second opinions. Motion stays inside the pack's nine families (`spin` `pulse`
 * `orbit` `sweep` `draw` `float` `flicker` `morph` `shimmer`) because the
 * "animated branding off" switch freezes by family, and a tenth family would be
 * a drawing that switch cannot reach.
 *
 * The pairing is not arbitrary: a thing that rotates gets `spin`, a thing that
 * measures gets `sweep`, a thing that transmits gets `pulse`. An icon whose
 * motion argues with its subject reads as a glitch, not as life.
 */
import {
  circle, circlePath, defs, drawOn, fill, flicker, float, morphPath, orbitDot,
  pulse, rect, rectS, ring, shimmerSet, spin, stroke, v
} from "./kit.mjs";

const A = () => v("accent");
const A2 = () => v("accent2");
const A3 = () => v("accent3");
const DIM = () => v("dim");

/**
 * The 50. `build(id)` returns inner markup; `id` seeds the gradient/filter
 * namespace so two of these can share a page without fighting over `url(#…)`.
 */
export const ANIMATED_ICONS = [
  {
    id: "anim-icon-radar-sweep", label: "Radar icon · sweep", motion: "sweep", style: "duotone",
    build: (n) => {
      const g = n();
      return (
        defs(
          `<linearGradient id="${g}" x1="0" y1="0" x2="1" y2="0">` +
            `<stop offset="0%" stop-color="${A()}" stop-opacity="0.7"/>` +
            `<stop offset="100%" stop-color="${A()}" stop-opacity="0"/></linearGradient>`
        ) +
        ring(50, 50, 38, DIM(), 5, { opacity: "0.5" }) +
        ring(50, 50, 24, DIM(), 5, { opacity: "0.5" }) +
        ring(50, 50, 10, A2(), 5) +
        spin(`<path d="M50 50 88 50A38 38 0 0 0 74 23Z" fill="url(#${g})"/>` + stroke("M50 50 88 50", { color: A(), width: 5 }), { dur: 4 })
      );
    }
  },
  {
    id: "anim-icon-waveform-shimmer", label: "Waveform icon · shimmer", motion: "shimmer", style: "solid",
    build: () =>
      shimmerSet(
        [14, 28, 42, 56, 70, 84].map((x, i) => {
          const h = [26, 46, 66, 54, 38, 22][i];
          return rect(x - 5, 50 - h / 2, 10, h, 5, i % 2 ? A2() : A());
        }),
        { dur: 2.4 }
      )
  },
  {
    id: "anim-icon-cloud-float", label: "Cloud icon · float", motion: "float", style: "line",
    build: () =>
      float(
        stroke("M30 72a18 18 0 0 1 0-36 24 24 0 0 1 45-7 16 16 0 0 1-3 43Z", { color: A() }) +
          circle(38, 54, 5, A2()) + circle(56, 58, 5, A2(), { opacity: "0.7" }),
        { dur: 4.4, amp: 4 }
      )
  },
  {
    id: "anim-icon-database-shimmer", label: "Database icon · shimmer", motion: "shimmer", style: "duotone",
    build: () =>
      stroke("M22 26c0-7 12.5-12 28-12s28 5 28 12-12.5 12-28 12-28-5-28-12Z", { color: A() }) +
      shimmerSet(
        [26, 50].map((y) => stroke(`M22 ${y}v14c0 7 12.5 12 28 12s28-5 28-12V${y}`, { color: A2() })),
        { dur: 2.6 }
      )
  },
  {
    id: "anim-icon-server-flicker", label: "Server icon · flicker", motion: "flicker", style: "duotone",
    build: () =>
      rectS(16, 18, 68, 26, 7, A(), 7) + rectS(16, 56, 68, 26, 7, A(), 7) +
      flicker(circle(30, 31, 5, A2()) + circle(30, 69, 5, A2()), { dur: 1.8 }) +
      stroke("M46 31h24M46 69h24", { color: DIM(), width: 5 })
  },
  {
    id: "anim-icon-shield-pulse", label: "Shield icon · pulse", motion: "pulse", style: "duotone",
    build: () =>
      pulse(
        stroke("M50 10 84 22v26c0 22-16 34-34 42-18-8-34-20-34-42V22Z", { color: A() }) +
          stroke("M38 50l9 10 17-20", { color: A2() }),
        { dur: 2.8, lo: 0.94, hi: 1.05 }
      )
  },
  {
    id: "anim-icon-lock-morph", label: "Lock icon · morph", motion: "morph", style: "duotone",
    build: () =>
      morphPath(["M32 46V32a18 18 0 0 1 36 0v14", "M32 46V22a18 18 0 0 1 36 0v6"], A2(), { kind: "stroke", dur: 3.2 }) +
      rectS(24, 46, 52, 40, 9, A(), 7) + circle(50, 66, 6, A())
  },
  {
    id: "anim-icon-key-spin", label: "Key icon · spin", motion: "spin", style: "duotone",
    build: () =>
      spin(ring(34, 50, 16, A(), 8) + stroke("M50 50h34M74 50v12M62 50v10", { color: A2() }), { dur: 7, cx: 34, cy: 50 })
  },
  {
    id: "anim-icon-bell-float", label: "Bell icon · float", motion: "float", style: "line",
    build: () =>
      float(
        stroke("M26 68c6-6 6-10 6-22a18 18 0 0 1 36 0c0 12 0 16 6 22Z", { color: A() }) +
          stroke("M42 76a8 8 0 0 0 16 0", { color: A2() }),
        { dur: 2.6, amp: 3 }
      )
  },
  {
    id: "anim-icon-heart-pulse", label: "Heart icon · pulse", motion: "pulse", style: "solid",
    build: () => pulse(fill("M50 84 16 52a20 20 0 0 1 34-20 20 20 0 0 1 34 20Z", A()), { dur: 1.6, lo: 0.9, hi: 1.1 })
  },
  {
    id: "anim-icon-bulb-flicker", label: "Bulb icon · flicker", motion: "flicker", style: "duotone",
    build: () =>
      flicker(fill("M50 12a24 24 0 0 1 14 43v9H36v-9a24 24 0 0 1 14-43Z", A()), { dur: 2.2 }) +
      stroke("M38 74h24M42 84h16", { color: A2(), width: 6 })
  },
  {
    id: "anim-icon-rocket-float", label: "Rocket icon · float", motion: "float", style: "duotone",
    build: () =>
      float(
        stroke("M50 8c14 12 20 28 20 44l-20 14-20-14c0-16 6-32 20-44Z", { color: A() }) +
          circle(50, 40, 8, A2()) +
          stroke("M30 58 18 74l14-2M70 58l12 16-14-2", { color: A3() }),
        { dur: 3, amp: 5 }
      )
  },
  {
    id: "anim-icon-satellite-orbit", label: "Satellite icon · orbit", motion: "orbit", style: "duotone",
    build: () =>
      circle(50, 50, 14, A()) + ring(50, 50, 34, DIM(), 4, { opacity: "0.6" }) +
      orbitDot(circlePath(50, 50, 34), 7, A2(), { dur: 5 }) +
      orbitDot(circlePath(50, 50, 34), 5, A3(), { dur: 5, begin: "-2.5s" })
  },
  {
    id: "anim-icon-globe-spin", label: "Globe icon · spin", motion: "spin", style: "line",
    build: () =>
      ring(50, 50, 38, A(), 7) +
      spin(stroke("M50 12v76M20 30a60 60 0 0 0 60 0M20 70a60 60 0 0 1 60 0", { color: A2(), width: 5 }), { dur: 9 })
  },
  {
    id: "anim-icon-atom-orbit", label: "Atom icon · orbit", motion: "orbit", style: "duotone",
    build: () =>
      circle(50, 50, 9, A()) +
      [0, 60, 120]
        .map((a) => `<ellipse cx="50" cy="50" rx="40" ry="16" fill="none" stroke="${A2()}" stroke-width="5" opacity="0.8" transform="rotate(${a} 50 50)"/>`)
        .join("") +
      orbitDot(circlePath(50, 50, 34), 6, A3(), { dur: 3.4 })
  },
  {
    id: "anim-icon-dna-shimmer", label: "DNA icon · shimmer", motion: "shimmer", style: "duotone",
    build: () =>
      stroke("M32 10c0 26 36 34 36 60M68 10c0 26-36 34-36 60", { color: A() }) +
      shimmerSet([22, 36, 50, 64, 78].map((y, i) => stroke(`M${34 + (i % 2) * 6} ${y}h${32 - (i % 2) * 12}`, { color: A2(), width: 5 })), { dur: 2.2 })
  },
  {
    id: "anim-icon-brain-pulse", label: "Brain icon · pulse", motion: "pulse", style: "line",
    build: () =>
      pulse(
        stroke("M50 20a14 14 0 0 0-26 8 14 14 0 0 0-4 24 14 14 0 0 0 16 22h14Z", { color: A() }) +
          stroke("M50 20a14 14 0 0 1 26 8 14 14 0 0 1 4 24 14 14 0 0 1-16 22H50Z", { color: A3() }),
        { dur: 3, lo: 0.95, hi: 1.04 }
      )
  },
  {
    id: "anim-icon-chip-shimmer", label: "Chip icon · shimmer", motion: "shimmer", style: "duotone",
    build: () =>
      rectS(24, 24, 52, 52, 10, A(), 8) +
      stroke("M34 12v12M50 12v12M66 12v12M34 76v12M50 76v12M66 76v12M12 34h12M12 50h12M12 66h12M76 34h12M76 50h12M76 66h12", { color: DIM(), width: 5 }) +
      shimmerSet([rect(38, 38, 24, 24, 6, A2()), rect(44, 44, 12, 12, 3, A3())], { dur: 2 })
  },
  {
    id: "anim-icon-cpu-pulse", label: "CPU icon · pulse", motion: "pulse", style: "duotone",
    build: () =>
      rectS(22, 22, 56, 56, 9, A(), 7) +
      pulse(rect(38, 38, 24, 24, 6, A2()), { dur: 2, lo: 0.85, hi: 1.1 }) +
      stroke("M34 12v10M50 12v10M66 12v10M34 78v10M50 78v10M66 78v10", { color: DIM(), width: 5 })
  },
  {
    id: "anim-icon-battery-shimmer", label: "Battery icon · shimmer", motion: "shimmer", style: "duotone",
    build: () =>
      rectS(12, 32, 68, 36, 8, A(), 7) + rect(84, 42, 8, 16, 4, A()) +
      shimmerSet([22, 38, 54].map((x) => rect(x, 40, 12, 20, 3, A2())), { dur: 1.8 })
  },
  {
    id: "anim-icon-signal-shimmer", label: "Signal icon · shimmer", motion: "shimmer", style: "solid",
    build: () => shimmerSet([16, 34, 52, 70].map((x, i) => rect(x, 78 - (i + 1) * 15, 12, (i + 1) * 15, 4, i === 3 ? A3() : A())), { dur: 2 })
  },
  {
    id: "anim-icon-wifi-pulse", label: "Wi-Fi icon · pulse", motion: "pulse", style: "line",
    build: () =>
      circle(50, 76, 7, A()) +
      shimmerSet(
        [
          stroke("M32 58a26 26 0 0 1 36 0", { color: A2() }),
          stroke("M20 44a44 44 0 0 1 60 0", { color: A2() }),
          stroke("M10 30a60 60 0 0 1 80 0", { color: A3() })
        ],
        { dur: 2.1 }
      )
  },
  {
    id: "anim-icon-upload-float", label: "Upload icon · float", motion: "float", style: "duotone",
    build: () =>
      stroke("M16 68v10a8 8 0 0 0 8 8h52a8 8 0 0 0 8-8V68", { color: A() }) +
      float(stroke("M50 66V16M32 34 50 16l18 18", { color: A2() }), { dur: 2.4, amp: 5 })
  },
  {
    id: "anim-icon-download-float", label: "Download icon · float", motion: "float", style: "duotone",
    build: () =>
      stroke("M16 68v10a8 8 0 0 0 8 8h52a8 8 0 0 0 8-8V68", { color: A() }) +
      float(stroke("M50 14v50M32 46l18 18 18-18", { color: A2() }), { dur: 2.4, amp: 5 })
  },
  {
    id: "anim-icon-sync-spin", label: "Sync icon · spin", motion: "spin", style: "duotone",
    build: () =>
      spin(
        stroke("M84 50a34 34 0 0 1-58 24", { color: A() }) + fill("M20 58 32 78 8 78Z", A()) +
          stroke("M16 50a34 34 0 0 1 58-24", { color: A2() }) + fill("M80 42 68 22h24Z", A2()),
        { dur: 3.2 }
      )
  },
  {
    id: "anim-icon-refresh-spin", label: "Refresh icon · spin", motion: "spin", style: "line",
    build: () => spin(stroke("M82 50a32 32 0 1 1-12-25", { color: A() }) + fill("M84 12 86 40 58 34Z", A2()), { dur: 2.6 })
  },
  {
    id: "anim-icon-loader-spin", label: "Loader icon · spin", motion: "spin", style: "line",
    build: () =>
      ring(50, 50, 34, DIM(), 8, { opacity: "0.3" }) +
      spin(stroke("M50 16a34 34 0 0 1 34 34", { color: A(), width: 8 }), { dur: 1.1 })
  },
  {
    id: "anim-icon-gauge-sweep", label: "Gauge icon · sweep", motion: "sweep", style: "duotone",
    build: () =>
      stroke("M14 70a36 36 0 1 1 72 0", { color: DIM(), width: 8, opacity: "0.45" }) +
      stroke("M14 70a36 36 0 0 1 18-31", { color: A(), width: 8 }) +
      circle(50, 70, 7, A()) +
      `<g><animateTransform attributeName="transform" attributeType="XML" type="rotate" values="-70 50 70;70 50 70;-70 50 70" dur="3.6s" repeatCount="indefinite"/>${stroke("M50 70 50 34", { color: A2(), width: 6 })}</g>`
  },
  {
    id: "anim-icon-chart-draw", label: "Chart icon · draw", motion: "draw", style: "duotone",
    build: () =>
      stroke("M16 16v68h68", { color: DIM(), width: 6, opacity: "0.6" }) +
      drawOn(["M24 70 42 48l14 12 22-30"], { color: A(), dur: 3, len: 30, gap: 200 })
  },
  {
    id: "anim-icon-bars-shimmer", label: "Bars icon · shimmer", motion: "shimmer", style: "solid",
    build: () =>
      stroke("M14 84h72", { color: DIM(), width: 5 }) +
      shimmerSet([20, 38, 56, 74].map((x, i) => rect(x, 76 - [30, 52, 38, 62][i], 12, [30, 52, 38, 62][i], 4, i % 2 ? A2() : A())), { dur: 2.4 })
  },
  {
    id: "anim-icon-pie-draw", label: "Pie icon · draw", motion: "draw", style: "duotone",
    // The slice sweeps out from 12 o'clock; every value keeps the same command
    // string and stays under 180°, so the large-arc flag never has to flip
    // mid-animation — which is what turns a `d` interpolation into a jump.
    build: () =>
      circle(50, 50, 34, DIM(), { opacity: "0.28" }) +
      morphPath(
        [
          "M50 50L50 16A34 34 0 0 1 52.96 15.87Z",
          "M50 50L50 16A34 34 0 0 1 76.05 28.14Z",
          "M50 50L50 16A34 34 0 0 1 83.48 55.9Z",
          "M50 50L50 16A34 34 0 0 1 67 79.44Z"
        ],
        A(),
        { dur: 3.4 }
      ) +
      ring(50, 50, 34, A2(), 5)
  },
  {
    id: "anim-icon-wave-morph", label: "Wave icon · morph", motion: "morph", style: "duotone",
    build: () =>
      morphPath(["M8 56c12-16 24-16 36 0s24 16 36 0", "M8 44c12 16 24 16 36 0s24-16 36 0"], A(), { kind: "stroke", dur: 3 }) +
      morphPath(["M8 74c12-16 24-16 36 0s24 16 36 0", "M8 62c12 16 24 16 36 0s24-16 36 0"], A2(), { kind: "stroke", dur: 3, width: 6 })
  },
  {
    id: "anim-icon-camera-pulse", label: "Camera icon · pulse", motion: "pulse", style: "duotone",
    build: () =>
      rectS(10, 28, 80, 54, 10, A(), 7) + fill("M36 28 42 18h16l6 10Z", A()) +
      pulse(ring(50, 55, 16, A2(), 7), { dur: 2.2, lo: 0.88, hi: 1.08, cx: 50, cy: 55 })
  },
  {
    id: "anim-icon-video-pulse", label: "Video icon · pulse", motion: "pulse", style: "duotone",
    build: () => rectS(10, 28, 56, 44, 9, A(), 7) + pulse(fill("M72 38 90 28v44L72 62Z", A2()), { dur: 2, lo: 0.9, hi: 1.06, cx: 81, cy: 50 })
  },
  {
    id: "anim-icon-mic-pulse", label: "Mic icon · pulse", motion: "pulse", style: "duotone",
    build: () =>
      rect(38, 10, 24, 44, 12, A()) +
      pulse(stroke("M26 46a24 24 0 0 0 48 0", { color: A2() }), { dur: 1.8, lo: 0.9, hi: 1.08, cx: 50, cy: 46 }) +
      stroke("M50 70v16M36 88h28", { color: A() })
  },
  {
    id: "anim-icon-speaker-pulse", label: "Speaker icon · pulse", motion: "pulse", style: "duotone",
    build: () =>
      fill("M16 38h14L52 18v64L30 62H16Z", A()) +
      shimmerSet([stroke("M64 38a16 16 0 0 1 0 24", { color: A2() }), stroke("M76 28a32 32 0 0 1 0 44", { color: A3() })], { dur: 1.8 })
  },
  {
    id: "anim-icon-headset-float", label: "Headset icon · float", motion: "float", style: "duotone",
    build: () =>
      float(stroke("M20 60V50a30 30 0 0 1 60 0v10", { color: A() }) + rect(12, 56, 18, 26, 8, A2()) + rect(70, 56, 18, 26, 8, A2()), { dur: 3.6, amp: 3 })
  },
  {
    id: "anim-icon-cursor-float", label: "Cursor icon · float", motion: "float", style: "solid",
    build: () => float(fill("M26 14 74 46 52 52 44 78Z", A()) + fill("M52 52 74 78 66 84 46 60Z", A3()), { dur: 3, amp: 4, axis: "x" })
  },
  {
    id: "anim-icon-pointer-morph", label: "Pointer icon · morph", motion: "morph", style: "solid",
    build: () => morphPath(["M26 14 76 46 52 52 44 80Z", "M26 14 68 40 48 48 40 72Z"], A(), { dur: 2.6 })
  },
  {
    id: "anim-icon-pen-draw", label: "Pen icon · draw", motion: "draw", style: "duotone",
    build: () => fill("M70 12 88 30 40 78 16 84 22 60Z", A(), { opacity: "0.9" }) + drawOn(["M22 60 40 78"], { color: A2(), dur: 2.4, len: 20, gap: 60, width: 6 })
  },
  {
    id: "anim-icon-brush-draw", label: "Brush icon · draw", motion: "draw", style: "duotone",
    build: () =>
      fill("M62 10 90 38 54 74 26 46Z", A()) + fill("M26 46 12 88l42-14Z", A3()) +
      drawOn(["M20 80c8-4 12-8 14-14"], { color: A2(), dur: 2.2, len: 14, gap: 40, width: 5 })
  },
  {
    id: "anim-icon-scissors-morph", label: "Scissors icon · morph", motion: "morph", style: "duotone",
    // Each blade is hole-plus-edge in one group, rocking about the pivot the
    // two edges actually cross at (50,50) — so the shape opens and closes
    // instead of the holes sliding off the ends of their own blades.
    build: () => {
      const rock = (deg, inner, begin) =>
        `<g><animateTransform attributeName="transform" attributeType="XML" type="rotate" ` +
        `values="${-deg} 50 50;${deg} 50 50;${-deg} 50 50" dur="2.4s" begin="${begin}" repeatCount="indefinite"/>${inner}</g>`;
      return (
        rock(5, ring(25, 25, 12, A(), 6) + stroke("M33.8 33.8 83.3 83.3", { color: A() }), "0s") +
        rock(5, ring(25, 75, 12, A2(), 6) + stroke("M33.8 66.2 83.3 16.7", { color: A2() }), "-1.2s")
      );
    }
  },
  {
    id: "anim-icon-magnet-flicker", label: "Magnet icon · flicker", motion: "flicker", style: "duotone",
    build: () =>
      stroke("M24 76V46a26 26 0 0 1 52 0v30", { color: A(), width: 14 }) +
      stroke("M24 76h14M62 76h14", { color: A3(), width: 14 }) +
      flicker(circle(50, 20, 6, A2()) + circle(30, 30, 4, A2()) + circle(70, 30, 4, A2()), { dur: 1.6 })
  },
  {
    id: "anim-icon-anchor-float", label: "Anchor icon · float", motion: "float", style: "line",
    build: () =>
      float(ring(50, 20, 10, A(), 7) + stroke("M50 30v52M30 46h40", { color: A() }) + stroke("M16 58a34 34 0 0 0 68 0", { color: A2() }), { dur: 4, amp: 4 })
  },
  {
    id: "anim-icon-plug-flicker", label: "Plug icon · flicker", motion: "flicker", style: "duotone",
    build: () =>
      stroke("M38 12v22M62 12v22", { color: A() }) + rectS(28, 34, 44, 26, 8, A(), 7) +
      flicker(stroke("M50 60v18a10 10 0 0 0 10 10h12", { color: A2() }) + circle(84, 88, 6, A3()), { dur: 1.5 })
  },
  {
    id: "anim-icon-shuffle-morph", label: "Shuffle icon · morph", motion: "morph", style: "duotone",
    build: () =>
      morphPath(["M14 28h18c18 0 22 44 40 44h14", "M14 28h18c18 0 22 30 40 30h14"], A(), { kind: "stroke", dur: 3 }) +
      morphPath(["M14 72h18c18 0 22-44 40-44h14", "M14 72h18c18 0 22-30 40-30h14"], A2(), { kind: "stroke", dur: 3 }) +
      fill("M76 18 92 28 76 38Z", A2()) + fill("M76 62 92 72 76 82Z", A())
  },
  {
    id: "anim-icon-branch-draw", label: "Branch icon · draw", motion: "draw", style: "duotone",
    build: () =>
      circle(28, 20, 9, A()) + circle(28, 82, 9, A()) + circle(72, 46, 9, A3()) +
      drawOn(["M28 29v44", "M28 52h20a16 16 0 0 0 16-15"], { color: A2(), dur: 3, len: 26, gap: 120, width: 6 })
  },
  {
    id: "anim-icon-commit-orbit", label: "Commit icon · orbit", motion: "orbit", style: "duotone",
    build: () =>
      stroke("M10 50h24M66 50h24", { color: DIM(), width: 6 }) + ring(50, 50, 16, A(), 8) +
      orbitDot(circlePath(50, 50, 16), 5, A2(), { dur: 3 })
  },
  {
    id: "anim-icon-package-float", label: "Package icon · float", motion: "float", style: "duotone",
    build: () =>
      float(
        fill("M50 10 88 30 50 50 12 30Z", A()) +
          stroke("M12 30v40l38 20V50", { color: A2() }) +
          stroke("M88 30v40L50 90", { color: A3() }),
        { dur: 3.8, amp: 4 }
      )
  },
  {
    id: "anim-icon-cube-spin", label: "Cube icon · spin", motion: "spin", style: "duotone",
    build: () =>
      spin(fill("M50 8 88 30 50 52 12 30Z", A()) + fill("M12 30 50 52v40L12 70Z", A3(), { opacity: "0.85" }) + fill("M88 30 50 52v40l38-22Z", A2(), { opacity: "0.85" }), { dur: 8 })
  }
].map((s) => ({
  ...s,
  category: "animated-icon",
  size: 32,
  shape: "square",
  animated: true,
  dir: "animated-icons",
  tags: ["icon", "animated", s.motion, "extension"]
}));

if (ANIMATED_ICONS.length !== 50) {
  throw new Error(`ext-icons: expected 50 animated icons, have ${ANIMATED_ICONS.length}`);
}

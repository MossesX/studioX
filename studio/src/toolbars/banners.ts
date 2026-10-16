/**
 * @file Banner toolbars for the `app.banner` surface.
 *
 * Three candidates rather than one, because a single registered asset makes
 * "hot-swappable" an untested claim. With three, cycling is a real operation
 * with a visible result, and the slot contract is exercised by bars that use
 * different subsets of it.
 *
 * All three carry the brand at **340px** — 2.5× the 124-168px each surface had
 * hand-picked. That number lives here, once, which is the entire point of the
 * bar being an asset.
 */
import { defineToolbar } from "@axf/core";

/** The default: brand, surface name, host context, then right-aligned status. */
export const BANNER_STANDARD = defineToolbar({
  id: "banner-standard",
  title: "Standard banner",
  role: "banner",
  surface: "app.banner",
  description: "Brand at full width, surface name, host context, status at the right.",
  // 340-wide lockup is 54 tall on its own aspect; the bar has to contain it.
  height: 62,
  background: "panel2",
  items: [
    { kind: "brand", id: "brand", glyph: "lockup", width: 340 },
    { kind: "label", id: "surface", text: "", tone: "dim" },
    { kind: "divider", id: "d1" },
    { kind: "slot", id: "context" },
    { kind: "spacer", id: "sp" },
    { kind: "slot", id: "tools" },
    { kind: "status", id: "state", tone: "warn" }
  ]
});

/** Compact: shorter bar, no divider, for surfaces that need vertical room. */
export const BANNER_COMPACT = defineToolbar({
  id: "banner-compact",
  title: "Compact banner",
  role: "banner",
  surface: "app.banner",
  description: "Same 340 brand, tighter padding and no divider — for dense screens.",
  height: 58,
  background: "panel",
  items: [
    { kind: "brand", id: "brand", glyph: "lockup", width: 340 },
    { kind: "slot", id: "context" },
    { kind: "spacer", id: "sp" },
    { kind: "slot", id: "tools" },
    { kind: "status", id: "state", tone: "dim" }
  ]
});

/** Mark-led: the square mark instead of the lockup, name spelled out as a label. */
export const BANNER_MARK = defineToolbar({
  id: "banner-mark",
  title: "Mark-led banner",
  role: "banner",
  surface: "app.banner",
  description: "Square mark plus a typeset name — for narrow windows.",
  height: 36,
  background: "page",
  items: [
    { kind: "brand", id: "brand", glyph: "mark", width: 26 },
    { kind: "label", id: "name", text: "AmberX Studio", tone: "ink", caps: false },
    { kind: "divider", id: "d1" },
    { kind: "slot", id: "context" },
    { kind: "spacer", id: "sp" },
    { kind: "slot", id: "tools" },
    { kind: "status", id: "state", tone: "dim" }
  ]
});

export const BANNERS = [BANNER_STANDARD, BANNER_COMPACT, BANNER_MARK];

/**
 * @file The tools AmberArt itself provides.
 *
 * The built-ins, declared as data so the rail renders from a list rather than
 * one hand-written button each. Contributed tools arrive separately, through the
 * declared `amberart.tool` point (`host.ts`), and the rail draws both from the
 * same shape — which is what stops a plugin's tool looking like a second-class
 * citizen next to the brush.
 *
 * Every glyph here is in the pack's own icon vocabulary (`packs/glyph-kit.ts`);
 * `eraser`, `line`, `rect`, `ellipse`, `fill` and `picker` were ADDED to that
 * kit for this module rather than drawn locally, so they recolour with the
 * theme and every pack has them. `marquee`, `lasso` and `wand` joined them for
 * the selection engine on the same terms.
 *
 * Move leads the rail and the selection tools follow, as they do in Photoshop:
 * they are what a person reaches for BEFORE a brush, and a rail whose order
 * argues with thirty years of muscle memory is a rail people misclick.
 */

export interface BuiltinTool {
  readonly id: string;
  readonly title: string;
  /** A branding-pack glyph id. */
  readonly glyph: string;
}

/**
 * The tools that make a REGION rather than pixels.
 *
 * Named as a set because the pointer handlers branch on it in three places
 * (a selection drag must not push an undo entry, must not paint, and must not
 * be refused when the active layer is hidden — a hidden layer is still a
 * perfectly good thing to select over).
 */
export const SELECTION_TOOLS: readonly string[] = ["marquee", "lasso", "wand"];

export const isSelectionTool = (id: string): boolean => SELECTION_TOOLS.includes(id);

export const BUILTIN_TOOLS: readonly BuiltinTool[] = [
  { id: "move", title: "Move", glyph: "icon-move" },
  { id: "marquee", title: "Marquee", glyph: "icon-marquee" },
  { id: "lasso", title: "Lasso", glyph: "icon-lasso" },
  { id: "wand", title: "Magic wand", glyph: "icon-wand" },
  { id: "brush", title: "Brush", glyph: "icon-brush" },
  { id: "eraser", title: "Eraser", glyph: "icon-eraser" },
  { id: "line", title: "Line", glyph: "icon-line" },
  { id: "rect", title: "Rectangle", glyph: "icon-rect" },
  { id: "ellipse", title: "Ellipse", glyph: "icon-ellipse" },
  { id: "fill", title: "Fill", glyph: "icon-fill" },
  { id: "picker", title: "Picker", glyph: "icon-picker" },
  /* Type sits late in the rail in Photoshop too — below the brushes and the
     fills, above the view tools. Appended rather than slotted next to the
     shapes for the same reason the order above is what it is: everything that
     was already here keeps the position a hand has learned. */
  { id: "text", title: "Text", glyph: "icon-text" },
  /* The two fills. Photoshop keeps the gradient beside the paint bucket, and
     `fill` is four rows up — but appended is still right, by the rule the row
     above states: a rail people have already learned does not get re-sorted for
     tidiness. They sit together instead, which is the half of the adjacency
     that was worth having. */
  { id: "gradient", title: "Gradient", glyph: "icon-gradient" },
  { id: "texture", title: "Texture", glyph: "icon-texture" },
  /* The two pixel-borrowing brushes. Photoshop keeps them together in one slot
     of its own rail, and they belong together here for a harder reason than
     tidiness: both paint with pixels that are ALREADY on the layer rather than
     with the colour swatch, so the swatch above means nothing while either is
     selected and a person who has just learned that about one has learned it
     about the other. */
  { id: "stamp", title: "Clone stamp", glyph: "icon-stamp" },
  { id: "smudge", title: "Smudge", glyph: "icon-smudge" },
  /* The view tool, last — Photoshop puts zoom at the foot of the rail too, and
     for a reason worth keeping: it is the one tool that cannot change a pixel,
     so a misclick on it costs nothing and it belongs furthest from the ones
     where a misclick costs an undo. */
  { id: "zoom", title: "Zoom", glyph: "icon-zoom" }
];

/**
 * The key that selects each tool — Photoshop's own letters, and the reason the
 * map lives HERE rather than in the keydown handler.
 *
 * The rail renders `Brush (B)` from it and the listener switches on it, so the
 * tooltip and the keyboard cannot disagree about what a key does. A letter that
 * appears twice is a GROUP: pressing it again walks to the next tool sharing it,
 * which is how Photoshop fits eighteen tools onto a dozen keys — `G` is the
 * gradient and then the texture, exactly as it is the gradient and then the
 * paint bucket there.
 *
 * Everything is upper case; the listener upper-cases what it receives, so Shift
 * is neither required nor refused.
 */
export const TOOL_KEYS: Readonly<Record<string, string>> = {
  move: "V",
  marquee: "M",
  lasso: "L",
  wand: "W",
  brush: "B",
  eraser: "E",
  /* Line, rect and ellipse deliberately have NO letter. Photoshop spends `U` on
     its shape group and this rail spends it on the smudge, and inventing three
     more letters for tools nobody reaches for mid-stroke would spend keys that
     a later phase may want for something a hand actually asks for. A tool with
     no key simply shows its plain title. */
  fill: "F",
  picker: "I",
  text: "T",
  gradient: "G",
  texture: "G",
  stamp: "S",
  smudge: "U",
  zoom: "Z"
};

/**
 * The tools a letter selects, in rail order — the group behind {@link TOOL_KEYS}.
 *
 * Derived rather than written out a second time: a hand-maintained inverse is a
 * second source of truth for the same fact, and the one that goes stale is
 * always the one nobody reads.
 */
export const TOOLS_BY_KEY: Readonly<Record<string, readonly string[]>> = BUILTIN_TOOLS.reduce<
  Record<string, string[]>
>((acc, tool) => {
  const key = TOOL_KEYS[tool.id];
  if (key) (acc[key] ??= []).push(tool.id);
  return acc;
}, {});

/** `Brush (B)` — the rail's tooltip, and the only place that string is built. */
export const toolTitle = (id: string, title: string): string => {
  const key = TOOL_KEYS[id];
  return key ? `${title} (${key})` : title;
};

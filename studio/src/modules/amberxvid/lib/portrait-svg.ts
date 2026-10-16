/**
 * @file The portrait SVG sanitizer — the security boundary between a language
 * model's output and `dangerouslySetInnerHTML`.
 *
 * Every existing avatar surface injects markup with `dangerouslySetInnerHTML`,
 * which was safe while the only producer was our own deterministic renderer.
 * An AI portrait is UNTRUSTED TEXT: it is generated from member-supplied
 * selections, stored in a profile, and then rendered inside every other
 * member's session. So it passes through here first.
 *
 * The posture is an **allowlist**, not a blocklist:
 *   - tag names must be in `ALLOWED_TAGS`; anything else (script,
 *     foreignObject, image, use, a, animate, set, iframe…) REJECTS the whole
 *     document rather than being quietly stripped — a portrait that wanted a
 *     script is not a portrait we want to store;
 *   - attributes must be in `ALLOWED_ATTRS`; unknown ones are dropped
 *     (harmless authoring noise), while any `on*` handler, `href`/`xlink:href`,
 *     or a `url(...)` pointing anywhere but a local `#id` rejects;
 *   - `<!DOCTYPE`, `<!ENTITY`, processing instructions and CDATA reject
 *     (entity-expansion and DTD tricks);
 *   - the root `<svg>` is REBUILT by us, so the viewBox contract every render
 *     site depends on cannot be altered by the model.
 *
 * Pure string work — no DOM, no node imports — so the route, the tests and
 * (if ever needed) the client all share exactly one implementation.
 */

import { PORTRAIT_SVG_MAX } from "./types";

/** The shared avatar geometry — every surface and the round crop assume it. */
export const PORTRAIT_VIEWBOX = "0 0 200 220";

const ALLOWED_TAGS = new Set([
  "svg", "g", "defs", "title", "desc",
  "path", "circle", "ellipse", "rect", "line", "polyline", "polygon",
  "linearGradient", "radialGradient", "stop",
  "clipPath", "mask", "pattern",
  "filter", "feGaussianBlur", "feBlend", "feColorMatrix", "feComposite",
  "feOffset", "feMerge", "feMergeNode", "feFlood", "feDropShadow",
  "feTurbulence", "feDisplacementMap", "feSpecularLighting", "feDiffuseLighting",
  "fePointLight", "feDistantLight", "feMorphology", "feTile",
  "text", "tspan",
]);

const ALLOWED_ATTRS = new Set([
  // structure / identity
  "id", "class", "transform", "viewBox", "xmlns", "version",
  // geometry
  "d", "cx", "cy", "r", "rx", "ry", "x", "y", "x1", "y1", "x2", "y2",
  "width", "height", "points", "dx", "dy", "offset", "pathLength",
  // paint
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity",
  "stroke-linecap", "stroke-linejoin", "stroke-dasharray", "stroke-dashoffset",
  "stroke-miterlimit", "opacity", "color", "stop-color", "stop-opacity",
  "clip-path", "clip-rule", "mask", "filter", "mix-blend-mode", "isolation",
  "paint-order", "vector-effect", "shape-rendering",
  // gradients / patterns
  "gradientUnits", "gradientTransform", "spreadMethod", "fx", "fy",
  "patternUnits", "patternContentUnits", "patternTransform",
  "maskUnits", "maskContentUnits", "clipPathUnits",
  // filters
  "filterUnits", "primitiveUnits", "in", "in2", "result", "stdDeviation",
  "mode", "type", "values", "operator", "k1", "k2", "k3", "k4",
  "baseFrequency", "numOctaves", "seed", "scale", "xChannelSelector",
  "yChannelSelector", "surfaceScale", "specularConstant", "specularExponent",
  "diffuseConstant", "azimuth", "elevation", "radius", "flood-color",
  "flood-opacity", "lighting-color",
  // text
  "font-family", "font-size", "font-weight", "font-style", "letter-spacing",
  "text-anchor", "dominant-baseline", "xml:space",
]);

/** Tags whose mere presence is a refusal, named so the error can say why. */
const HOSTILE_TAGS = new Set([
  "script", "foreignobject", "image", "use", "a", "animate", "animatetransform",
  "animatemotion", "set", "iframe", "embed", "object", "link", "meta", "style",
  "handler", "audio", "video", "canvas",
]);

export type SanitizeResult =
  | { ok: true; svg: string; stripped: string[] }
  | { ok: false; error: string };

/** Pull the SVG document out of whatever wrapper the model returned. */
export function extractSvg(raw: string): string | null {
  let text = (raw ?? "").trim();
  // Markdown fences are the most common wrapper even when the prompt forbids them.
  const fence = /```(?:svg|xml|html)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const start = text.search(/<svg[\s>]/i);
  if (start < 0) return null;
  const end = text.toLowerCase().lastIndexOf("</svg>");
  if (end < 0) return null;
  return text.slice(start, end + 6);
}

/**
 * Validate + normalize an AI-generated portrait SVG. Returns the rebuilt
 * document (our root element, the model's body) or a refusal reason.
 */
export function sanitizePortraitSvg(raw: string): SanitizeResult {
  // Doctype / entity / PI / CDATA are checked against the RAW answer, before
  // extraction: a DTD sits BEFORE `<svg` and would otherwise be sliced off
  // unseen, taking its `<!ENTITY>` declarations (billion-laughs, XXE) with it.
  // Their mere presence means the model ignored the contract — refuse and let
  // the route's corrective retry ask again.
  if (/<!DOCTYPE/i.test(raw)) return { ok: false, error: "DOCTYPE is not allowed" };
  if (/<!ENTITY/i.test(raw)) return { ok: false, error: "entity declarations are not allowed" };
  if (/<\?/.test(raw)) return { ok: false, error: "processing instructions are not allowed" };
  if (/<!\[CDATA\[/i.test(raw)) return { ok: false, error: "CDATA is not allowed" };

  const doc = extractSvg(raw);
  if (!doc) return { ok: false, error: "no <svg> document in the model's answer" };
  if (doc.length > PORTRAIT_SVG_MAX) {
    return { ok: false, error: `portrait is ${doc.length} chars — cap is ${PORTRAIT_SVG_MAX}` };
  }

  const stripped: string[] = [];
  let rootSeen = false;
  let body = "";
  let refusal: string | null = null;

  // Walk tags in order. Text between tags is copied verbatim (it can only be
  // character data — every `<` starts a tag we have already classified).
  const tagRe = /<\/?\s*([A-Za-z][-A-Za-z0-9:]*)((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g;
  let cursor = 0;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(doc)) !== null) {
    const [full, rawName, rawAttrs] = m;
    const name = rawName;
    const lower = name.toLowerCase();
    const closing = full.startsWith("</");
    const selfClosing = /\/\s*>$/.test(full);

    // Character data before this tag.
    const between = doc.slice(cursor, m.index);
    cursor = m.index + full.length;

    if (HOSTILE_TAGS.has(lower)) {
      refusal = `<${lower}> is forbidden in a portrait`;
      break;
    }
    const canonical = [...ALLOWED_TAGS].find((t) => t.toLowerCase() === lower);
    if (!canonical) {
      refusal = `unknown element <${name}>`;
      break;
    }

    if (lower === "svg") {
      // Our root, our contract — the model's root attributes are discarded.
      if (!closing) {
        if (rootSeen) {
          refusal = "nested <svg> is not allowed";
          break;
        }
        rootSeen = true;
      }
      continue; // neither the open nor the close tag enters the body
    }

    if (rootSeen) body += between;

    if (closing) {
      if (rootSeen) body += `</${canonical}>`;
      continue;
    }

    const attrCheck = sanitizeAttrs(rawAttrs ?? "");
    if (!attrCheck.ok) {
      refusal = attrCheck.error;
      break;
    }
    stripped.push(...attrCheck.stripped);
    if (rootSeen) body += `<${canonical}${attrCheck.attrs}${selfClosing ? "/" : ""}>`;
  }

  if (refusal) return { ok: false, error: refusal };
  if (!rootSeen) return { ok: false, error: "no <svg> root element" };
  if (!body.trim()) return { ok: false, error: "the portrait is empty" };

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${PORTRAIT_VIEWBOX}" ` +
    `width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${body}</svg>`;

  if (svg.length > PORTRAIT_SVG_MAX) {
    return { ok: false, error: `portrait is ${svg.length} chars — cap is ${PORTRAIT_SVG_MAX}` };
  }
  return { ok: true, svg, stripped: [...new Set(stripped)] };
}

function sanitizeAttrs(rawAttrs: string): { ok: true; attrs: string; stripped: string[] } | { ok: false; error: string } {
  const attrRe = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  const stripped: string[] = [];
  let out = "";
  let m: RegExpExecArray | null;

  while ((m = attrRe.exec(rawAttrs)) !== null) {
    const name = m[1];
    const lower = name.toLowerCase();
    const value = m[3] !== undefined ? m[3] : (m[4] ?? "");

    if (lower.startsWith("on")) return { ok: false, error: `event handler attribute "${name}"` };
    if (lower === "href" || lower === "xlink:href" || lower.endsWith(":href")) {
      return { ok: false, error: "href references are not allowed in a portrait" };
    }
    if (lower === "style") {
      // A style attribute can smuggle url()/expression(); the prompt asks for
      // presentation attributes and the model complies — drop, don't refuse.
      stripped.push("style");
      continue;
    }
    if (/javascript\s*:/i.test(value) || /data\s*:/i.test(value)) {
      return { ok: false, error: `"${name}" carries an inline URL scheme` };
    }
    // url(...) may only point at a local fragment.
    const urls = value.match(/url\(([^)]*)\)/gi) ?? [];
    for (const u of urls) {
      const inner = u.slice(4, -1).trim().replace(/^['"]|['"]$/g, "");
      if (!inner.startsWith("#")) return { ok: false, error: `"${name}" points url() outside the document` };
    }
    if (!ALLOWED_ATTRS.has(name) && !ALLOWED_ATTRS.has(lower)) {
      stripped.push(name);
      continue;
    }
    out += ` ${name}="${escapeAttr(value)}"`;
  }
  return { ok: true, attrs: out, stripped };
}

const escapeAttr = (v: string): string => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * @file A markdown parser that is correct WHILE THE TEXT IS STILL ARRIVING.
 *
 * `axf-claude` P3 asks for *"streaming markdown"* and forbids new dependencies,
 * so this is hand-written — and being hand-written is not the interesting
 * constraint. Streaming is.
 *
 * ── the streaming problem, and the three decisions it forced ─────────────────
 *
 * A markdown parser normally sees a finished document. Here it is re-run on
 * every delta against a prefix of one, so at any moment the last block is
 * probably truncated mid-syntax. Three things follow, and each is a place a
 * naive parser produces something worse than "not yet formatted":
 *
 *  1. **An unterminated fence is still a code block.** ```` ```ts ```` with no
 *     closing fence is the single most common state this parser is asked about,
 *     because a model writing code emits the opening fence and then streams for
 *     seconds. Treating it as literal text means every code block in the app
 *     flashes as raw prose — including its backticks — and then snaps into
 *     place. So an open fence consumes to the end of input and reports
 *     `closed: false`; the renderer can show it as code immediately.
 *  2. **A trailing partial inline marker renders as itself.** `**bol` is the
 *     text `**bol`, not an unclosed strong span swallowing everything after it.
 *     The inline scanner only accepts a delimiter it can find the mate of, so a
 *     half-typed `**` is punctuation until its partner arrives — no reflow, no
 *     flicker.
 *  3. **Block ids are STRUCTURAL, not positional.** A renderer keying blocks by
 *     array index remounts every block below an insertion; keying by content
 *     remounts a block on every keystroke inside it. Ids here are
 *     `<kind>:<ordinal-of-that-kind>`, so a paragraph stays the same node while
 *     its text grows and while blocks appear after it. That is what stops a
 *     `<pre>`'s scroll position and a text selection dying on every delta.
 *
 * ── what is deliberately NOT supported ───────────────────────────────────────
 *
 * Reference links (`[a][b]` + a definition elsewhere), footnotes, HTML blocks,
 * setext headings and nested block quotes beyond one level. Each is absent
 * because the corpus this renders is Claude's own prose, which uses none of
 * them, and because a parser that half-supports a construct is worse than one
 * that renders it as the text it is. Raw HTML in particular is emitted as TEXT,
 * never as markup: this model's output is arbitrary and a renderer that
 * interprets it is an injection sink.
 *
 * PURE and isomorphic — no React, no DOM, no node builtins. `Markdown.tsx`
 * turns the block model below into elements.
 */

/* ---------------------------------- spans ----------------------------------- */

export type MdSpan =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly spans: readonly MdSpan[] }
  | { readonly kind: "em"; readonly spans: readonly MdSpan[] }
  | { readonly kind: "strike"; readonly spans: readonly MdSpan[] }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "link"; readonly href: string; readonly spans: readonly MdSpan[] };

/* --------------------------------- blocks ----------------------------------- */

export interface MdListItem {
  readonly spans: readonly MdSpan[];
  /** `- [ ]` / `- [x]` — null when the item is not a task. */
  readonly checked: boolean | null;
  /** Nested list, indented under this item. */
  readonly children: MdBlock | null;
}

export type MdBlock =
  | { readonly kind: "paragraph"; readonly id: string; readonly spans: readonly MdSpan[] }
  | {
      readonly kind: "heading";
      readonly id: string;
      readonly level: 1 | 2 | 3 | 4 | 5 | 6;
      readonly spans: readonly MdSpan[];
    }
  | {
      readonly kind: "code";
      readonly id: string;
      readonly lang: string | null;
      readonly code: string;
      /** False while the closing fence has not arrived — the streaming case. */
      readonly closed: boolean;
    }
  | {
      readonly kind: "list";
      readonly id: string;
      readonly ordered: boolean;
      readonly start: number;
      readonly items: readonly MdListItem[];
    }
  | { readonly kind: "quote"; readonly id: string; readonly blocks: readonly MdBlock[] }
  | { readonly kind: "rule"; readonly id: string }
  | {
      readonly kind: "table";
      readonly id: string;
      readonly head: readonly (readonly MdSpan[])[];
      readonly rows: readonly (readonly (readonly MdSpan[])[])[];
      readonly align: readonly ("left" | "center" | "right" | null)[];
    };

/* --------------------------------- inline ----------------------------------- */

const ESCAPABLE = "\\`*_~[]()#+-.!>|";

/**
 * Parse inline markup.
 *
 * A hand-written scanner rather than a regex pipeline, because the rule that
 * matters — *only open a span whose closing delimiter is already present* — is
 * a lookahead, and a regex that tries to express it either backtracks
 * catastrophically or silently accepts the unclosed case.
 */
export function parseInline(source: string): MdSpan[] {
  const out: MdSpan[] = [];
  let text = "";
  let i = 0;

  const flush = () => {
    if (text) {
      out.push({ kind: "text", text });
      text = "";
    }
  };

  /** Index of `close` at or after `from`, skipping escaped occurrences. */
  const find = (close: string, from: number): number => {
    for (let at = from; at >= 0 && at < source.length; ) {
      const found = source.indexOf(close, at);
      if (found < 0) return -1;
      if (found > 0 && source[found - 1] === "\\") {
        at = found + 1;
        continue;
      }
      return found;
    }
    return -1;
  };

  while (i < source.length) {
    const ch = source[i]!;

    /* backslash escape — the only thing that can suppress a delimiter */
    if (ch === "\\" && i + 1 < source.length && ESCAPABLE.includes(source[i + 1]!)) {
      text += source[i + 1];
      i += 2;
      continue;
    }

    /* `code`, ``code with ` in it`` */
    if (ch === "`") {
      let ticks = 0;
      while (source[i + ticks] === "`") ticks++;
      const fence = "`".repeat(ticks);
      const close = source.indexOf(fence, i + ticks);
      if (close > 0) {
        flush();
        // The CommonMark strip: one leading and one trailing space, so
        // `` ` `` renders as a backtick rather than as a padded one.
        let code = source.slice(i + ticks, close);
        if (code.length > 1 && code.startsWith(" ") && code.endsWith(" ")) code = code.slice(1, -1);
        out.push({ kind: "code", text: code });
        i = close + ticks;
        continue;
      }
      text += fence;
      i += ticks;
      continue;
    }

    /* [label](href) and ![alt](src) — an image renders as its link, on purpose:
       the transcript must not fetch a URL the model chose. */
    if (ch === "[" || (ch === "!" && source[i + 1] === "[")) {
      const bang = ch === "!";
      const open = bang ? i + 1 : i;
      const labelEnd = find("]", open + 1);
      if (labelEnd > 0 && source[labelEnd + 1] === "(") {
        const hrefEnd = find(")", labelEnd + 2);
        if (hrefEnd > 0) {
          const href = source.slice(labelEnd + 2, hrefEnd).trim().split(/\s+/)[0] ?? "";
          flush();
          const label = source.slice(open + 1, labelEnd);
          out.push({ kind: "link", href, spans: parseInline(label || href) });
          i = hrefEnd + 1;
          continue;
        }
      }
      text += ch;
      i += 1;
      continue;
    }

    /* bare URLs — linkified so a model's citation is clickable */
    if ((ch === "h" || ch === "w") && /^(https?:\/\/|www\.)/.test(source.slice(i))) {
      const match = /^(?:https?:\/\/|www\.)[^\s<>()[\]"']+/.exec(source.slice(i));
      if (match) {
        // Trailing punctuation belongs to the sentence, not to the URL.
        const raw = match[0].replace(/[.,;:!?]+$/, "");
        flush();
        out.push({
          kind: "link",
          href: raw.startsWith("www.") ? `https://${raw}` : raw,
          spans: [{ kind: "text", text: raw }]
        });
        i += raw.length;
        continue;
      }
    }

    /* **strong**, __strong__, *em*, _em_, ~~strike~~ */
    const delim =
      source.startsWith("***", i)
        ? null // ambiguous nest — treated as strong+em by the two passes below
        : source.startsWith("**", i)
          ? "**"
          : source.startsWith("__", i)
            ? "__"
            : source.startsWith("~~", i)
              ? "~~"
              : ch === "*" || ch === "_"
                ? ch
                : null;
    if (delim) {
      const close = find(delim, i + delim.length);
      // A `_` inside a word is not emphasis — `snake_case_name` must survive.
      const intraword =
        (delim === "_" || delim === "__") && i > 0 && /\w/.test(source[i - 1] ?? "");
      if (close > i + delim.length && !intraword) {
        const inner = source.slice(i + delim.length, close);
        flush();
        const spans = parseInline(inner);
        out.push(
          delim === "**" || delim === "__"
            ? { kind: "strong", spans }
            : delim === "~~"
              ? { kind: "strike", spans }
              : { kind: "em", spans }
        );
        i = close + delim.length;
        continue;
      }
      // No mate yet: emit the delimiter as text. This is decision 2 in the
      // header — `**bol` while the model is still typing is `**bol`.
      text += delim;
      i += delim.length;
      continue;
    }

    text += ch;
    i += 1;
  }

  flush();
  return out;
}

/** Every character of a span tree, in order — what search and copy read. */
export function spansToText(spans: readonly MdSpan[]): string {
  return spans
    .map((s) => (s.kind === "text" ? s.text : s.kind === "code" ? s.text : spansToText(s.spans)))
    .join("");
}

/* ---------------------------------- blocks ---------------------------------- */

const FENCE_RE = /^(\s*)(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const RULE_RE = /^\s{0,3}(?:([-*_])\s*)(?:\1\s*){2,}$/;
const UL_RE = /^(\s*)([-*+])\s+(.*)$/;
const OL_RE = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const TABLE_DIVIDER_RE = /^\s*\|?(\s*:?-{1,}:?\s*\|)+(\s*:?-{1,}:?\s*)\|?\s*$/;

/** Mints `<kind>:<n>` ids — decision 3 in the header. */
function ids() {
  const counts = new Map<string, number>();
  return (kind: string): string => {
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    return `${kind}:${n}`;
  };
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === "\\" && trimmed[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (ch === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function alignOf(spec: string): "left" | "center" | "right" | null {
  const s = spec.trim();
  if (s.startsWith(":") && s.endsWith(":")) return "center";
  if (s.endsWith(":")) return "right";
  if (s.startsWith(":")) return "left";
  return null;
}

/**
 * Parse markdown into blocks.
 *
 * Line-oriented and single-pass. Every loop below consumes at least one line
 * before the next iteration — that is the invariant that makes this safe to run
 * on every delta of a streaming answer, where a subtly non-advancing branch
 * would be an infinite loop inside a render.
 */
export function parseMarkdown(source: string): MdBlock[] {
  const nextId = ids();
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (!line.trim()) {
      i++;
      continue;
    }

    /* ------------------------------------------------------------ fences */
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[2]!;
      const lang = fence[3] || null;
      const body: string[] = [];
      let closed = false;
      i++;
      while (i < lines.length) {
        const candidate = lines[i]!;
        // A closing fence is the same character, at least as long, alone.
        if (new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`).test(candidate)) {
          closed = true;
          i++;
          break;
        }
        body.push(candidate);
        i++;
      }
      blocks.push({
        kind: "code",
        id: nextId("code"),
        lang,
        // The trailing newline of the last line is the fence's, not the code's.
        code: body.join("\n"),
        closed
      });
      continue;
    }

    /* ---------------------------------------------------------- headings */
    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        id: nextId("heading"),
        level: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6,
        spans: parseInline(heading[2]!.replace(/\s+#+\s*$/, ""))
      });
      i++;
      continue;
    }

    /* ------------------------------------------------------------- rules */
    if (RULE_RE.test(line)) {
      blocks.push({ kind: "rule", id: nextId("rule") });
      i++;
      continue;
    }

    /* ------------------------------------------------------------ quotes */
    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && (QUOTE_RE.test(lines[i]!) || lines[i]!.trim())) {
        const m = QUOTE_RE.exec(lines[i]!);
        if (!m) {
          // A lazy continuation line — part of the quote's paragraph.
          if (!lines[i]!.trim()) break;
          inner.push(lines[i]!);
        } else {
          inner.push(m[1]!);
        }
        i++;
      }
      blocks.push({ kind: "quote", id: nextId("quote"), blocks: parseMarkdown(inner.join("\n")) });
      continue;
    }

    /* ------------------------------------------------------------ tables */
    if (line.includes("|") && i + 1 < lines.length && TABLE_DIVIDER_RE.test(lines[i + 1]!)) {
      const head = splitRow(line).map(parseInline);
      const align = splitRow(lines[i + 1]!).map(alignOf);
      i += 2;
      const rows: MdSpan[][][] = [];
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes("|")) {
        rows.push(splitRow(lines[i]!).map(parseInline));
        i++;
      }
      blocks.push({ kind: "table", id: nextId("table"), head, rows, align });
      continue;
    }

    /* ------------------------------------------------------------- lists */
    const bullet = UL_RE.exec(line);
    const ordered = OL_RE.exec(line);
    if (bullet || ordered) {
      const first = (bullet ?? ordered)!;
      const baseIndent = first[1]!.length;
      const isOrdered = Boolean(ordered);
      const start = ordered ? Number(ordered[2]) : 1;
      const items: MdListItem[] = [];

      while (i < lines.length) {
        const current = lines[i]!;
        if (!current.trim()) {
          // A blank line ends the list unless another item follows it.
          const after = lines[i + 1] ?? "";
          const continues = UL_RE.test(after) || OL_RE.test(after);
          if (!continues) break;
          i++;
          continue;
        }
        const m = (isOrdered ? OL_RE : UL_RE).exec(current) ?? UL_RE.exec(current) ?? OL_RE.exec(current);
        if (!m) break;
        const indent = m[1]!.length;
        if (indent < baseIndent) break;
        if (indent > baseIndent) {
          // Deeper than the current level — gather it and recurse, attaching
          // the result to the item that opened it.
          const nested: string[] = [];
          while (i < lines.length && (lines[i]!.trim() === "" || /^\s+/.test(lines[i]!))) {
            const inner = lines[i]!;
            if (!inner.trim() && !/^\s*[-*+\d]/.test(lines[i + 1] ?? "")) break;
            nested.push(inner.slice(baseIndent + 2));
            i++;
          }
          const children = parseMarkdown(nested.join("\n"));
          const last = items[items.length - 1];
          if (last) items[items.length - 1] = { ...last, children: children[0] ?? null };
          continue;
        }

        let body = m[3]!;
        let checked: boolean | null = null;
        const task = /^\[([ xX])\]\s+(.*)$/.exec(body);
        if (task) {
          checked = task[1]!.toLowerCase() === "x";
          body = task[2]!;
        }
        items.push({ spans: parseInline(body), checked, children: null });
        i++;
      }

      blocks.push({ kind: "list", id: nextId("list"), ordered: isOrdered, start, items });
      continue;
    }

    /* --------------------------------------------------------- paragraph */
    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim()) {
      const current = lines[i]!;
      // A paragraph ends the moment another block opens, or the next line would
      // be swallowed and the block below it would never be parsed.
      if (
        paragraph.length &&
        (FENCE_RE.test(current) ||
          HEADING_RE.test(current) ||
          RULE_RE.test(current) ||
          QUOTE_RE.test(current) ||
          UL_RE.test(current) ||
          OL_RE.test(current))
      ) {
        break;
      }
      paragraph.push(current);
      i++;
    }
    blocks.push({
      kind: "paragraph",
      id: nextId("paragraph"),
      // A hard break is two trailing spaces; everything else is a soft wrap and
      // joins with a space, which is how markdown reflows.
      spans: parseInline(
        paragraph.map((l) => (l.endsWith("  ") ? `${l.trimEnd()}\n` : l.trim())).join(" ").replace(/\n /g, "\n")
      )
    });
  }

  return blocks;
}

/** Every code block in a document, in order — what "copy all code" reads. */
export function codeBlocksOf(blocks: readonly MdBlock[]): { lang: string | null; code: string }[] {
  const out: { lang: string | null; code: string }[] = [];
  const walk = (list: readonly MdBlock[]): void => {
    for (const block of list) {
      if (block.kind === "code") out.push({ lang: block.lang, code: block.code });
      else if (block.kind === "quote") walk(block.blocks);
    }
  };
  walk(blocks);
  return out;
}

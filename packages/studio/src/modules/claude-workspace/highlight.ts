/**
 * @file Syntax highlighting, hand-written, because P3 says *"syntax-highlighted
 * code"* and *"NO NEW DEPENDENCIES without asking"*.
 *
 * ── what this is, stated honestly ────────────────────────────────────────────
 *
 * A LEXER, not a parser. It knows about comments, strings, numbers, keywords
 * and punctuation, and it does not know about scope, types or semantics. That
 * is a real ceiling and it is the right one: the alternative — a per-language
 * grammar — is where a hand-rolled highlighter turns into a dependency someone
 * should have asked for.
 *
 * What it therefore gets WRONG, so nobody debugs it twice:
 *
 *   - a keyword used as a property name (`obj.class`) is coloured as a keyword;
 *   - a regex literal in JS is read as division followed by a string when it
 *     contains a quote — the classic lexer ambiguity that genuinely needs a
 *     parser to resolve;
 *   - a language it does not know highlights as `plain`, which is the correct
 *     failure: uncoloured code is readable, mis-coloured code is worse than
 *     uncoloured.
 *
 * ── why it is table-driven ───────────────────────────────────────────────────
 *
 * Ten hand-written scanners would be ten places for the same string-escape bug.
 * There is ONE scanner and a {@link LangSpec} per language, so adding a
 * language is data. The spec carries only what actually differs between them:
 * the comment markers, the string delimiters, whether `#` starts a comment,
 * and the keyword sets.
 *
 * PURE — no React, no DOM. `CodeBlock.tsx` paints the tokens.
 */

export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  /** A second keyword tier: types, builtins, constants — coloured differently
   *  because in most languages they read as a different KIND of word. */
  | "type"
  | "function"
  | "punct"
  | "meta"
  /** Unified-diff lines. Their own kinds rather than borrowed colours: a
   *  deleted line coloured through `keyword` would change meaning the day the
   *  keyword colour changes, and a reader cannot tell a borrowed colour from an
   *  intended one. */
  | "added"
  | "removed";

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

interface LangSpec {
  readonly lineComment?: readonly string[];
  readonly blockComment?: readonly [string, string];
  /** Quote characters that open a string. */
  readonly quotes?: readonly string[];
  /** Template literals: backtick strings that may span lines. */
  readonly template?: boolean;
  /** Triple-quoted strings (python). */
  readonly tripleQuotes?: boolean;
  readonly keywords?: readonly string[];
  readonly types?: readonly string[];
  /** `#!/usr/bin/env` and `#[attr]`-style lines, coloured as meta. */
  readonly hashMeta?: boolean;
  readonly caseInsensitive?: boolean;
}

const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);

const JS_KEYWORDS = words(`
  as async await break case catch class const continue debugger default delete do else enum export
  extends false finally for from function get if implements import in instanceof interface let new
  null of package private protected public return satisfies set static super switch this throw true
  try typeof var void while with yield keyof infer readonly declare namespace type abstract override
`);
const JS_TYPES = words(`
  Array Boolean Date Error Function JSON Map Math Number Object Promise Proxy RegExp Set String Symbol
  WeakMap WeakSet BigInt any bigint boolean never number object string symbol undefined unknown void
  console document window globalThis process require module exports
`);

const PY_KEYWORDS = words(`
  and as assert async await break class continue def del elif else except finally for from global if
  import in is lambda nonlocal not or pass raise return try while with yield match case
`);
const PY_TYPES = words(`
  None True False self cls int float str bytes bool list dict set tuple frozenset object type print
  len range enumerate zip open super isinstance Exception ValueError TypeError KeyError
`);

const SH_KEYWORDS = words(`
  if then elif else fi for while until do done case esac function in select time coproc return break
  continue local export readonly declare set unset shift source eval exec trap
`);
const SH_TYPES = words(`
  echo cd ls cat grep sed awk find rm cp mv mkdir touch chmod chown curl wget git npm node python pip
  test printf read exit sleep kill ps env which head tail sort uniq wc xargs tee diff tar
`);

const SQL_KEYWORDS = words(`
  select from where group by having order limit offset insert into values update set delete create
  table alter drop index view join inner left right outer full on as distinct union all and or not
  null is in between like exists case when then else end primary key foreign references default
`);

const CSS_KEYWORDS = words(`
  important media supports keyframes import charset font-face namespace supports layer container
`);

const LANGS: Record<string, LangSpec> = {
  plain: {},
  ts: {
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    template: true,
    keywords: JS_KEYWORDS,
    types: JS_TYPES
  },
  json: { quotes: ['"'], keywords: ["true", "false", "null"] },
  py: {
    lineComment: ["#"],
    quotes: ['"', "'"],
    tripleQuotes: true,
    keywords: PY_KEYWORDS,
    types: PY_TYPES
  },
  sh: { lineComment: ["#"], quotes: ['"', "'"], keywords: SH_KEYWORDS, types: SH_TYPES },
  css: { blockComment: ["/*", "*/"], quotes: ['"', "'"], keywords: CSS_KEYWORDS, hashMeta: false },
  sql: {
    lineComment: ["--"],
    blockComment: ["/*", "*/"],
    quotes: ["'", '"'],
    keywords: SQL_KEYWORDS,
    caseInsensitive: true
  },
  yaml: { lineComment: ["#"], quotes: ['"', "'"], keywords: ["true", "false", "null", "yes", "no"] },
  go: {
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    template: true,
    keywords: words(`
      break case chan const continue default defer else fallthrough for func go goto if import
      interface map package range return select struct switch type var
    `),
    types: words(`
      bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string
      uint uint8 uint16 uint32 uint64 uintptr nil true false make new len cap append copy panic recover
    `)
  },
  rust: {
    lineComment: ["//"],
    blockComment: ["/*", "*/"],
    quotes: ['"', "'"],
    hashMeta: true,
    keywords: words(`
      as async await break const continue crate dyn else enum extern false fn for if impl in let loop
      match mod move mut pub ref return self Self static struct super trait true type unsafe use where while
    `),
    types: words(`
      bool char f32 f64 i8 i16 i32 i64 i128 isize str u8 u16 u32 u64 u128 usize String Vec Option
      Result Box Some None Ok Err
    `)
  },
  html: { blockComment: ["<!--", "-->"], quotes: ['"', "'"] },
  diff: {}
};

/**
 * Fence label → spec key. Aliases are data because a model writes whichever
 * label it likes for the same language, and a `tsx` block rendering plain while
 * the `ts` block above it is coloured looks like a bug in the highlighter.
 */
const ALIASES: Record<string, string> = {
  javascript: "ts", js: "ts", jsx: "ts", mjs: "ts", cjs: "ts",
  typescript: "ts", tsx: "ts", ts: "ts",
  json5: "json", jsonc: "json", json: "json",
  python: "py", py: "py", python3: "py",
  bash: "sh", sh: "sh", shell: "sh", zsh: "sh", console: "sh", terminal: "sh", powershell: "sh", ps1: "sh",
  css: "css", scss: "css", less: "css",
  sql: "sql", postgres: "sql", mysql: "sql", sqlite: "sql",
  yaml: "yaml", yml: "yaml", toml: "yaml", ini: "yaml",
  go: "go", golang: "go",
  rust: "rust", rs: "rust",
  html: "html", xml: "html", svg: "html", vue: "html",
  diff: "diff", patch: "diff",
  text: "plain", txt: "plain", plaintext: "plain", log: "plain", md: "plain", markdown: "plain"
};

/** The spec key a fence label resolves to — `plain` for anything unknown. */
export function languageKey(lang: string | null | undefined): string {
  if (!lang) return "plain";
  return ALIASES[lang.trim().toLowerCase()] ?? "plain";
}

/** True when the label names a language this file can actually colour. Used by
 *  the UI to say "ts" rather than implying it highlighted something it did not. */
export function isKnownLanguage(lang: string | null | undefined): boolean {
  return languageKey(lang) !== "plain";
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/**
 * Tokenise one source string.
 *
 * Adjacent tokens of the same kind are merged before returning, which matters
 * more than it sounds: a renderer emits one element per token, and un-merged
 * output is one `<span>` per character of punctuation on a 400-line file.
 */
export function tokenize(source: string, lang: string | null | undefined): Token[] {
  const key = languageKey(lang);
  if (key === "diff") return tokenizeDiff(source);
  // An unknown language is ONE plain token, not a scan with every table empty.
  // The header promises "uncoloured rather than mis-coloured", and running the
  // generic scanner would still colour numbers and punctuation — which is a
  // guess about a grammar nobody here knows, and makes the promise false. It is
  // also the fast path a pasted 4,000-line log takes.
  if (key === "plain") return source ? [{ kind: "plain", text: source }] : [];
  const spec = LANGS[key] ?? LANGS.plain!;
  const keywords = new Set(spec.keywords ?? []);
  const types = new Set(spec.types ?? []);
  const raw: Token[] = [];
  const push = (kind: TokenKind, text: string) => {
    if (text) raw.push({ kind, text });
  };

  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const ch = source[i]!;

    /* whitespace — its own plain run, never merged into a word */
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      const m = /^\s+/.exec(rest)!;
      push("plain", m[0]);
      i += m[0].length;
      continue;
    }

    /* line comments */
    const line = (spec.lineComment ?? []).find((marker) => rest.startsWith(marker));
    if (line) {
      const end = source.indexOf("\n", i);
      const text = end < 0 ? rest : source.slice(i, end);
      push("comment", text);
      i += text.length;
      continue;
    }

    /* block comments */
    if (spec.blockComment && rest.startsWith(spec.blockComment[0])) {
      const [open, close] = spec.blockComment;
      const end = source.indexOf(close, i + open.length);
      // An unterminated block comment runs to the end — the streaming case
      // again, and colouring it as a comment is right in both readings.
      const text = end < 0 ? rest : source.slice(i, end + close.length);
      push("comment", text);
      i += text.length;
      continue;
    }

    /* `#!/…` shebangs and `#[attr]` */
    if (spec.hashMeta && ch === "#") {
      const end = source.indexOf("\n", i);
      const text = end < 0 ? rest : source.slice(i, end);
      push("meta", text);
      i += text.length;
      continue;
    }

    /* triple-quoted strings (python docstrings) */
    if (spec.tripleQuotes && (rest.startsWith('"""') || rest.startsWith("'''"))) {
      const marker = rest.slice(0, 3);
      const end = source.indexOf(marker, i + 3);
      const text = end < 0 ? rest : source.slice(i, end + 3);
      push("string", text);
      i += text.length;
      continue;
    }

    /* strings and templates */
    const quote = (spec.quotes ?? []).includes(ch) ? ch : spec.template && ch === "`" ? "`" : null;
    if (quote) {
      let j = i + 1;
      let closed = false;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === quote) {
          j++;
          closed = true;
          break;
        }
        // A single-quote string does not cross a line break — that is what
        // keeps an apostrophe in a comment-free prose line from swallowing the
        // rest of the file.
        if (source[j] === "\n" && quote !== "`" && !spec.tripleQuotes) break;
        j++;
      }
      const text = source.slice(i, closed ? j : Math.min(j, source.length));
      push("string", text);
      i += text.length || 1;
      continue;
    }

    /* numbers */
    if (DIGIT.test(ch) || (ch === "." && DIGIT.test(source[i + 1] ?? ""))) {
      const m = /^(0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?)[a-zA-Z]*/.exec(rest);
      if (m) {
        push("number", m[0]);
        i += m[0].length;
        continue;
      }
    }

    /* identifiers, keywords, types, call sites */
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < source.length && IDENT_PART.test(source[j]!)) j++;
      const word = source.slice(i, j);
      const probe = spec.caseInsensitive ? word.toLowerCase() : word;
      const isCall = /^\s*\(/.test(source.slice(j));
      push(
        keywords.has(probe)
          ? "keyword"
          : types.has(probe)
            ? "type"
            : isCall
              ? "function"
              : "plain",
        word
      );
      i = j;
      continue;
    }

    /* everything else is punctuation */
    push("punct", ch);
    i += 1;
  }

  /* merge adjacent same-kind runs */
  const merged: Token[] = [];
  for (const token of raw) {
    const last = merged[merged.length - 1];
    if (last && last.kind === token.kind) merged[merged.length - 1] = { kind: last.kind, text: last.text + token.text };
    else merged.push(token);
  }
  return merged;
}

/**
 * A unified diff, coloured by LINE rather than by token.
 *
 * Its own function because a diff's meaning is entirely positional: the first
 * character of a line decides everything, and running the generic lexer over it
 * would colour the `-` of a deleted line as an operator and tell the reader
 * nothing. Kept in this file rather than in `diff.ts` because it is a
 * highlighter for text a model pasted, whereas `diff.ts` COMPUTES diffs from
 * tool inputs.
 */
function tokenizeDiff(source: string): Token[] {
  const out: Token[] = [];
  for (const line of source.split(/(?<=\n)/)) {
    const head = line[0];
    out.push({
      kind:
        // The file headers are checked FIRST: `---` also starts with `-`, and
        // reading a header as a deletion is the one mistake a diff highlighter
        // is guaranteed to make if it tests the single characters first.
        line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")
          ? "meta"
          : head === "+"
            ? "added"
            : head === "-"
              ? "removed"
              : "plain",
      text: line
    });
  }
  return out;
}

/**
 * @file The export suite — pure conversions plus the one browser download
 * helper. Used by the context-menu commands AND the Data panel's buttons, so
 * "Export as CSV" means the same bytes from either surface.
 */
"use client";

import type { Dataset, FireDoc, StepOutput } from "./types";

/** Trigger a browser download of `content` as `filename`. */
export function download(filename: string, content: string, mime: string): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  // Revoke on the next tick — revoking synchronously races the click in
  // some engines and yields an empty file.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A dataset name turned into a safe filename stem. */
export function fileStem(name: string): string {
  return name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "dataset";
}

/* ── conversions ─────────────────────────────────────────────────────────── */

/** Dataset → pretty JSON. A markdown dataset is wrapped as `{content}`. */
export function datasetToJson(ds: Dataset): string {
  if (ds.kind === "json") {
    try {
      return JSON.stringify(JSON.parse(ds.content), null, 2);
    } catch {
      return JSON.stringify({ content: ds.content }, null, 2);
    }
  }
  return JSON.stringify({ name: ds.name, kind: "markdown", content: ds.content }, null, 2);
}

/** Dataset → markdown. A JSON dataset renders as a fenced block (or a table
 *  when it is an array of flat objects — the common scrape-result shape). */
export function datasetToMarkdown(ds: Dataset): string {
  if (ds.kind === "markdown") return ds.content;
  try {
    const parsed: unknown = JSON.parse(ds.content);
    const table = jsonToMarkdownTable(parsed);
    if (table) return `# ${ds.name}\n\n${table}`;
    return `# ${ds.name}\n\n\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
  } catch {
    return `# ${ds.name}\n\n\`\`\`\n${ds.content}\n\`\`\``;
  }
}

/** Dataset → CSV, when the content is (or contains) an array of objects.
 *  Returns null when there is no tabular shape to honour — the caller says
 *  so instead of inventing columns. */
export function datasetToCsv(ds: Dataset): string | null {
  if (ds.kind !== "json") return null;
  try {
    const rows = tabularRows(JSON.parse(ds.content));
    if (!rows) return null;
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const escape = (v: unknown): string => {
      const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [columns.join(",")];
    for (const row of rows) lines.push(columns.map((c) => escape(row[c])).join(","));
    return lines.join("\r\n");
  } catch {
    return null;
  }
}

/** The array of objects inside `value`, if one is there to find: the value
 *  itself, or the first array-of-objects field of a wrapper object. */
function tabularRows(value: unknown): Record<string, unknown>[] | null {
  const isRowArray = (v: unknown): v is Record<string, unknown>[] =>
    Array.isArray(v) && v.length > 0 && v.every((r) => r != null && typeof r === "object" && !Array.isArray(r));
  if (isRowArray(value)) return value;
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    for (const field of Object.values(value)) if (isRowArray(field)) return field;
  }
  return null;
}

/** Array of flat objects → a GitHub-style markdown table, else null. */
export function jsonToMarkdownTable(value: unknown): string | null {
  const rows = tabularRows(value);
  if (!rows) return null;
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  if (!columns.length) return null;
  const cell = (v: unknown): string => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").slice(0, 200);
  };
  const lines = [
    `| ${columns.join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${columns.map((c) => cell(r[c])).join(" | ")} |`)
  ];
  return lines.join("\n");
}

/* ── step-output → dataset content ───────────────────────────────────────── */

/** The natural dataset kind for a step output. */
export function outputKind(output: StepOutput): "json" | "markdown" {
  return output.kind === "text" ? "markdown" : "json";
}

/** Serialize a step output for storage/export. */
export function outputContent(output: StepOutput): string {
  switch (output.kind) {
    case "text":
      return output.text ?? "";
    case "json":
      return JSON.stringify(output.json ?? null, null, 2);
    case "links":
      return JSON.stringify(output.links ?? [], null, 2);
    case "documents":
      return JSON.stringify(output.documents ?? [], null, 2);
  }
}

/** Step output as readable markdown — the run panel's "as markdown" export. */
export function outputMarkdown(output: StepOutput): string {
  switch (output.kind) {
    case "text":
      return output.text ?? "";
    case "links":
      return (output.links ?? []).map((l) => `- <${l}>`).join("\n");
    case "json": {
      const table = jsonToMarkdownTable(output.json);
      return table ?? `\`\`\`json\n${JSON.stringify(output.json ?? null, null, 2)}\n\`\`\``;
    }
    case "documents":
      return (output.documents ?? []).map(docToMarkdown).join("\n\n---\n\n");
  }
}

function docToMarkdown(doc: FireDoc): string {
  const head = `## ${doc.title ?? doc.url}\n\n<${doc.url}>`;
  return doc.markdown ? `${head}\n\n${doc.markdown}` : head;
}

/**
 * @file `/api/amberxvid/portrait` — the AI portrait generator (P15).
 *
 * POST `{ selections }` → spawns the `claude` CLI with a brief composed from
 * the member's picks (`buildPortraitPrompt`), sanitizes the answer through
 * `sanitizePortraitSvg`, and saves it as the caller's avatar
 * (`PortraitAvatar`, version 2). Answers `{ ok, avatar, stages, meta }`.
 *
 * House Claude pattern, verbatim from `/api/claude` and `claudeBroker`:
 * spawn the CLI (subscription OAuth — `CLAUDE_CODE_OAUTH_TOKEN` in prod,
 * never `ANTHROPIC_API_KEY`), **prompt on stdin, never argv** (the 2026-07-21
 * phantom-build lesson: a shell-mediated spawn truncates a multi-line prompt
 * at its first newline), `NO_COLOR`, `windowsHide`, hard timeout → SIGTERM.
 *
 * Why one shot instead of streaming: the deliverable is a single SVG document
 * that is worthless half-written, and the client already narrates progress
 * from its own selections (`buildStages`) rather than from model tokens. One
 * retry runs automatically when the first answer fails sanitization — models
 * wrap SVG in prose more often than they emit anything hostile.
 *
 * Gated as always on a signed-in AmberX Vid session. The
 * portrait is written to the CALLER's own profile only — no `owner` param, so
 * this route can never repaint somebody else's face.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import { updateProfile } from "@axs/modules/amberxvid/lib/profiles";
import { buildPortraitPrompt, buildStages, normalizeSelections } from "@axs/modules/amberxvid/lib/portrait-options";
import { sanitizePortraitSvg } from "@axs/modules/amberxvid/lib/portrait-svg";
import type { PortraitAvatar } from "@axs/modules/amberxvid/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Portraits are elaborate; give the model real room (seconds). */
export const maxDuration = 600;

/**
 * Drawing a layered, shaded portrait is a hard generative task, so this wants
 * a capable model — but not the most expensive one, because a portrait is a
 * single self-contained artifact with a mechanical pass/fail (the sanitizer)
 * and a free retry. Sonnet 5 is the default; override per-environment with
 * `AMBERXVID_PORTRAIT_MODEL` (e.g. an Opus/Fable tier for finer art, or Haiku
 * to keep it cheap).
 */
const MODEL = process.env.AMBERXVID_PORTRAIT_MODEL ?? "claude-sonnet-5";
const TIMEOUT_MS = 240_000;

/** Run the CLI once and return its stdout (or throw with stderr attached). */
function runClaude(prompt: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text", "--model", MODEL], {
      cwd: process.cwd(),
      shell: true,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: "1" },
    });

    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`the model did not answer within ${Math.round(TIMEOUT_MS / 1000)}s`));
    }, TIMEOUT_MS);
    const onAbort = (): void => {
      child.kill("SIGTERM");
      reject(new Error("cancelled"));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`could not launch the claude CLI: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (code === 0) {
        resolve(out);
        return;
      }
      // The CLI's REAL failure ("You're out of usage credits", "model not
      // available") lands on stdout; stderr is usually just config warnings
      // about `.claude/settings.json`. Preferring stderr buried the one line
      // that explains the failure — stdout wins, stderr is the fallback.
      const said = out.trim();
      const noise = err.trim();
      reject(new Error((said || noise || `claude exited ${code}`).slice(0, 400)));
    });

    // stdin, never argv — a multi-line prompt does not survive the shell.
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const me = await memberUser(req);
  if (!me) {
    return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }

  const selections = normalizeSelections(body.selections);
  const prompt = buildPortraitPrompt(selections);
  const startedAt = Date.now();

  let raw: string;
  try {
    raw = await runClaude(prompt, req.signal);
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }

  let clean = sanitizePortraitSvg(raw);
  if (!clean.ok) {
    // One corrective retry — the usual failure is prose or a fence around an
    // otherwise fine drawing, not hostility.
    const retryPrompt =
      `${prompt}\n\nYour previous answer was REJECTED: ${clean.error}\n` +
      "Answer again with the SVG document ONLY — first character '<', last character '>'.";
    try {
      raw = await runClaude(retryPrompt, req.signal);
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 502 });
    }
    clean = sanitizePortraitSvg(raw);
    if (!clean.ok) {
      return NextResponse.json(
        { ok: false, error: `the portrait was refused: ${clean.error}` },
        { status: 422 },
      );
    }
  }

  const avatar: PortraitAvatar = {
    version: 2,
    svg: clean.svg,
    selections,
    createdAt: new Date().toISOString(),
    model: MODEL,
  };

  const saved = await updateProfile(me, me, { avatar });
  if (!saved.ok) {
    return NextResponse.json({ ok: false, error: saved.error }, { status: saved.status });
  }

  return NextResponse.json({
    ok: true,
    avatar,
    profile: saved.profile,
    stages: buildStages(selections),
    meta: {
      model: MODEL,
      bytes: clean.svg.length,
      elapsedMs: Date.now() - startedAt,
      strippedAttrs: clean.stripped,
    },
  });
}

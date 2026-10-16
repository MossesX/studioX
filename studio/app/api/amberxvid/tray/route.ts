/**
 * @file `/api/amberxvid/tray` — the status/sync endpoint between the web
 * toolbar and the PyQt6 Windows tray service (the background recording
 * engine). Gated like every module API on a signed-in AmberX Vid session.
 *
 * GET → `{ ok, running, why, status }` — real liveness (live pid + fresh
 *   heartbeat via `trayServiceUp`), plus the tray's last written status.
 *
 * POST `{ action, … }` (JSON):
 *   - `sync`    { settings, browserRecording, backgroundArmed } — the module's
 *     heartbeat: refreshes the tray's context (capture owner = the signed-in
 *     profile, live recorder settings, the browser-engine double-capture flag)
 *     and returns current liveness. Also where the activity-ledger row for a
 *     freshly finalized tray capture is written (the tray process can't reach
 *     the ledger itself).
 *   - `command` { command } — queue `record-start|record-stop|record-pause|
 *     record-resume|background-on|background-off` for the tray's next poll.
 *   - `start-service` / `stop-service` — spawn/quit the tray process, the
 *     hotkeys-service pattern (root `.venv` pythonw, detached; quit rides the
 *     command channel with a SIGTERM fallback). Windows only by design — prod
 *     is a Linux container and its users record in-browser.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { memberUser } from "@axs/modules/amberxvid/lib/membership";
import { pushCommand, syncContext, trayServiceUp } from "@axs/modules/amberxvid/lib/tray";
import type { RecordingQuality, TrayCommandKind, TraySettingsSync } from "@axs/modules/amberxvid/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = process.cwd();
const SERVICE_MAIN = path.join(ROOT, "src", "modules", "amberxvid", "service", "__main__.py");

/** The commands the web side may queue — service lifecycle has its own actions. */
const WEB_COMMANDS: readonly TrayCommandKind[] = [
  "record-start",
  "record-stop",
  "record-pause",
  "record-resume",
  "background-on",
  "background-off",
  /** P13 — the ring balloon. The only command that carries text, and the only
   *  one that touches nothing on the recorder; see `lib/tray`'s `pushCommand`
   *  for the sanitising it gets on the way to the file. */
  "alert",
];

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "sign in to AmberX Vid first" }, { status: 401 });
}

/** The sync context off a request body, owner pinned to the verified profile. */
function contextOf(user: string, body: Record<string, unknown>) {
  const raw = (body["settings"] ?? {}) as Record<string, unknown>;
  const settings: TraySettingsSync = {
    resolution: typeof raw["resolution"] === "string" ? (raw["resolution"] as string) : "1280x720",
    quality: (typeof raw["quality"] === "string" ? raw["quality"] : "high") as RecordingQuality,
    micOn: raw["micOn"] !== false,
  };
  return {
    owner: user,
    settings,
    browserRecording: body["browserRecording"] === true,
    backgroundArmed: body["backgroundArmed"] === true,
  };
}

async function liveness() {
  const svc = await trayServiceUp();
  return { ok: true, running: svc.running, why: svc.why, status: svc.status };
}

/** Windowless python from the repo .venv, falling back to python on PATH. */
async function pythonPath(): Promise<string> {
  for (const c of [path.join(ROOT, ".venv", "Scripts", "pythonw.exe"), path.join(ROOT, ".venv", "Scripts", "python.exe")]) {
    try {
      await fsp.access(c);
      return c;
    } catch {
      /* try the next one */
    }
  }
  return "python";
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!(await memberUser(req))) return unauthorized();
  return NextResponse.json(await liveness());
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await memberUser(req);
  if (!user) return unauthorized();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "body must be JSON" }, { status: 400 });
  }
  const action = typeof body["action"] === "string" ? (body["action"] as string) : "";

  try {
    switch (action) {
      case "sync": {
        await syncContext(contextOf(user, body));
        return NextResponse.json(await liveness());
      }

      case "command": {
        const cmd = body["command"] as TrayCommandKind;
        if (!WEB_COMMANDS.includes(cmd)) {
          return NextResponse.json({ ok: false, error: `unknown tray command "${String(body["command"])}"` }, { status: 400 });
        }
        const svc = await trayServiceUp();
        if (!svc.running) {
          return NextResponse.json(
            { ok: false, running: false, why: svc.why, status: svc.status, error: "the tray service is not running" },
            { status: 409 }
          );
        }
        const queued = await pushCommand(
          cmd,
          contextOf(user, body),
          typeof body["text"] === "string" ? (body["text"] as string) : undefined
        );
        return NextResponse.json({ ...(await liveness()), queued });
      }

      case "start-service": {
        if (process.platform !== "win32") {
          return NextResponse.json(
            { ok: false, error: "background recording is a local-Windows feature — this server cannot host the tray service" },
            { status: 400 }
          );
        }
        const svc = await trayServiceUp();
        if (svc.running) return NextResponse.json({ ...(await liveness()), detail: "already running" });
        try {
          await fsp.access(SERVICE_MAIN);
        } catch {
          return NextResponse.json(
            { ok: false, error: `service entry missing: ${path.relative(ROOT, SERVICE_MAIN).replace(/\\/g, "/")}` },
            { status: 500 }
          );
        }
        const child = spawn(await pythonPath(), [SERVICE_MAIN, "--base-url", req.nextUrl.origin], {
          cwd: ROOT,
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        });
        child.unref();
        return NextResponse.json({
          ok: true,
          running: false,
          pid: child.pid ?? null,
          status: svc.status,
          detail: `started (pid ${child.pid}) — waiting for its first heartbeat`,
        });
      }

      case "stop-service": {
        const svc = await trayServiceUp();
        // Quit rides the command channel the service polls anyway; the signal
        // is only the fallback for a wedged poll loop.
        await pushCommand("quit", contextOf(user, body));
        if (svc.status?.pid) {
          try {
            process.kill(svc.status.pid, "SIGTERM");
          } catch {
            /* already gone, or Windows refused a signal it does not implement */
          }
        }
        return NextResponse.json({ ok: true, running: false, detail: svc.status?.pid ? `quit queued + signalled pid ${svc.status.pid}` : "quit queued" });
      }

      default:
        return NextResponse.json({ ok: false, error: `unknown action "${action}"` }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "tray action failed" },
      { status: 500 }
    );
  }
}

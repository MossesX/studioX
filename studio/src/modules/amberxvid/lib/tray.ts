/**
 * @file AmberX Vid tray-service sync store — the web's half of the two-file
 * channel under `<root>/tray/` (see the tray-sync section of
 * `./types`): it READS `status.json` (tray-owned) and WRITES
 * `commands.json` (web-owned), never the reverse. Single writer per file =
 * race-free without locks.
 *
 * Also the liveness call (`serviceUp` — live pid AND a fresh heartbeat, the
 * hotkeys-service honesty rule: a wedged process reports as down with the
 * reason attached) and the ledger duty for tray captures: the tray process
 * cannot reach `appendJournal`, so `journalFinalized` writes the activity-
 * ledger row for a finished background capture the first time the web sees it
 * (`context.lastJournaledId` is the idempotency mark). Server-only.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { appendJournal } from "./fsCore";
import { legacyRecordingsDir, resolveRecordingDir, trayDir } from "./paths";
import {
  TRAY_FRESH_MS,
  type TrayCommand,
  type TrayCommandKind,
  type TrayCommandsFile,
  type TrayContext,
  type TrayServiceStatus,
  type TraySettingsSync,
} from "./types";

export const statusFile = (): string => path.join(trayDir(), "status.json");
export const commandsFile = (): string => path.join(trayDir(), "commands.json");

/** Queued commands kept in the file — enough for the tray's 1 s poll, tiny on disk. */
const COMMAND_KEEP = 20;

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fsp.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fsp.rename(tmp, file);
}

/* ---------------------------------- status ------------------------------------ */

/** The tray's last written status, or null if the service never ran here. */
export async function readTrayStatus(): Promise<TrayServiceStatus | null> {
  const s = await readJson<TrayServiceStatus>(statusFile());
  return s && s.version === 1 ? s : null;
}

export interface TrayLiveness {
  running: boolean;
  /** Why it is down, when it is — honest, never a green light that lies. */
  why: string | null;
  status: TrayServiceStatus | null;
}

/** Live = a status file with a pid AND a heartbeat fresher than {@link TRAY_FRESH_MS}. */
export async function trayServiceUp(): Promise<TrayLiveness> {
  const status = await readTrayStatus();
  if (!status) return { running: false, why: "the tray service has never run against this store", status: null };
  if (!status.pid) return { running: false, why: "the service reported a clean shutdown", status };
  const age = Date.now() - Date.parse(status.heartbeatAt);
  if (!Number.isFinite(age) || age > TRAY_FRESH_MS) {
    return {
      running: false,
      why: `heartbeat is stale (${Number.isFinite(age) ? `${Math.round(age / 1000)}s old` : "unreadable"}) — the process is gone or wedged`,
      status,
    };
  }
  return { running: true, why: null, status };
}

/* --------------------------------- commands ----------------------------------- */

const EMPTY_COMMANDS: TrayCommandsFile = { version: 1, seq: 0, commands: [], context: null };

export async function readCommands(): Promise<TrayCommandsFile> {
  const c = await readJson<TrayCommandsFile>(commandsFile());
  return c && c.version === 1 ? c : EMPTY_COMMANDS;
}

/**
 * Refresh the module's heartbeat context (owner, live settings, the
 * browser-engine double-capture flag, the armed state) — and take the ledger
 * duty for any freshly finalized tray capture while the file is open.
 */
export async function syncContext(input: {
  owner: string;
  settings: TraySettingsSync;
  browserRecording: boolean;
  backgroundArmed: boolean;
}): Promise<TrayCommandsFile> {
  const file = await readCommands();
  const context: TrayContext = {
    owner: input.owner,
    settings: input.settings,
    browserRecording: input.browserRecording,
    backgroundArmed: input.backgroundArmed,
    updatedAt: new Date().toISOString(),
    lastJournaledId: file.context?.lastJournaledId ?? null,
  };
  const next: TrayCommandsFile = { ...file, context };
  next.context!.lastJournaledId = await journalFinalized(next.context!.lastJournaledId);
  await writeAtomic(commandsFile(), next);
  return next;
}

/**
 * Queue one command for the tray's next poll (also refreshes the context).
 *
 * `text` is the balloon body, and belongs to the `alert` kind alone (P13): the
 * tray is the only always-running surface this module has, so a ring that
 * arrives while the browser tab is backgrounded reaches the member through the
 * channel that is already open rather than through a second one. It is stripped
 * of newlines and capped here — the tray renders it into a Windows
 * notification, so it is display text and a multi-line body would silently
 * truncate on the platform instead.
 */
export async function pushCommand(
  cmd: TrayCommandKind,
  context?: { owner: string; settings: TraySettingsSync; browserRecording: boolean; backgroundArmed: boolean },
  text?: string
): Promise<TrayCommand> {
  const file = await readCommands();
  const seq = file.seq + 1;
  const body = typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  const command: TrayCommand = {
    seq,
    cmd,
    issuedAt: new Date().toISOString(),
    ...(body ? { text: body } : {}),
  };
  const next: TrayCommandsFile = {
    version: 1,
    seq,
    commands: [...file.commands, command].slice(-COMMAND_KEEP),
    context: context
      ? {
          owner: context.owner,
          settings: context.settings,
          browserRecording: context.browserRecording,
          backgroundArmed: context.backgroundArmed,
          updatedAt: command.issuedAt,
          lastJournaledId: file.context?.lastJournaledId ?? null,
        }
      : file.context,
  };
  await writeAtomic(commandsFile(), next);
  return command;
}

/* ---------------------------------- ledger ------------------------------------ */

/**
 * Write the activity-ledger row for the tray's most recent finalized capture,
 * once. Returns the id to persist as `lastJournaledId`. Journaling must never
 * fail the sync (house store posture).
 */
async function journalFinalized(lastJournaledId: string | null): Promise<string | null> {
  const status = await readTrayStatus();
  const fin = status?.lastFinalized;
  if (!fin || fin.id === lastJournaledId) return lastJournaledId;
  try {
    // P2: the tray service reports an id, not a location. Resolve it through
    // the vault (falling back to the legacy directory the tray may still be
    // writing into) so the ledger line names the file that actually exists.
    const dir = resolveRecordingDir(fin.id) ?? path.join(legacyRecordingsDir(), fin.id);
    const abs = path.join(dir, "manifest.json");
    const rel = path.relative(process.cwd(), abs);
    await appendJournal("create", (rel.startsWith("..") ? abs : rel).replace(/\\/g, "/"), {
      summary: `AmberX Vid background capture finalized by the tray service (${fin.durationS}s, ${(fin.sizeBytes / 1024 / 1024).toFixed(1)} MB)`,
    });
  } catch {
    /* the ledger can never fail a sync */
  }
  return fin.id;
}

/**
 * @file The CAPTURE INBOX — where a capture waits when the thing that made it
 * has no browser.
 *
 *   POST /api/tasks/inbox  → { ok: true, queued: n }; body { text, title? }
 *   GET  /api/tasks/inbox  → { captures: [...] } and CLEARS them
 *   DELETE /api/tasks/inbox → { ok: true }; drop whatever is waiting
 *
 * ## Why this exists at all
 *
 * The task store is the BROWSER's (`localStorage`, `axs:tasks@1`). Nothing
 * outside a tab can write it, and a server that tried would lose the race with
 * the next hydrate — which is why GizmoX parks its desktop captures instead of
 * inserting them, and why `capture.ts` originally said this half was not worth
 * porting: nothing was posting to it.
 *
 * Something is now. Owner, 2026-08-13: *"i want the trigger in both"* — the
 * app's Claude composer AND the agent in Claude Code. The agent is exactly the
 * caller GizmoX's PyQt6 prompt was: it can capture text, it cannot write a
 * browser's storage, and the only channel it has to the app is HTTP. So the
 * shape that was declined on "no caller" grounds is the right shape the moment
 * a caller appears, and it comes over unchanged.
 *
 * ## One writer, still
 *
 * This route NEVER touches the task lists. It holds text until a tab takes it,
 * and the tab does the inserting — so `localStorage` keeps exactly one writer
 * and there is no merge to get wrong.
 *
 * ## GET does NOT drain — DELETE does
 *
 * The first cut cleared the queue in the same request that handed it over, on
 * the grounds that an acknowledgement protocol was too much machinery for one
 * round trip. It shipped broken, and the failure is worth recording because it
 * is not obvious from the code: React's dev StrictMode mounts an effect,
 * unmounts it and mounts it again. The FIRST drain took the capture and called
 * `setOpen(true)`; the remount threw that state away and the second drain found
 * an empty queue. The capture was gone and no dialog had ever appeared.
 *
 * A capture that vanishes is the one outcome this feature may not have — the
 * whole point is that the owner types a thought and stops thinking about it. So
 * reading is idempotent now and the CLIENT says when it is safe to forget: the
 * dialog is on screen with the text in it, then DELETE. Re-reading before that
 * shows the same capture again, which is the correct behaviour for something
 * that has not been delivered yet.
 *
 * Storage is the studio's own kv primitive (`data/axf/kv/local/<ns>.json`), the
 * same channel the chrome assets and the saved-theme shelf use. No new store,
 * nothing new to operate.
 */
import { axfKv, kvUser } from "../../../../src/server/axfKv";

export const dynamic = "force-dynamic";

/** Namespace under `data/axf/kv/<user>/`. */
const NS = "taskman-inbox";

/** A capture is a note, not a payload. */
const MAX_TEXT = 8 * 1024;
/** Longer than anyone will queue before looking at the tab; short enough that a
 *  runaway caller cannot fill the disk. Oldest are dropped, not newest: the
 *  most recent capture is the one being waited for. */
const MAX_QUEUED = 50;

export interface InboxCapture {
  /** What to put in the dialog. Becomes the notes, and its first line the title. */
  readonly text: string;
  /** An explicit title, when the capturer has a better one than the first line. */
  readonly title?: string;
  /** Who captured it — for the record, and for a future surface that shows it. */
  readonly source: string;
  /** ISO stamp, server-side: the capturer's clock is not this app's. */
  readonly captured: string;
}

interface InboxDoc {
  readonly v: 1;
  readonly captures: InboxCapture[];
}

const EMPTY: InboxDoc = { v: 1, captures: [] };

/** Read the queue, tolerating anything that is not one. */
async function readInbox(request: Request): Promise<InboxCapture[]> {
  const doc = (await axfKv.read(kvUser(request), NS)) as Partial<InboxDoc> | null;
  if (!doc || doc.v !== 1 || !Array.isArray(doc.captures)) return [];
  return doc.captures.filter(
    (c): c is InboxCapture => Boolean(c) && typeof (c as InboxCapture).text === "string"
  );
}

async function writeInbox(request: Request, captures: InboxCapture[]): Promise<void> {
  await axfKv.write(kvUser(request), NS, { ...EMPTY, captures } satisfies InboxDoc as unknown as Record<string, unknown>);
}

export async function POST(request: Request): Promise<Response> {
  let body: { text?: string; title?: unknown; source?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "body is not JSON" }, { status: 400 });
  }
  if (body.text !== undefined && typeof body.text !== "string") {
    return Response.json({ error: "body.text must be a string" }, { status: 400 });
  }
  /**
   * An EMPTY capture is legal, and that is not laxness.
   *
   * `.newtask.` with nothing after it is the live case in the composer — you
   * type the trigger and keep going in the dialog — and `captureFromDraft`
   * returns `""` for it precisely so the dialog opens rather than refusing.
   * This route rejected it, so the same trigger meant "open the dialog" in the
   * app and "400" through the bridge. Two paths that are documented as the same
   * feature may not disagree about what the feature's simplest input means; the
   * owner found it by typing a bare `.newtask.` here.
   */
  const text = (body.text ?? "").trim();
  if (text.length > MAX_TEXT) {
    return Response.json({ error: "capture too large" }, { status: 413 });
  }

  const capture: InboxCapture = {
    text,
    ...(typeof body.title === "string" && body.title.trim()
      ? { title: body.title.trim().slice(0, 200) }
      : {}),
    source: typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 60) : "agent",
    captured: new Date().toISOString()
  };

  const queued = [...(await readInbox(request)), capture].slice(-MAX_QUEUED);
  await writeInbox(request, queued);
  return Response.json({ ok: true, queued: queued.length });
}

export async function GET(request: Request): Promise<Response> {
  // Idempotent — see the docblock. The client DELETEs once the capture is on
  // screen, and until then re-reading must keep answering with it.
  return Response.json({ captures: await readInbox(request) });
}

export async function DELETE(request: Request): Promise<Response> {
  await writeInbox(request, []);
  return Response.json({ ok: true });
}

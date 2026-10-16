/**
 * @file AmberX Vid call sessions — the server half of 1:1 video chat:
 * session bookkeeping + the strict signal whitelist the calls route enforces.
 *
 * SINCE P6 THIS FILE IS SESSION SEMANTICS ONLY. The server stores a small
 * {@link CallSession} per call and forwards the ring ceremony — invite,
 * accept, reject, hangup — between exactly the two participants over their
 * presence SSE streams (`notifyUsers`). The `sdp`/`ice` relay cases and their
 * sanitize paths are DELETED with the mesh: media setup is mediasoup
 * vocabulary over `/api/amberxvid/media` (P4), the SFU owns the media plane,
 * and SDP never transits the app server for a call again
 * (`MEDIA_CONTRACT.signaling`). The ceremony that remains is not transport —
 * it is who is being asked, who answered, and who ended it.
 *
 * WHAT IS NO LONGER TRUE (P3). This header used to end that paragraph with
 * "the sessions live in process memory pinned to `globalThis` (HMR-safe); a
 * call is an ephemeral thing and honestly dies with the server." Both halves
 * are gone. Sessions live in the SHARED room store (`roomStore.ts`) as rooms of
 * kind `call`, so every app process sees the same call and a call SURVIVES the
 * process that minted it — which is the point (one process could never have
 * been the whole product) and also the new hazard. A call that outlives its
 * server would be a ghost ringing nobody, so both seats carry a heartbeat and
 * the store's sweeper ends any call whose participant stops being held by a
 * live process: `MEDIA_TIMING.participantTimeoutMs`, `endReason: "timeout"`.
 * The `globalThis` registry, the HMR pin and this file's own 2-hour `sweep()`
 * are all deleted — one store, one sweeper.
 *
 * Every exported signature is unchanged by that move, deliberately: the routes
 * and components that call them do not move in this phase. The store's reads
 * and writes are synchronous for exactly that reason (see `fsCore.ts`).
 *
 * THE RELAY CHOKEPOINT: `sanitizeSignal()` is the only door into the relay.
 * It rebuilds every signal from scratch out of whitelisted, typed fields —
 * unknown fields are dropped, `from` is stamped from the authenticated session
 * (never read from the body), and hangup/reject reasons come from closed
 * enums.
 *
 * THE VERIFICATION REFEREE IS RETIRED (P5). From 2026-08-04 to P5 this file
 * harvested the DTLS fingerprints out of every SDP it relayed, and
 * `attestBinding()` held media until the caller's, the callee's and the
 * server's own link-binding derivations all agreed — proof that the two
 * BROWSERS were inside one direct DTLS session, which only means something in
 * a peer-to-peer topology. The SFU this module is converting to terminates
 * DTLS on the server for both legs, so the same comparison would prove only
 * that the server is the server, and keeping the ceremony would keep telling
 * users a call is end-to-end verified when nothing of the kind is true.
 * `lib/sas.ts` and `lib/link-binding.ts` are deleted with it.
 *
 * IN ITS PLACE, SERVER-ATTESTED IDENTITY: who is in a call comes from the
 * authenticated session at signal time (`from` is stamped by the route, never
 * read from a body — the chokepoint above, now the whole of the identity
 * story), the P3 room record is the authority on membership, and the roster
 * any UI renders comes from the server. A producer on the SFU is labelled
 * with the participant the server bound it to. See MEDIA_CONTRACT.identity
 * in `./mediaContract`. The old mesh call now connects without a verification
 * ceremony — honest, and it dies entirely in P6.
 */

import crypto from "node:crypto";
import { openRing } from "./ring";
import { createRoom, listRooms, mutateRoom, newParticipant, norm, readRoom } from "./roomStore";
import type { CallSession, CallSignal } from "./types";

/* ---------------------------------- the store ---------------------------------- */

/** Terminal states — a session in one of these never blocks a new call. */
const OVER: ReadonlySet<CallSession["state"]> = new Set(["ended", "rejected", "failed"]);

/** One call = one room record of kind `call`, keyed by the session id. */
export function getCall(callId: string): CallSession | null {
  const rec = readRoom(callId);
  return rec && rec.kind === "call" ? rec.call : null;
}

/** The user's live (non-terminal) call, if any — the busy check and the GET.
 *  `listRooms` sweeps, so an abandoned session cannot answer this. */
export function activeCallFor(user: string): CallSession | null {
  const u = norm(user);
  for (const rec of listRooms("call")) {
    const s = rec.call;
    if (s && !OVER.has(s.state) && (norm(s.from) === u || norm(s.to) === u)) return s;
  }
  return null;
}

/* ------------------------------ signal whitelist ------------------------------- */

/** Closed enums for the free-text-shaped fields — nothing can ride these.
 *  ("link-mismatch" left with the verification ceremony it reported on.) */
const HANGUP_REASONS = new Set(["hangup", "failed", "timeout"]);
const REJECT_REASONS = new Set(["declined", "busy"]);

export type SanitizeResult =
  | { ok: true; signal: CallSignal }
  | { ok: false; error: string };

/**
 * Rebuild a relayable signal from an untrusted body. Every field is
 * re-constructed (never spread), `from` comes from the authenticated caller,
 * and anything outside the whitelist simply does not exist on the result.
 *
 * The `sdp`/`ice` cases died with the mesh in P6 — an SDP-shaped body is now
 * just an unknown kind, refused by name.
 */
export function sanitizeSignal(body: Record<string, unknown>, from: string): SanitizeResult {
  const kind = typeof body.kind === "string" ? body.kind : "";
  const callId = typeof body.callId === "string" ? body.callId : "";
  if (kind !== "invite" && !/^[a-f0-9-]{8,64}$/.test(callId)) {
    return { ok: false, error: "callId missing or malformed" };
  }

  switch (kind) {
    case "accept":
      return { ok: true, signal: { kind: "accept", callId, from } };
    case "reject": {
      const reason = typeof body.reason === "string" && REJECT_REASONS.has(body.reason) ? body.reason : "declined";
      return { ok: true, signal: { kind: "reject", callId, from, reason: reason as "declined" | "busy" } };
    }
    case "hangup": {
      const reason = typeof body.reason === "string" && HANGUP_REASONS.has(body.reason) ? body.reason : "hangup";
      return { ok: true, signal: { kind: "hangup", callId, from, reason } };
    }
    default:
      return { ok: false, error: `unknown signal kind ${JSON.stringify(kind)}` };
  }
}

/* ------------------------------- state machine --------------------------------- */

export type ApplyResult =
  | { ok: true; session: CallSession; /** relay target (the other participant) */ to: string }
  | { ok: false; error: string; status: number };

export type CreateCallResult =
  | { ok: true; session: CallSession; signal: CallSignal }
  | { ok: false; error: string; status: number; unavailable?: boolean };

/**
 * Start a call: mint the session, hand back the invite to relay.
 *
 * The session id IS the room id — one record, not a session that points at a
 * room — and both seats are minted with a live heartbeat, so the sweeper's
 * clock starts the moment the call does.
 *
 * **Async and fallible since P3.** The guard is checked here, at the one door
 * into a call record, rather than at the route — a guard the next route can
 * forget is a habit, not a gate.
 *
 * **P13 widened it to the whole ring door** (`./ring`): `canStartCalls`, the
 * accounts interaction guard, and do-not-disturb, in that order, all BEFORE a
 * record exists and therefore long before the callee's outbox is written. Only
 * the CALLER's policy row is consulted — a member who may not start calls can
 * still answer one, which is the asymmetry that row's hint describes — but the
 * interaction guard is symmetric by construction: a block refuses in both
 * directions, and its refusal is the "no such member" cover story.
 *
 * A `unavailable: true` refusal is the DND path: the ring was NOT written, but
 * the missed row and its DM note were, so the caller is told the honest thing
 * and the callee finds out where they find out about everything else.
 */
export async function createCall(
  from: string,
  to: string,
  displays: { fromDisplay: string; toDisplay: string },
): Promise<CreateCallResult> {
  const allowed = await openRing({
    from,
    to,
    fromDisplay: displays.fromDisplay,
    toDisplay: displays.toDisplay,
    kind: "call",
  });
  if (!allowed.ok) {
    return { ok: false, error: allowed.error, status: allowed.status, unavailable: allowed.unavailable };
  }
  const session: CallSession = {
    id: crypto.randomUUID(),
    from,
    to,
    state: "ringing",
    createdAt: new Date().toISOString(),
  };
  createRoom({
    id: session.id,
    kind: "call",
    host: from,
    participants: [newParticipant(from, "host"), newParticipant(to, "participant")],
    call: session,
  });
  return {
    ok: true,
    session,
    signal: { kind: "invite", callId: session.id, from, to, at: session.createdAt },
  };
}

/**
 * Apply a sanitized signal to its session: membership check (only the two
 * participants may signal a call), state bookkeeping, and the relay target.
 *
 * The whole read-modify-write runs inside `mutateRoom`, under the room's
 * cross-process lock: two signals arriving at two different app processes in
 * the same millisecond used to be impossible (one process, one Map) and are
 * now routine.
 */
export function applySignal(signal: Exclude<CallSignal, { kind: "invite" }>): ApplyResult {
  const applied = mutateRoom<ApplyResult>(signal.callId, (rec): ApplyResult => {
    const session = rec.call;
    if (!session) return { ok: false, error: "no such call", status: 404 };
    return applyToSession(session, signal);
  });
  return applied ? applied.value : { ok: false, error: "no such call", status: 404 };
}

/** The state machine itself, mutating a session the caller will persist. */
function applyToSession(session: CallSession, signal: Exclude<CallSignal, { kind: "invite" }>): ApplyResult {
  const u = norm(signal.from);
  const isCaller = norm(session.from) === u;
  const isCallee = norm(session.to) === u;
  if (!isCaller && !isCallee) return { ok: false, error: "not your call", status: 403 };
  const to = isCaller ? session.to : session.from;

  if (OVER.has(session.state) && signal.kind !== "hangup") {
    return { ok: false, error: "the call is over", status: 409 };
  }

  const now = new Date().toISOString();
  switch (signal.kind) {
    case "accept":
      // Under the mesh, "accept" opened negotiation and the relayed SDP answer
      // was the last signal the server saw before media — so THAT marked the
      // call active. The SFU took SDP off this channel entirely (P6): accept
      // is now the final session-semantic step, both sides join the media
      // server immediately after it, and a media plane that fails to come up
      // still arrives here as a hangup with reason "failed".
      session.state = "active";
      session.answeredAt = now;
      break;
    case "reject":
      session.state = "rejected";
      session.endedAt = now;
      session.endReason = signal.reason;
      break;
    case "hangup":
      session.state = signal.reason === "failed" ? "failed" : "ended";
      session.endedAt = now;
      session.endReason = signal.reason;
      break;
  }
  return { ok: true, session, to };
}

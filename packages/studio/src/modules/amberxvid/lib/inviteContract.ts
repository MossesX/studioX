/**
 * @file **The invite contract** — the vocabulary the three halves of P7 share:
 * the engine (`./invites`, server-only), the routes, and the two screens
 * (`../InviteDialog`, `../InviteLanding`).
 *
 * ISOMORPHIC ON PURPOSE. Nothing here imports `node:*`, so the landing page
 * and the dialog can hold the same types and compose the same link the server
 * composes. The engine is the only file that touches the filesystem or the
 * HMAC, and it imports this rather than the other way round.
 *
 * ## The shape of an invitation, and the one field that is not obvious
 *
 * An invite is `who` + `to what` + `for how long`, plus two options: a
 * pre-approved buddy request, and a **known handle**. The handle is the field
 * worth reading twice, because it is what closes the side door blocks would
 * otherwise leave open.
 *
 * A handle is where the invitation is being SENT — a username for the internal
 * channel, an email address, a phone number, or nothing at all for a bare link
 * somebody will paste into a chat themselves. When it names a member, the
 * engine can ask the ONE guard whether the inviter may reach them at all, at
 * CREATION rather than only at redemption. A bare link cannot be checked that
 * early — nobody knows who will open it — which is exactly why redemption
 * re-checks unconditionally. Two checks, because each catches what the other
 * structurally cannot.
 *
 * ## Arrival is data, not a redirect the server guesses
 *
 * A redemption answers with an {@link InviteArrival} and the landing turns it
 * into ONE query parameter on `/amberxvid`. The alternative — the server
 * issuing three different redirects — would put the module's internal routing
 * (which pane, which room, which ring) inside an API route that has no
 * business knowing it. The module reads the parameter once on arrival, acts,
 * and strips it from the URL, so a reload does not re-ring anybody.
 */

/* ================================ the invite ================================= */

/** Where the invitation was sent. `link` = composed for the inviter to paste. */
export type InviteChannel = "link" | "internal" | "email" | "sms";

/** What the invitation opens onto. `call` needs no id: the room is the inviter. */
export type InviteTargetKind = "none" | "stream" | "chat" | "call";

/**
 * The target, with the label it carried when the invite was written.
 *
 * The label is a SNAPSHOT and is allowed to rot — a stream titled "Friday
 * night" that has since ended still says so on the landing, which is more
 * honest than a blank. `describeInvite` refreshes it where the thing still
 * exists, so a live target shows its live title.
 */
export type InviteTarget =
  | { kind: "none" }
  | { kind: "stream"; id: string; label: string }
  | { kind: "chat"; id: string; label: string }
  | { kind: "call"; label: string };

export const NO_TARGET: InviteTarget = { kind: "none" };

/** Why an invitation is not usable. `spent` and `revoked` are separate facts
 *  for the OWNER's list; the landing collapses every one of them (see below). */
export type InviteState = "open" | "spent" | "revoked" | "expired";

/** One invitation, as its OWNER sees it in their list. Never leaves the
 *  member-gated route — a landing gets {@link InvitePublic} instead. */
export interface InviteRow {
  id: string;
  /** The full token. The owner may re-copy their own link at any time; that is
   *  the whole point of the list. */
  token: string;
  inviter: string;
  channel: InviteChannel;
  /** Where it was sent, when that is known. Never shown to a redeemer. */
  handle: string | null;
  target: InviteTarget;
  buddy: boolean;
  note: string | null;
  createdAt: string;
  expiresAt: string;
  state: InviteState;
  redeemedAt: string | null;
  redeemedBy: string | null;
  revokedAt: string | null;
}

/**
 * What an UNAUTHENTICATED landing is told. Deliberately thin: who invited
 * (screenname, not the raw handle of anybody else), what it opens onto, and
 * whether it is still good.
 *
 * There is no `state` field and no reason. A landing shows a valid invitation
 * or it shows one sentence — see {@link INVITE_DEAD}.
 */
export interface InvitePublic {
  /** The inviter's screenname, falling back to their username. */
  inviter: string;
  target: InviteTarget;
  /** True when a redemption will also make the two of them buddies. */
  buddy: boolean;
  note: string | null;
  expiresAt: string;
}

/**
 * **The one sentence a dead invitation gets, whatever killed it.**
 *
 * Expired, already redeemed, revoked, forged, and *blocked* all answer with
 * this exact string. That last one is the reason the constant exists rather
 * than four hand-written messages: `relations.ts` rule 1 requires a `blocked`
 * verdict to be rendered byte-identical to the surface's own refusal for a
 * subject that is not there, and a landing that said "you have been blocked"
 * — or merely returned a different status — would hand a blocked person the
 * confirmation the whole silence is built to withhold.
 */
export const INVITE_DEAD = "this invitation is not valid any more";

/* ================================= arrival =================================== */

/** Where a redeemer is put down. `suite` = the target is gone; land anyway. */
export type InviteArrival =
  | { kind: "suite" }
  | { kind: "stream"; id: string }
  | { kind: "chat"; id: string }
  | { kind: "call"; with: string };

/** The query parameter the landing hands the module. One parameter, one read. */
export const ARRIVAL_PARAM = "axv-arrive";

/** `stream:<id>` / `chat:<id>` / `call:<user>` — or null for the plain suite. */
export function encodeArrival(arrival: InviteArrival): string | null {
  switch (arrival.kind) {
    case "stream":
      return `stream:${arrival.id}`;
    case "chat":
      return `chat:${arrival.id}`;
    case "call":
      return `call:${arrival.with}`;
    default:
      return null;
  }
}

/**
 * The inverse, total and forgiving: anything unrecognised is `null` rather
 * than a throw, because this parses a value out of the address bar and a
 * hand-typed one must land somebody in the suite, not on an error screen.
 */
export function decodeArrival(raw: string | null | undefined): InviteArrival | null {
  if (!raw) return null;
  const cut = raw.indexOf(":");
  const kind = cut < 0 ? raw : raw.slice(0, cut);
  const rest = cut < 0 ? "" : raw.slice(cut + 1).trim();
  if (kind === "stream" && rest) return { kind: "stream", id: rest };
  if (kind === "chat" && rest) return { kind: "chat", id: rest };
  if (kind === "call" && rest) return { kind: "call", with: rest };
  return null;
}

/* =============================== composition ================================= */

/**
 * The landing's path. One place, so the route, the mail body and the dialog's
 * copy button cannot drift.
 *
 * **The token is NOT percent-encoded, and that is the fix rather than an
 * omission** (P22, 2026-08-15 — found by walking the gate in a real browser,
 * which is the only place it could be found). A token is
 * `<expiry>:<id>:<user>.<base64url signature>`: every character in it is
 * already a legal `pchar` — `:` included, per RFC 3986 — and a username is
 * restricted to letters, digits and `. _ -` by `isValidUsername`, so there is
 * nothing here that needs escaping.
 *
 * Encoding it anyway produced a link that was DEAD ON ARRIVAL for the whole
 * `link` channel: the path carried `%3A`, `params.token` reached
 * `InviteLanding` still encoded, its `encodeURIComponent` made that `%253A`,
 * the API decoded once back to `%3A`, and the parse failed — so every
 * invitation answered with the same "this invitation is not valid any more"
 * an expired one gets. Every unit test passed throughout, because none of them
 * crossed a URL.
 *
 * Leaving the token unencoded makes the two halves agree whether or not the
 * framework decodes a route param: what is in the path IS the token, and the
 * landing's single `encodeURIComponent` on the way to the API is then the only
 * encoding in the chain.
 */
export const invitePath = (token: string): string => `/amberxvid/invite/${token}`;

/**
 * **The token as it really is**, from whatever the router handed the landing.
 *
 * This is the other half of the same P22 fix, and it is the half that actually
 * binds: Next hands `params.token` to the page PERCENT-ENCODED whether or not
 * the address bar was, so a landing that `encodeURIComponent`s it on the way to
 * the API encodes it twice and asks about a token that does not exist.
 *
 * Decoding is unambiguous here because a token is
 * `<expiry>:<id>:<user>.<base64url signature>` and `%` is not in any of those
 * alphabets — so a `%` in the string can only be an encoding artefact. A
 * decode that throws (a lone `%` typed into the address bar) leaves the value
 * alone, and the API then refuses it as the dead link it is.
 */
export function rawToken(token: string): string {
  if (!token.includes("%")) return token;
  try {
    return decodeURIComponent(token);
  } catch {
    return token;
  }
}

/** The absolute link. `origin` comes from the request on the server and from
 *  `window.location.origin` in the browser — never guessed or configured. */
export const inviteUrl = (origin: string, token: string): string =>
  `${origin.replace(/\/+$/, "")}${invitePath(token)}`;

/** A short human phrase for a target — the landing's headline and the mail
 *  subject both read from this, so they always agree. */
export function targetPhrase(target: InviteTarget): string {
  switch (target.kind) {
    case "stream":
      return `the live stream "${target.label}"`;
    case "chat":
      return `the group chat "${target.label}"`;
    case "call":
      return "a video call";
    default:
      return "AmberX Vid";
  }
}

/** Subject + body for an emailed or texted invitation. One composer for both
 *  URIs and for the server-side send, so the three cannot say different things. */
export function composeInvite(opts: {
  inviter: string;
  target: InviteTarget;
  note: string | null;
  url: string;
}): { subject: string; body: string } {
  const subject = `${opts.inviter} invited you to ${targetPhrase(opts.target)}`;
  const lines = [
    `${opts.inviter} invited you to ${targetPhrase(opts.target)} on AmberX Vid.`,
    "",
    ...(opts.note ? [opts.note, ""] : []),
    "Open this link to join — it works once and then it is spent:",
    opts.url,
    "",
    "If you were not expecting this, ignore it. The link expires by itself.",
  ];
  return { subject, body: lines.join("\n") };
}

/**
 * `mailto:` / `sms:` — the compose path, and the PRODUCT rather than a
 * fallback when no SMTP server is configured. It hands the message to the
 * thing the person already uses to send messages, which needs no credential,
 * no daemon and no delivery report nobody would read.
 */
export function mailtoUri(to: string | null, subject: string, body: string): string {
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return `mailto:${to ? encodeURIComponent(to) : ""}?${q}`;
}

/** `sms:` with the `?&body=` shape both iOS and Android accept. */
export function smsUri(to: string | null, body: string): string {
  return `sms:${to ?? ""}?&body=${encodeURIComponent(body)}`;
}

/* ================================= limits ==================================== */

/**
 * The invitation caps. Stated as data so the engine, the dialog's helper text
 * and the test all read the same numbers.
 *
 * These are STRUCTURAL, not policy: `canSendInvites` (the policy row) decides
 * whether a member may invite at all, and these decide how fast anybody may.
 * A rate cap belongs to the deployment rather than to a per-member dial —
 * the thing it protects is the mail server and the token space, not the member.
 */
export const INVITE_LIMITS = {
  /** How long a link lives. Long enough to sit in an inbox over a weekend. */
  ttlHours: 72,
  /** New invitations per member per {@link INVITE_LIMITS.windowMs}. */
  perWindow: 20,
  windowMs: 60 * 60 * 1000,
  /** Outstanding (open) invitations one member may hold at once. */
  openMax: 100,
  /** The personal note's ceiling — a note, not a letter. */
  noteMax: 280,
  /** Records kept per inviter. Spent and revoked ones are history worth
   *  keeping, but not forever. */
  historyMax: 200,
} as const;

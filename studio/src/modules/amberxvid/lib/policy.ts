/**
 * @file **The amberxvid group of the accounts policy catalog, and the places
 * its rows bite** (P3 of `axf-amberxvid-social`, 2026-08-14).
 *
 * ## The ownership rule — read this before adding anything here
 *
 * **The accounts module owns the CASCADE and the EDITOR. This module owns
 * WHERE its rows bite. Neither side does the other's half.**
 *
 * Concretely, and these are the lines nothing in this file crosses:
 *
 * | Owned by `accounts` | Owned here |
 * |---|---|
 * | the override document (`policy/<user>.json`) and its lock | nothing — this file never writes a policy value |
 * | precedence: site default → per-user override, absent = follow, present = pinned | nothing — {@link effectiveAmberxvidPolicy} asks for the resolved answer |
 * | the audit trail (actor, subject, field, old → new) | nothing — a write this file cannot make is a write it cannot fail to audit |
 * | the generic policy editor that renders the catalog | nothing — there is no amberxvid policy UI, and there must not be |
 * | which MODULES a user may open (the permission matrix) | `./membership`, which consumes that answer and never copies it |
 * | — | the rows: their keys, kinds, labels, hints and site defaults |
 * | — | the enforcement points, the HTTP status of each refusal, and its wording |
 *
 * That table is the whole reason this is an *extension* of one catalog rather
 * than a second policy system. The rows below use nothing but the catalog's
 * existing `switch` and `number` kinds — the vocabulary is core's `SettingRow`
 * (`packages/core/src/settings/decl.ts`:
 * `key / label / hint / kind / defaultValue / min / max / step / options`), which
 * the producing step names explicitly — so the admin suite's generic editor
 * renders all thirteen **with no admin-suite change**. A row needing a control the
 * editor does not have is a row that has to be rethought, not a reason to build
 * a screen here.
 *
 * ## Why the rows live in this file and not in `accounts/lib/policy.ts`
 *
 * **`accounts/lib/policy.ts` does not exist on disk.** It is P2 of
 * `axf-accounts-admin-suite`, which has never run — this project's own P0
 * preflight established exactly that and stopped the build over it
 * (`build/projects/axf-amberxvid-social.p0-inventory.md`, gate (b); re-verified
 * at the top of this phase, `find packages -name policy.ts` is still empty).
 *
 * Writing that file here would **fork ownership of the accounts policy
 * contract** — the one thing P0 refused to do, and the exact opposite of
 * "extend, never fork". So this phase does what P2 did for the storage ledger:
 * declares the module's half as data, in the catalog's stated shape, behind ONE
 * adapter (`./vault-registration`) that hands it over when the catalog lands.
 * The producing step's own text is the shape's source, quoted in that file.
 *
 * The arrival is a zero-line change here and a no-new-line change there — the
 * accounts suite's registration pass already has to call `installVaultStorage`
 * for the storage roots, and that call now carries the policy rows too:
 *
 * ```ts
 * installVaultStorage(accountsStorage, accountsPolicy); // rows + cascade, one call
 * ```
 *
 * ## It does not silently pass
 *
 * Until that call happens {@link amberxvidPolicyStatus} reports
 * `installed: false` with the reason in a sentence, and every row resolves to
 * its **site default**. A default-allow catalog with no cascade behind it looks
 * identical to a cascade that has allowed everything, which is the false-green
 * shape this project keeps getting bitten by — so the absence is a fact a
 * caller and a test can read, and the guards' refusal paths are exercised for
 * real by `test/axv-policy.test.ts` against an installed source.
 *
 * ## Why every default is permissive
 *
 * The permission matrix this module already sits on is default-allow — an
 * absent key means allowed, so "a single-operator studio stays fully open until
 * an administrator says otherwise" (`accounts/lib/permissions.ts`). A catalog
 * that defaulted these to `false` would contradict the module the rows extend,
 * and would silently lock every member of every existing studio out of features
 * they have today the moment the cascade installs. The site posture is set
 * once, by an administrator, in the editor accounts owns.
 *
 * Server-only.
 */

import type { SettingKind, SettingValue } from "@axf/core";

/* ============================ the catalog rows =============================== */

/**
 * Every key this module contributes to the catalog.
 *
 * Written out rather than inferred from the rows: the rows are typed AS this
 * union, so a typo in a key is a compile error at the row, and
 * {@link policyRow} can be total instead of returning `undefined` for a string
 * nobody declared.
 */
export type AmberxvidPolicyKey =
  | "canHostStreams"
  | "streamViewerLimit"
  | "canJoinGroupRooms"
  | "canStartCalls"
  | "canPostWall"
  | "canComment"
  | "canUploadAlbums"
  | "maxAlbums"
  | "maxAlbumItemMB"
  | "canRecordServerSide"
  | "canSendInvites"
  | "canBuyCredits"
  | "maxGroupChatMembers";

/**
 * One catalog row. This is core's `SettingRow` plus the one field the catalog
 * adds: which GROUP the editor files it under. The field names are core's
 * deliberately — the editor is generic over `SettingRow`, and a row that
 * renamed `defaultValue` would need editor code to read it, which is the
 * admin-suite change this whole design exists to avoid.
 */
export interface PolicyRow {
  /** Stable key inside the catalog. Identifier-shaped, camelCase. */
  readonly key: AmberxvidPolicyKey;
  /** The group heading the editor files this under. */
  readonly group: string;
  readonly label: string;
  /** WHY this is a policy — every row justifies itself, as core's rows do. */
  readonly hint: string;
  readonly kind: SettingKind;
  /** The SITE default: what every member gets until an administrator overrides. */
  readonly defaultValue: SettingValue;
  /** `number` only, and both together — an unbounded dial is a typo amplifier. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

/** The group heading. One string, so the rows cannot drift apart in the editor. */
export const AMBERXVID_POLICY_GROUP = "AmberX Vid";

/**
 * The module's thirteen rows.
 *
 * Four of the numbers are deliberately equal to a constant that already exists,
 * so that installing the cascade changes NOTHING until an administrator moves a
 * dial:
 *
 * - `maxAlbums` = `ALBUMS_PER_OWNER_MAX` (`./albums`)
 * - `maxAlbumItemMB` = the default of `maxPhotoBytes()` (`./albums`)
 * - `streamViewerLimit` = 0, which is this catalog's spelling of "no cap",
 *   matching today's behaviour exactly (there has never been a viewer cap).
 * - `maxGroupChatMembers` = `THREAD_MEMBERS_MAX`, the accounts thread store's
 *   own site default (`accounts/lib/types.ts`) — so a studio that installs the
 *   cascade keeps precisely the group size it had the day before.
 *
 * They are stated as literals rather than imported because `./albums` imports
 * this file — a cycle — and `test/axv-policy.test.ts` pins each pair equal so
 * the duplication cannot rot.
 */
export const AMBERXVID_POLICY_ROWS: readonly PolicyRow[] = [
  {
    key: "canHostStreams",
    group: AMBERXVID_POLICY_GROUP,
    label: "May go live",
    hint: "Off, this member can watch streams but cannot broadcast one. The host's uplink is the expensive half of a stream, so this is the row that caps what one member can cost the media server.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "streamViewerLimit",
    group: AMBERXVID_POLICY_GROUP,
    label: "Viewers per stream",
    hint: "How many people may watch one of this member's streams at once. 0 means no cap. Resolved when the stream OPENS and pinned to the room, so raising it does not evict anybody and lowering it does not either.",
    kind: "number",
    defaultValue: 0,
    min: 0,
    max: 10_000,
    step: 1,
  },
  {
    key: "canJoinGroupRooms",
    group: AMBERXVID_POLICY_GROUP,
    label: "May join group rooms",
    hint: "Off, this member is limited to 1:1 calls. A group room fans one member's media to everyone else in it, so a member who abuses rooms costs the server far more than one who abuses calls.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "canStartCalls",
    group: AMBERXVID_POLICY_GROUP,
    label: "May start calls",
    hint: "Off, this member can still ANSWER a call but cannot ring anybody. That asymmetry is the point — it is the lever for someone cold-calling members, and it leaves them reachable by the people who want them.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "canPostWall",
    group: AMBERXVID_POLICY_GROUP,
    label: "May post to the wall",
    hint: "Off, this member reads walls but writes nothing to them. Separate from commenting because muting a poster and muting a commenter are different moderation decisions.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "canComment",
    group: AMBERXVID_POLICY_GROUP,
    label: "May comment",
    hint: "Off, this member cannot comment on posts, albums or streams. The narrower half of the pair above — the usual first step before a full mute.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "canUploadAlbums",
    group: AMBERXVID_POLICY_GROUP,
    label: "May upload photos",
    hint: "Off, this member's existing albums stay readable but nothing new lands. The switch that stops an upload problem without deleting anybody's history.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "maxAlbums",
    group: AMBERXVID_POLICY_GROUP,
    label: "Albums per member",
    hint: "How many albums this member may hold. Counts albums, not photos — the storage quota already counts bytes, and this counts the directories an admin has to look through.",
    kind: "number",
    defaultValue: 50,
    min: 0,
    max: 1_000,
    step: 1,
  },
  {
    key: "maxAlbumItemMB",
    group: AMBERXVID_POLICY_GROUP,
    label: "Largest photo (MB)",
    hint: "The per-file cap for one album upload. Different question from the storage quota: this refuses one oversized file, the quota refuses a member who is full. Narrows the deployment's own cap and never widens it.",
    kind: "number",
    defaultValue: 25,
    min: 1,
    max: 512,
    step: 1,
  },
  {
    key: "canRecordServerSide",
    group: AMBERXVID_POLICY_GROUP,
    label: "May record on the server",
    hint: "Off, this member records in their own browser only. Server-side recording spends the media server's CPU and writes into the member's vault without an upload the module can meter, so it is the recording that needs a grant.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "canSendInvites",
    group: AMBERXVID_POLICY_GROUP,
    label: "May send invites",
    hint: "Off, this member cannot invite anybody into a room. An invite lands a person straight in a live room, which makes it the one social action that reaches somebody who did not go looking.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "canBuyCredits",
    group: AMBERXVID_POLICY_GROUP,
    label: "May buy AI credits",
    hint: "Off, this member spends whatever credits an administrator grants them and cannot buy more. The row that stops a shared or child account from spending money.",
    kind: "switch",
    defaultValue: true,
  },
  {
    key: "maxGroupChatMembers",
    group: AMBERXVID_POLICY_GROUP,
    label: "Members per group chat",
    hint: "How many people one of this member's group chats may hold. A thread is ONE document rewritten on every send, so the member count is what a send costs — this is the dial that stops one person turning a chat into a broadcast. 2 is the floor (below that it is a DM).",
    kind: "number",
    defaultValue: 50,
    min: 2,
    max: 500,
    step: 1,
  },
] as const;

/** The resolved answer for one member: every row, with a real value. */
export type AmberxvidPolicy = {
  canHostStreams: boolean;
  streamViewerLimit: number;
  canJoinGroupRooms: boolean;
  canStartCalls: boolean;
  canPostWall: boolean;
  canComment: boolean;
  canUploadAlbums: boolean;
  maxAlbums: number;
  maxAlbumItemMB: number;
  canRecordServerSide: boolean;
  canSendInvites: boolean;
  canBuyCredits: boolean;
  maxGroupChatMembers: number;
};

/**
 * Compile-time pin: {@link AmberxvidPolicy} has exactly the thirteen keys of
 * {@link AmberxvidPolicyKey}, no more and no fewer. Adding a row without adding
 * its field (or the reverse) fails here, at the type, rather than at the first
 * `undefined` a guard reads at runtime.
 */
type _KeysAgree = [AmberxvidPolicyKey] extends [keyof AmberxvidPolicy]
  ? [keyof AmberxvidPolicy] extends [AmberxvidPolicyKey]
    ? true
    : never
  : never;
const _keysAgree: _KeysAgree = true;
void _keysAgree;

const ROW_BY_KEY = new Map<AmberxvidPolicyKey, PolicyRow>(
  AMBERXVID_POLICY_ROWS.map((r) => [r.key, r]),
);

/** One row by key — the label and effective value a refusal quotes come from here. */
export const policyRow = (key: AmberxvidPolicyKey): PolicyRow =>
  ROW_BY_KEY.get(key) as PolicyRow;

/** The site posture: every row's declared default. Derived, never listed twice. */
export function amberxvidPolicyDefaults(): AmberxvidPolicy {
  const doc: Record<string, SettingValue> = {};
  for (const row of AMBERXVID_POLICY_ROWS) doc[row.key] = row.defaultValue;
  return doc as unknown as AmberxvidPolicy;
}

/* ========================= seam: the accounts cascade ========================= */

/**
 * The cascade's answer for one member: the catalog's resolved values, already
 * put through site-default → per-user override BY THE CASCADE. This module asks
 * for the effective number and never re-implements the precedence — that is the
 * ownership rule in the header, expressed as a function type.
 *
 * Sparse on purpose: a cascade may answer with only the keys it holds an
 * opinion about, and every absent key follows this catalog's site default.
 */
export type AmberxvidPolicySource = (
  username: string,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

let source: AmberxvidPolicySource | null = null;

/** Install the cascade. Called once, by `./vault-registration`. */
export function setAmberxvidPolicySource(next: AmberxvidPolicySource | null): void {
  source = next;
}

export type AmberxvidPolicyStatus =
  | { installed: true }
  | { installed: false; why: string };

/** Where the integration stands. `installed: false` is a stated fact, not a pass. */
export function amberxvidPolicyStatus(): AmberxvidPolicyStatus {
  if (source) return { installed: true };
  return {
    installed: false,
    why:
      "no accounts policy cascade has installed itself yet, so all thirteen amberxvid rows " +
      "resolve to their SITE DEFAULTS and no per-user override can bind. The catalog " +
      "(`accounts/lib/policy.ts`) is a deliverable of the `axf-accounts-admin-suite` " +
      "project, which has never run; when it does, its registration pass calls " +
      "installVaultStorage() from ./vault-registration and nothing in this module changes.",
  };
}

/* ============================== resolution =================================== */

/** Coerce and CLAMP one answered value onto its row. A junk override becomes the
 *  default rather than a policy — the cascade is trusted to resolve precedence,
 *  not to have been typed correctly. */
function coerce(row: PolicyRow, raw: unknown): SettingValue {
  if (row.kind === "switch") {
    return typeof raw === "boolean" ? raw : row.defaultValue;
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) return row.defaultValue;
  const min = row.min ?? Number.NEGATIVE_INFINITY;
  const max = row.max ?? Number.POSITIVE_INFINITY;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

/**
 * The effective policy for one member — site defaults overlaid by whatever the
 * cascade answers, every value coerced and clamped onto its row.
 *
 * With no cascade installed this IS the site defaults, which is the honest
 * answer and the one {@link amberxvidPolicyStatus} explains.
 */
export async function effectiveAmberxvidPolicy(username: string): Promise<AmberxvidPolicy> {
  const doc = amberxvidPolicyDefaults() as unknown as Record<string, SettingValue>;
  if (!source) return doc as unknown as AmberxvidPolicy;
  let answered: Record<string, unknown>;
  try {
    answered = await source(username);
  } catch {
    // A cascade that throws must not take a feature down with it. Site defaults
    // are the documented fallback and they are permissive, which is the same
    // posture `accounts/lib/permissions.ts` takes on an unreadable grants file.
    return doc as unknown as AmberxvidPolicy;
  }
  for (const row of AMBERXVID_POLICY_ROWS) {
    if (answered && Object.prototype.hasOwnProperty.call(answered, row.key)) {
      doc[row.key] = coerce(row, answered[row.key]);
    }
  }
  return doc as unknown as AmberxvidPolicy;
}

/* ================================ refusals =================================== */

/**
 * A policy verdict. A refusal carries the ROW and the EFFECTIVE VALUE as data,
 * not only inside the sentence, because the sentence is for the member and the
 * fields are for the admin who gets asked about it — and because
 * "you may not do this" with no reason is an admin ticket.
 */
export type PolicyVerdict =
  | { ok: true }
  | {
      ok: false;
      error: string;
      status: number;
      /** The catalog key that refused — what an administrator searches for. */
      row: AmberxvidPolicyKey;
      /** The value it refused AT. A limit's number; a switch's `false`. */
      value: SettingValue;
    };

const denySwitch = (key: AmberxvidPolicyKey, what: string): PolicyVerdict => ({
  ok: false,
  status: 403,
  row: key,
  value: false,
  error:
    `${what} — an administrator has turned "${policyRow(key).label}" off for this account ` +
    `(AmberX Vid policy \`${key}\`). Ask them to turn it back on.`,
});

const denyLimit = (
  key: AmberxvidPolicyKey,
  status: number,
  sentence: string,
  value: number,
): PolicyVerdict => ({
  ok: false,
  status,
  row: key,
  value,
  error: `${sentence} (AmberX Vid policy \`${key}\`, currently ${value}). Ask an administrator to raise it.`,
});

/* ------------------------------ the switches ---------------------------------- */

export async function assertCanHostStreams(user: string): Promise<PolicyVerdict> {
  const policy = await effectiveAmberxvidPolicy(user);
  return policy.canHostStreams ? { ok: true } : denySwitch("canHostStreams", "you cannot go live");
}

export async function assertCanJoinGroupRooms(user: string): Promise<PolicyVerdict> {
  const policy = await effectiveAmberxvidPolicy(user);
  return policy.canJoinGroupRooms
    ? { ok: true }
    : denySwitch("canJoinGroupRooms", "you cannot join group rooms");
}

export async function assertCanStartCalls(user: string): Promise<PolicyVerdict> {
  const policy = await effectiveAmberxvidPolicy(user);
  return policy.canStartCalls
    ? { ok: true }
    : denySwitch("canStartCalls", "you cannot start a call (you can still answer one)");
}

export async function assertCanPostWall(user: string): Promise<PolicyVerdict> {
  const policy = await effectiveAmberxvidPolicy(user);
  return policy.canPostWall ? { ok: true } : denySwitch("canPostWall", "you cannot post to a wall");
}

export async function assertCanComment(user: string): Promise<PolicyVerdict> {
  const policy = await effectiveAmberxvidPolicy(user);
  return policy.canComment ? { ok: true } : denySwitch("canComment", "you cannot comment");
}

export async function assertCanUploadAlbums(user: string): Promise<PolicyVerdict> {
  const policy = await effectiveAmberxvidPolicy(user);
  return policy.canUploadAlbums
    ? { ok: true }
    : denySwitch("canUploadAlbums", "you cannot add photos");
}

export async function assertCanRecordServerSide(user: string): Promise<PolicyVerdict> {
  const policy = await effectiveAmberxvidPolicy(user);
  return policy.canRecordServerSide
    ? { ok: true }
    : denySwitch("canRecordServerSide", "you cannot record on the server (browser recording still works)");
}

export async function assertCanSendInvites(user: string): Promise<PolicyVerdict> {
  const policy = await effectiveAmberxvidPolicy(user);
  return policy.canSendInvites ? { ok: true } : denySwitch("canSendInvites", "you cannot send invites");
}

export async function assertCanBuyCredits(user: string): Promise<PolicyVerdict> {
  const policy = await effectiveAmberxvidPolicy(user);
  return policy.canBuyCredits ? { ok: true } : denySwitch("canBuyCredits", "you cannot buy credits");
}

/* ------------------------------- the limits ----------------------------------- */

/**
 * The HOST's viewer cap, resolved once when a stream opens, in viewers, or
 * `null` for uncapped.
 *
 * Resolved at open and pinned to the room record on purpose. The alternative —
 * asking the cascade on every join — would read a policy document per viewer
 * arrival on the hottest path in the module, and would let a mid-stream policy
 * edit change a live room's capacity underneath the people already in it. A cap
 * a stream was opened under is a fact about that stream.
 */
export async function hostStreamViewerLimit(user: string): Promise<number | null> {
  const limit = (await effectiveAmberxvidPolicy(user)).streamViewerLimit;
  return limit > 0 ? limit : null;
}

/**
 * Is there room for one more viewer? Takes the PINNED limit rather than a
 * username, so the join path stays synchronous and reads no policy document.
 */
export function assertStreamViewerRoom(limit: number | null, currentViewers: number): PolicyVerdict {
  if (limit === null || limit <= 0 || currentViewers < limit) return { ok: true };
  return {
    ok: false,
    status: 409,
    row: "streamViewerLimit",
    value: limit,
    error:
      `this stream is full — the host's plan allows ${limit} viewer${limit === 1 ? "" : "s"} at once ` +
      `(AmberX Vid policy \`streamViewerLimit\`). Try again when somebody leaves.`,
  };
}

/**
 * How many members one of this member's group chats may hold.
 *
 * Handed to the accounts thread store through `setThreadMemberCapSource`
 * (`./vault-registration`) rather than read at a call site here: the store owns
 * the thread and therefore owns the refusal, and this module owns only the
 * number. That is the same split the rest of this file keeps — accounts owns
 * the cascade and the editor, amberxvid owns the rows and where they bite —
 * and it is why a group chat has a policy-driven cap with no import of this
 * file anywhere in the accounts module.
 */
export async function groupChatMemberCap(user: string): Promise<number> {
  return (await effectiveAmberxvidPolicy(user)).maxGroupChatMembers;
}

/** Has this member hit their album count? `current` is what they hold now. */
export async function assertAlbumCount(user: string, current: number): Promise<PolicyVerdict> {
  const max = (await effectiveAmberxvidPolicy(user)).maxAlbums;
  if (current < max) return { ok: true };
  return denyLimit("maxAlbums", 409, `you are at your album limit of ${max}`, max);
}

/**
 * Is one upload within this member's per-file cap?
 *
 * `deploymentCapBytes` is the module's OWN structural cap (`maxPhotoBytes()`,
 * env-tunable per deployment). Policy NARROWS it and never widens it, and the
 * refusal names whichever one actually bit — an administrator who set 100 MB on
 * a 25 MB deployment needs to be told it was the deployment, not their row.
 */
export async function assertAlbumItemBytes(
  user: string,
  bytes: number,
  deploymentCapBytes: number,
): Promise<PolicyVerdict> {
  const policyMB = (await effectiveAmberxvidPolicy(user)).maxAlbumItemMB;
  const policyBytes = policyMB * 1024 * 1024;
  if (bytes <= Math.min(policyBytes, deploymentCapBytes)) return { ok: true };
  if (policyBytes < deploymentCapBytes) {
    return denyLimit(
      "maxAlbumItemMB",
      413,
      `that photo is ${(bytes / 1024 / 1024).toFixed(1)} MB and your per-photo limit is ${policyMB} MB`,
      policyMB,
    );
  }
  return {
    ok: false,
    status: 413,
    row: "maxAlbumItemMB",
    value: policyMB,
    error:
      `that photo is ${(bytes / 1024 / 1024).toFixed(1)} MB and this deployment caps photos at ` +
      `${Math.round(deploymentCapBytes / 1024 / 1024)} MB — a server limit, below your ` +
      `${policyMB} MB policy allowance, so raising the policy will not help.`,
  };
}

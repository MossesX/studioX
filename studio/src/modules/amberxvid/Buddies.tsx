"use client";

/**
 * @file **Buddy affordances** — the add/accept/remove/block control that sits
 * on every profile, and the member search the empty feed offers instead of a
 * spinner (P9 of `axf-amberxvid-social`, 2026-08-15).
 *
 * ## The button never lies, and that is a design constraint, not a slogan
 *
 * Every state here is DERIVED from the caller's own relations snapshot — the
 * one the accounts route serves and the presence channel nudges — rather than
 * from a local guess about what a click did. So "Add buddy" appears only where
 * a request would actually be created, "Accept" only where one is genuinely
 * waiting, and a request already sent reads "Requested" instead of offering to
 * send a second one. {@link buddyStateOf} is the whole rule, in one function,
 * so the profile page and the feed's search cannot disagree about what a member
 * currently is to you.
 *
 * That snapshot is authoritative for YOUR half of the graph and only for it.
 * `canInteract` also refuses on the other member's `buddiesOnly` switch, and
 * their switch is deliberately not visible to you (`accounts/lib/relations.ts`,
 * rule 1) — so a request can still be refused by the store after the button
 * correctly offered it. That refusal arrives as the route's own sentence and is
 * shown verbatim; the alternative is guessing at their settings, which is how a
 * block leaks. A blocked pair never reaches this control at all: their profile
 * 404s upstream, identically to a member who does not exist.
 *
 * There is no context menu here on purpose. Menus in AmberX are DECLARED AS
 * DATA on the module's decl and wired by command NAME (P16's job); a surface
 * that hand-wrote an `onContextMenu` would be re-importing exactly the
 * inconsistency the area walk exists to have ended.
 */

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import InputAdornment from "@mui/material/InputAdornment";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Check as CheckIcon } from "./kit/icons";
import { MoreVert as MoreIcon } from "./kit/icons";
import { Person as PersonIcon } from "./kit/icons";
import { PlaylistAdd as AddBuddyIcon } from "./kit/icons";
import { SearchRounded as SearchIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip } from "./kit/ax";
import { useToast } from "./kit/Toast";
import type { RelationsSnapshot } from "./Messenger";

/* ------------------------------- the one rule ---------------------------------- */

/**
 * What a member currently is to you.
 *
 * `blocked` is checked FIRST and wins outright: a blocked member can still be
 * sitting in a stale `outgoing` row, and offering to cancel a request to
 * somebody you have blocked is a control that describes the wrong world.
 */
export type BuddyState = "self" | "blocked" | "buddy" | "incoming" | "outgoing" | "none";

const lower = (u: string): string => u.trim().toLowerCase();

const holds = (rows: { username: string }[], user: string): boolean =>
  rows.some((r) => lower(r.username) === lower(user));

export function buddyStateOf(relations: RelationsSnapshot, me: string, user: string): BuddyState {
  if (lower(me) === lower(user)) return "self";
  if (holds(relations.blocked, user)) return "blocked";
  if (holds(relations.buddies, user)) return "buddy";
  if (holds(relations.incoming, user)) return "incoming";
  if (holds(relations.outgoing, user)) return "outgoing";
  return "none";
}

/* ------------------------------- the control ------------------------------------ */

export interface BuddyControlsProps {
  me: string;
  /** The member the control acts on. */
  user: string;
  relations: RelationsSnapshot;
  /** `request` | `accept` | `remove` | `block` | `unblock` — the relations
   *  route's own verbs, threaded from the messenger engine so this control and
   *  the buddy list share one graph and one SSE nudge. */
  relate: (action: string, user: string) => Promise<boolean>;
  /** Offered beside the buddy verbs where a conversation makes sense. */
  onMessage?: (user: string) => void;
  /** Compact drops the labels to icons — the search rows use it. */
  dense?: boolean;
}

/**
 * The buddy verbs for one member, rendered from {@link buddyStateOf}.
 *
 * The destructive verbs (remove, block) live behind the overflow rather than on
 * the surface: they are one click from a mis-aim otherwise, and unblocking
 * restores nothing — the store is explicit that a block severs the edge rather
 * than pausing it.
 */
export function BuddyControls({ me, user, relations, relate, onMessage, dense = false }: BuddyControlsProps) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [menu, setMenu] = React.useState<HTMLElement | null>(null);
  const state = buddyStateOf(relations, me, user);

  // The snapshot is refreshed by the route's own answer and the presence nudge,
  // so this fires the verb and lets the graph — not local optimism — redraw.
  const act = React.useCallback(
    async (action: string, done: string) => {
      setMenu(null);
      setBusy(true);
      try {
        const ok = await relate(action, user);
        // `relate` reports whether the store took it; its refusal sentence has
        // already been surfaced by the engine, so a second toast here would
        // double up on the same failure.
        if (ok) toast(done);
      } finally {
        setBusy(false);
      }
    },
    [relate, toast, user],
  );

  if (state === "self") return null;

  // Dense rows are already small; the size is constant and only the LABELS
  // fall away, so a search row is a strip of icons and a profile is words.
  const size = "small" as const;
  const label = (text: string): string | null => (dense ? null : text);
  const spinner = busy ? <CircularProgress size={13} /> : null;

  if (state === "blocked") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <GxChip label="blocked" kind="err" />
        <Button
          size={size}
          variant="outlined"
          disabled={busy}
          onClick={() => void act("unblock", `${user} unblocked — they can reach you again`)}
          data-el-id={`amberxvid:buddy:unblock:${user}`}
        >
          {spinner ?? "Unblock"}
        </Button>
      </Box>
    );
  }

  const overflow = (
    <>
      <Tooltip title="More">
        <span>
          <Button
            size={size}
            variant="text"
            disabled={busy}
            onClick={(e) => setMenu(e.currentTarget)}
            sx={{ minWidth: 32, px: 0.5 }}
            aria-label={`more actions for ${user}`}
            data-el-id={`amberxvid:buddy:more:${user}`}
          >
            <MoreIcon sx={{ fontSize: 16 }} />
          </Button>
        </span>
      </Tooltip>
      <Menu anchorEl={menu} open={menu !== null} onClose={() => setMenu(null)}>
        {state === "buddy" && (
          <MenuItem onClick={() => void act("remove", `${user} removed from your buddies`)}>
            Remove buddy
          </MenuItem>
        )}
        {state === "outgoing" && (
          <MenuItem onClick={() => void act("remove", "Request cancelled")}>Cancel request</MenuItem>
        )}
        {state === "incoming" && (
          <MenuItem onClick={() => void act("remove", "Request declined")}>Decline request</MenuItem>
        )}
        <MenuItem
          onClick={() => void act("block", `${user} blocked — silently, and for good`)}
          sx={{ color: GX.err }}
        >
          Block member
        </MenuItem>
      </Menu>
    </>
  );

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
      {state === "none" && (
        <Button
          size={size}
          variant="contained"
          startIcon={dense ? undefined : <AddBuddyIcon />}
          disabled={busy}
          onClick={() => void act("request", `Buddy request sent to ${user}`)}
          data-el-id={`amberxvid:buddy:add:${user}`}
        >
          {spinner ?? (label("Add buddy") ?? <AddBuddyIcon sx={{ fontSize: 15 }} />)}
        </Button>
      )}
      {state === "incoming" && (
        <Button
          size={size}
          variant="contained"
          startIcon={dense ? undefined : <CheckIcon />}
          disabled={busy}
          onClick={() => void act("accept", `You and ${user} are buddies`)}
          data-el-id={`amberxvid:buddy:accept:${user}`}
        >
          {spinner ?? (label("Accept") ?? <CheckIcon sx={{ fontSize: 15 }} />)}
        </Button>
      )}
      {state === "outgoing" && (
        <Tooltip title="Waiting on them to accept">
          <span>
            <GxChip label="requested" kind="warn" />
          </span>
        </Tooltip>
      )}
      {state === "buddy" && <GxChip label="buddies" kind="ok" />}
      {onMessage && state !== "none" && !dense && (
        <Button size={size} variant="outlined" onClick={() => onMessage(user)}>
          Message
        </Button>
      )}
      {overflow}
    </Box>
  );
}

/* -------------------------------- the search ------------------------------------ */

export interface BuddyCandidate {
  username: string;
  screenname: string;
}

export interface BuddySearchProps {
  me: string;
  relations: RelationsSnapshot;
  relate: (action: string, user: string) => Promise<boolean>;
  /** Every member the caller can see — the roster the messenger engine holds. */
  candidates: BuddyCandidate[];
  onOpenProfile?: (user: string) => void;
  /** Heading above the results; the empty feed sets its own. */
  title?: string;
}

/**
 * Find members and act on them — what an empty feed shows instead of a
 * spinner, and what a member with no buddies actually needs.
 *
 * Members you are ALREADY buddies with are listed too rather than filtered
 * out. A search that hides them looks broken to somebody typing a name they
 * know is there, and the control beside the row already says what they are.
 */
export function BuddySearch({
  me,
  relations,
  relate,
  candidates,
  onOpenProfile,
  title = "Find members",
}: BuddySearchProps) {
  const [needle, setNeedle] = React.useState("");

  const rows = React.useMemo(() => {
    const n = needle.trim().toLowerCase();
    return candidates
      .filter((c) => lower(c.username) !== lower(me))
      .filter((c) => !n || c.username.toLowerCase().includes(n) || c.screenname.toLowerCase().includes(n))
      .sort((a, b) => a.screenname.localeCompare(b.screenname, undefined, { sensitivity: "base" }));
  }, [candidates, me, needle]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
      <Typography
        sx={{ fontFamily: GX.mono, fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: GX.dim }}
      >
        {title}
      </Typography>
      <TextField
        size="small"
        fullWidth
        value={needle}
        onChange={(e) => setNeedle(e.target.value)}
        placeholder="Search by screenname or username…"
        data-el-id="amberxvid:buddies:search"
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: GX.dim }} />
              </InputAdornment>
            ),
          },
        }}
      />
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, maxHeight: 320, overflowY: "auto" }}>
        {rows.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: GX.dim, p: 1 }}>
            {candidates.length <= 1
              ? "You are the only member so far — an administrator adds the rest."
              : "No member matches that."}
          </Typography>
        ) : (
          rows.map((row) => (
            <Box
              key={row.username}
              data-el-id={`amberxvid:buddies:row:${row.username}`}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                p: 0.75,
                borderRadius: 1,
                border: `1px solid ${GX.edge}`,
                "&:hover": { bgcolor: gxa(GX.accent, "0d") },
              }}
            >
              <PersonIcon sx={{ fontSize: 16, color: GX.dim, flexShrink: 0 }} />
              <Box
                onClick={() => onOpenProfile?.(row.username)}
                sx={{ minWidth: 0, flex: 1, cursor: onOpenProfile ? "pointer" : "default" }}
              >
                <Typography
                  sx={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {row.screenname}
                </Typography>
                <Typography sx={{ fontSize: 10, color: GX.dim }}>{row.username}</Typography>
              </Box>
              <BuddyControls me={me} user={row.username} relations={relations} relate={relate} dense />
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

/** Exported for the surfaces that only want the pending count (a profile's
 *  header badge) without rendering a whole control. */
export const pendingBuddyCount = (relations: RelationsSnapshot): number => relations.incoming.length;

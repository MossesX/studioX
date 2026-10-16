"use client";

/**
 * @file Chat history — the messenger's archive view over P5's PAGED reads
 * (P6 of `axf-amberxvid-social`, 2026-08-15).
 *
 * A chat window shows a conversation as it is happening. This shows one as a
 * RECORD: pick a conversation, walk backwards through it a page at a time, jump
 * to a date, and search what is loaded.
 *
 * ## It is a separate surface because it reads differently
 *
 * The chat window fetches a whole thread and marks it read — opening a window
 * IS reading it. History does neither: it asks for `limit`/`cursor` pages and
 * **never passes `markRead`**, because scrolling back through last month does
 * not mean you have just read last month, and a browser that silently cleared
 * unread badges would be a badge nobody could trust.
 *
 * Delivery is a different matter and is NOT avoidable here: in the accounts
 * store fetching IS receiving, so a page read stamps the caller's delivery
 * cursor. That is correct rather than a leak — the messages really did arrive
 * at this client — and it is why the two side-effects are separate verbs in the
 * store to begin with.
 *
 * ## Paging is a SEEK, not a scroll
 *
 * `MessagePage.nextCursor` is the `seq` to ask for next and the store
 * binary-searches to it, so "load older" costs a `log n` seek and a slice
 * however deep the conversation is. `total` is the thread's real length, which
 * is what lets this say "showing 50 of 312" honestly instead of "showing
 * everything we bothered to fetch".
 *
 * ## Jump to date, and its bound
 *
 * A date is not a cursor — the store seeks by `seq` — so reaching a date means
 * walking pages until the oldest loaded message is old enough. That walk is
 * BOUNDED ({@link JUMP_MAX_PAGES}) and says so when it stops: an unbounded
 * loop against a 500-message cap is fine, against a store that grows is a
 * client that hangs, and a silent stop would read as "there is nothing older".
 *
 * Search filters WHAT IS LOADED and says so on the box. Searching the server
 * side is a store feature, not a client one, and pretending otherwise would
 * quietly return "no results" for a word three pages back.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { AccountTree as GroupIcon } from "./kit/icons";
import { Clear as ClearIcon } from "./kit/icons";
import { Search as SearchIcon } from "./kit/icons";
import { GX, gxa } from "./kit/gx";
import { GxChip } from "./kit/ax";
import { useToast } from "./kit/Toast";
import { GizmoXLockup } from "./gizmox-kit";
import type { MessengerTheme } from "./lib/contract";
import { themeBackgroundCss, themeFontPx } from "./lib/messenger-themes";
import type { AccountMe, Message, MessagePage, Thread } from "./lib/types";
import AvatarView from "./Avatar";
import type { ChatTarget, MessengerLink, ThreadRow } from "./Messenger";

/** Messages per page. Small enough that a page is a page, big enough that a
 *  short conversation arrives whole. */
const PAGE = 50;

/** How many pages a "jump to date" will walk before it stops and says so. */
const JUMP_MAX_PAGES = 20;

const lower = (u: string): string => u.trim().toLowerCase();

/** The tab a summary describes — the same projection the drawer uses. */
function targetOf(row: ThreadRow): ChatTarget {
  return { id: row.id, kind: row.kind, with: row.with, title: row.title };
}

/** `YYYY-MM-DD` in LOCAL time — a date filter that used UTC would put an
 *  evening message on the wrong day for half the world. */
function dayKey(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  const today = dayKey(new Date().toISOString());
  if (key === today) return "Today";
  return date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Highlight every occurrence of `needle`, case-insensitively. */
function highlight(text: string, needle: string, accent: string): React.ReactNode {
  if (!needle) return text;
  const parts: React.ReactNode[] = [];
  const hay = text.toLowerCase();
  const want = needle.toLowerCase();
  let at = 0;
  for (let i = hay.indexOf(want); i >= 0; i = hay.indexOf(want, at)) {
    if (i > at) parts.push(text.slice(at, i));
    parts.push(
      <Box
        key={`${i}-${parts.length}`}
        component="mark"
        sx={{ bgcolor: gxa(accent, "55"), color: "inherit", px: 0.2, borderRadius: 0.5 }}
      >
        {text.slice(i, i + want.length)}
      </Box>,
    );
    at = i + want.length;
  }
  parts.push(text.slice(at));
  return parts;
}

interface Loaded {
  messages: Message[];
  /** The seq to ask for next, or null once the page reached the beginning. */
  nextCursor: number | null;
  /** What the thread really holds — the denominator of "showing X of Y". */
  total: number;
}

export default function MessengerHistory({
  link,
  me,
  theme,
}: {
  link: MessengerLink;
  me: AccountMe;
  theme: MessengerTheme;
}) {
  const toast = useToast();
  const [picked, setPicked] = React.useState<ChatTarget | null>(null);
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [since, setSince] = React.useState("");

  const fontPx = themeFontPx(link.settings.fontSize);

  /**
   * One page. `markRead` is deliberately absent from both readers — see the
   * file header. A DM goes through `?with=` so a pair that never spoke reads as
   * an empty conversation rather than a 404.
   */
  const fetchPage = React.useCallback(
    async (target: ChatTarget, cursor: number | null): Promise<Loaded | null> => {
      const base =
        target.kind === "dm"
          ? `with=${encodeURIComponent(target.with)}`
          : `thread=${encodeURIComponent(target.id)}`;
      const url =
        `/api/accounts/messages?${base}&limit=${PAGE}` +
        (cursor !== null ? `&cursor=${cursor}` : "");
      try {
        const res = await fetch(url);
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean;
          thread?: Thread;
          page?: MessagePage;
          error?: string;
        } | null;
        if (!res.ok || !json?.ok || !json.page) {
          toast(json?.error ?? "That conversation didn't load");
          return null;
        }
        return {
          messages: json.page.messages,
          nextCursor: json.page.nextCursor,
          total: json.page.total,
        };
      } catch {
        toast("That conversation didn't load — the service did not answer");
        return null;
      }
    },
    [toast],
  );

  const pick = React.useCallback(
    async (target: ChatTarget) => {
      setPicked(target);
      setLoaded(null);
      setQuery("");
      setSince("");
      setBusy(true);
      const page = await fetchPage(target, null);
      setBusy(false);
      if (page) setLoaded(page);
    },
    [fetchPage],
  );

  const loadOlder = React.useCallback(async () => {
    if (!picked || !loaded || loaded.nextCursor === null || busy) return;
    setBusy(true);
    const page = await fetchPage(picked, loaded.nextCursor);
    setBusy(false);
    if (!page) return;
    setLoaded((cur) =>
      cur === null
        ? page
        : { messages: [...page.messages, ...cur.messages], nextCursor: page.nextCursor, total: page.total },
    );
  }, [busy, fetchPage, loaded, picked]);

  /** Walk pages until the oldest loaded message is on or before `since`. */
  const jumpToDate = React.useCallback(async () => {
    if (!picked || !loaded || !since || busy) return;
    setBusy(true);
    let cur = loaded;
    let pages = 0;
    while (
      cur.nextCursor !== null &&
      pages < JUMP_MAX_PAGES &&
      (cur.messages.length === 0 || dayKey(cur.messages[0].sentAt) > since)
    ) {
      const page = await fetchPage(picked, cur.nextCursor);
      if (!page) break;
      cur = {
        messages: [...page.messages, ...cur.messages],
        nextCursor: page.nextCursor,
        total: page.total,
      };
      pages += 1;
    }
    setLoaded(cur);
    setBusy(false);
    if (pages >= JUMP_MAX_PAGES && cur.nextCursor !== null) {
      toast(
        `Stopped after ${JUMP_MAX_PAGES} pages — there is older history, press "Load older" to keep going`,
      );
    }
  }, [busy, fetchPage, loaded, picked, since, toast]);

  /* ------------------------------- what is shown ------------------------------- */

  const shown = React.useMemo(() => {
    const all = loaded?.messages ?? [];
    const q = query.trim().toLowerCase();
    return all.filter(
      (m) =>
        (!since || dayKey(m.sentAt) >= since) &&
        (!q ||
          m.text.toLowerCase().includes(q) ||
          link.screennameFor(m.from).toLowerCase().includes(q)),
    );
  }, [link, loaded, query, since]);

  /** Messages grouped under their day, oldest day first. */
  const days = React.useMemo(() => {
    const out: Array<{ key: string; messages: Message[] }> = [];
    for (const m of shown) {
      const key = dayKey(m.sentAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.messages.push(m);
      else out.push({ key, messages: [m] });
    }
    return out;
  }, [shown]);

  /* --------------------------------- the picker -------------------------------- */

  if (!picked) {
    return (
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 1.25 }}>
        <Typography sx={{ fontSize: 11.5, color: GX.dim, mb: 1 }}>
          Every conversation you are in. Opening one here reads it page by page and does NOT mark it
          read — the unread badges stay exactly as they were.
        </Typography>
        {link.summaries.length === 0 ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5, py: 5, opacity: 0.85 }}>
            <GizmoXLockup mark={34} />
            <Typography sx={{ fontSize: 12, color: GX.dim, textAlign: "center", maxWidth: 260 }}>
              No conversations yet. Message a buddy or open a group and the history lands here.
            </Typography>
          </Box>
        ) : (
          link.summaries.map((s) => {
            const target = targetOf(s);
            return (
              <Box
                key={s.id}
                onClick={() => void pick(target)}
                data-el-id={`amberxvid:messenger:history:thread:${s.id}`}
                sx={{
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  p: 0.75,
                  borderRadius: 1,
                  border: "1px solid transparent",
                  "&:hover": { bgcolor: `${theme.accent}0f`, borderColor: `${theme.accent}33` },
                }}
              >
                {s.kind === "group" ? (
                  <Box
                    sx={{
                      width: 30,
                      height: 30,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: gxa(theme.accent, "22"),
                      border: `1px solid ${theme.accent}55`,
                    }}
                  >
                    <GroupIcon sx={{ fontSize: 15, color: theme.accent }} />
                  </Box>
                ) : (
                  <AvatarView
                    spec={link.profiles[lower(s.with)]?.avatar ?? null}
                    name={link.screennameFor(s.with)}
                    size={30}
                  />
                )}
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography noWrap sx={{ fontSize: 13, fontWeight: 600, lineHeight: 1.2 }}>
                    {link.labelForThread(target)}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: 10.5, color: GX.dim }}>
                    {s.lastMessage
                      ? `${dayLabel(dayKey(s.lastMessage.sentAt))} · ${s.lastMessage.text.slice(0, 46)}`
                      : "no messages yet"}
                  </Typography>
                </Box>
                {s.unread > 0 && <GxChip label={`${s.unread} unread`} kind="info" />}
              </Box>
            );
          })
        )}
      </Box>
    );
  }

  /* -------------------------------- the archive -------------------------------- */

  const oldest = loaded?.messages[0]?.sentAt ?? null;

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* the toolbar: what you are reading, and the two filters */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          gap: 0.75,
          px: 1.25,
          py: 1,
          borderBottom: `1px solid ${GX.edge}`,
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Button
            size="small"
            onClick={() => {
              setPicked(null);
              setLoaded(null);
            }}
            data-el-id="amberxvid:messenger:history:back"
            sx={{ py: 0, fontSize: 11, minWidth: 0 }}
          >
            All conversations
          </Button>
          <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 700, flex: 1, minWidth: 0 }}>
            {link.labelForThread(picked)}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={() => link.openThread(picked.id)}
            data-el-id="amberxvid:messenger:history:open-chat"
            sx={{ py: 0, fontSize: 10.5 }}
          >
            Open chat
          </Button>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <TextField
            size="small"
            fullWidth
            placeholder="Search what's loaded…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-el-id="amberxvid:messenger:history:search"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 15, color: GX.dim }} />
                  </InputAdornment>
                ),
                endAdornment: query ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setQuery("")} sx={{ p: 0.25 }}>
                      <ClearIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                  </InputAdornment>
                ) : null,
              },
            }}
          />
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Typography sx={{ fontSize: 10.5, color: GX.dim, whiteSpace: "nowrap" }}>From</Typography>
          <TextField
            size="small"
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            data-el-id="amberxvid:messenger:history:date"
            sx={{ width: 150, "& input": { fontSize: 11.5, py: 0.5 } }}
          />
          <Tooltip title="Load older pages until that date is on screen">
            <span>
              <Button
                size="small"
                variant="outlined"
                disabled={!since || busy || loaded?.nextCursor === null}
                onClick={() => void jumpToDate()}
                data-el-id="amberxvid:messenger:history:jump"
                sx={{ py: 0, fontSize: 10.5 }}
              >
                Jump
              </Button>
            </span>
          </Tooltip>
          {since && (
            <Button
              size="small"
              onClick={() => setSince("")}
              sx={{ py: 0, fontSize: 10.5, color: GX.dim }}
            >
              Clear
            </Button>
          )}
        </Box>

        <Typography sx={{ fontSize: 10, color: GX.dim, fontFamily: GX.mono }}>
          {loaded
            ? `showing ${shown.length} of ${loaded.messages.length} loaded · ${loaded.total} in the conversation` +
              (loaded.nextCursor === null ? " · at the beginning" : "")
            : "loading…"}
        </Typography>
      </Box>

      {/* the transcript, on the chosen theme's own surface */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          p: 1.25,
          bgcolor: theme.bg,
          backgroundImage: themeBackgroundCss(theme),
        }}
      >
        {loaded && loaded.nextCursor !== null && (
          <Box sx={{ display: "flex", justifyContent: "center", pb: 1 }}>
            <Button
              size="small"
              variant="outlined"
              disabled={busy}
              onClick={() => void loadOlder()}
              data-el-id="amberxvid:messenger:history:older"
              sx={{ py: 0, fontSize: 10.5 }}
            >
              {busy ? "Loading…" : `Load older${oldest ? ` (before ${dayLabel(dayKey(oldest))})` : ""}`}
            </Button>
          </Box>
        )}

        {!loaded ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={20} />
          </Box>
        ) : days.length === 0 ? (
          <Typography sx={{ fontSize: 12, color: theme.text, opacity: 0.7, textAlign: "center", py: 4 }}>
            {loaded.messages.length === 0
              ? "Nothing was ever said in this conversation."
              : query || since
                ? "Nothing loaded matches that. Load older pages and try again — the search only sees what is on screen."
                : "Nothing to show."}
          </Typography>
        ) : (
          days.map((day) => (
            <Box key={day.key} sx={{ mb: 1 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, my: 0.75 }}>
                <Box sx={{ flex: 1, height: 1, bgcolor: gxa(theme.accent, "33") }} />
                <Typography
                  sx={{
                    fontFamily: GX.mono,
                    fontSize: 9,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    color: theme.text,
                    opacity: 0.7,
                  }}
                >
                  {dayLabel(day.key)}
                </Typography>
                <Box sx={{ flex: 1, height: 1, bgcolor: gxa(theme.accent, "33") }} />
              </Box>
              {day.messages.map((m) => {
                const mine = lower(m.from) === lower(me.username);
                return (
                  <Box
                    key={m.id}
                    sx={{
                      display: "flex",
                      gap: 0.75,
                      alignItems: "baseline",
                      py: 0.2,
                      px: 0.5,
                      borderRadius: 0.75,
                      borderLeft: `2px solid ${mine ? theme.accent : gxa(theme.fade[1], "88")}`,
                      bgcolor: gxa(theme.bubble, "88"),
                      mb: 0.25,
                    }}
                  >
                    <Typography
                      sx={{
                        fontFamily: GX.mono,
                        fontSize: 9,
                        color: theme.text,
                        opacity: 0.55,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmtTime(m.sentAt)}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: mine ? theme.accent : theme.text,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {link.screennameFor(m.from)}
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: fontPx,
                        color: theme.text,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {highlight(m.text, query.trim(), theme.accent)}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

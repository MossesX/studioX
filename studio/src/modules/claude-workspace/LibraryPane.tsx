"use client";

/**
 * @file The conversation library pane — P3 step 2, verbatim: *"every
 * conversation with title, timestamp, model, cost; full-text search across
 * message bodies; pin, rename, delete, export."*
 *
 * ── the row is the whole design ──────────────────────────────────────────────
 *
 * Every one of those four facts is on the row, unconditionally, because the
 * reason a library exists is to answer "which one was that?" without opening
 * six conversations. A row that showed only a title would make the model and
 * the cost — the two things you actually search your memory by — invisible
 * until you clicked.
 *
 * The title is frequently the MINTED DEFAULT (`Conversation 2026-08-13 09:41`,
 * the service's fallback when none was given), which is useless for
 * recognition. So the row also carries a preview of the first user message —
 * computed server-side onto the meta, precisely so a 200-conversation lobby is
 * one response rather than 200 record reads.
 *
 * ── search shows WHERE it matched ────────────────────────────────────────────
 *
 * A search result that is just a filtered list makes the reader open each hit
 * to find out why it matched. The excerpts come back with the hits, with the
 * match offsets already computed by the server's matcher, so the highlight is
 * the same answer the filter used rather than a second regex run here that
 * could disagree with it.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { MONO, Stamp, Tag, money } from "./bits";
import { library, useLibrary, visibleMetas } from "./library";
import { projects, useProjects } from "./projects";
import { session, useSession } from "./session";
import type { ConversationMeta, SearchMatch } from "../../claude/types";
import { workspaceUi } from "./ui";

/** An excerpt with its matched ranges marked. The ranges are the SERVER's, so
 *  this only paints them — see the file header on why it does not re-match. */
function Excerpt({ match }: { match: SearchMatch }) {
  const pieces: React.ReactNode[] = [];
  let at = 0;
  match.ranges.forEach(([start, end], index) => {
    if (start > at) pieces.push(match.excerpt.slice(at, start));
    pieces.push(
      <Box
        key={index}
        component="mark"
        sx={{
          background: `color-mix(in srgb, ${token("accent")} 32%, transparent)`,
          color: "inherit",
          borderRadius: 0.4,
          px: "1px"
        }}
      >
        {match.excerpt.slice(start, end)}
      </Box>
    );
    at = end;
  });
  if (at < match.excerpt.length) pieces.push(match.excerpt.slice(at));
  return (
    <Typography sx={{ fontSize: 11.5, color: token("dim"), mt: 0.2 }}>
      <Box component="span" sx={{ ...MONO, fontSize: 10.5, mr: 0.6, opacity: 0.8 }}>
        {match.role === "user" ? "you" : "claude"}
      </Box>
      {pieces}
    </Typography>
  );
}

function Row({
  meta,
  matches,
  active,
  onOpen
}: {
  meta: ConversationMeta;
  matches: readonly SearchMatch[];
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <Box
      data-axf-area="claude-workspace.conversation"
      data-axf-conversation={meta.id}
      data-axf-pinned={meta.pinned ? "1" : "0"}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      sx={{
        px: 1,
        py: 0.7,
        cursor: "pointer",
        borderLeft: `2px solid ${active ? token("accent") : "transparent"}`,
        background: active ? token("panel2") : "transparent",
        "&:hover": { background: token("panel2") }
      }}
    >
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.6 }}>
        {meta.pinned && (
          <Tooltip title="Pinned — kept at the top of the library.">
            <Box component="span" sx={{ color: token("accent"), fontSize: 11, lineHeight: 1 }}>
              ●
            </Box>
          </Tooltip>
        )}
        <Typography
          sx={{
            fontSize: 12.8,
            fontWeight: active ? 700 : 600,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
          title={meta.title}
        >
          {meta.title}
        </Typography>
        <Stamp at={meta.updatedAt} />
      </Box>

      {meta.preview && !matches.length && (
        <Typography
          sx={{
            fontSize: 11.5,
            color: token("dim"),
            mt: 0.1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {meta.preview}
        </Typography>
      )}

      {matches.map((match) => (
        <Excerpt key={`${match.index}-${match.at}`} match={match} />
      ))}

      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.35, flexWrap: "wrap" }}>
        <Tag tone="accent2">{meta.model}</Tag>
        {meta.effort && <Tag tone="dim">{meta.effort}</Tag>}
        <Tag tone="dim">{meta.messageCount} msg</Tag>
        <Tag tone={meta.totalCostUsd > 0 ? "ok" : "dim"}>{money(meta.totalCostUsd)}</Tag>
      </Box>
    </Box>
  );
}

export default function Library({ onNew }: { onNew: () => void }) {
  const state = useLibrary();
  const projectState = useProjects();
  const openId = useSession().id;

  React.useEffect(() => {
    void library.refresh();
    void projects.refresh();
  }, []);

  /**
   * The rows, narrowed to the selected project.
   *
   * Applied HERE rather than server-side, deliberately: the metas are already
   * in hand (one field on each), so a filtered list is a `.filter()` rather
   * than a round trip, and switching projects is instant instead of a spinner.
   * It also composes with search for free — the filter narrows whatever the
   * search left, in the one place `visibleMetas` defines what "the current row
   * set" is, so the pane and the commands cannot disagree about it.
   */
  const metas = React.useMemo(() => {
    const rows = visibleMetas(state);
    if (!projectState.selectedId) return rows;
    return rows.filter((meta) => meta.projectId === projectState.selectedId);
  }, [state, projectState.selectedId]);

  const matchesFor = React.useCallback(
    (id: string): readonly SearchMatch[] =>
      state.hits?.find((hit) => hit.meta.id === id)?.matches ?? [],
    [state.hits]
  );

  return (
    <Box
      data-axf-area="claude-workspace.library"
      sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}
    >
      {/* ------------------------------------------------------------ header */}
      <Box sx={{ p: 0.8, borderBottom: `1px solid ${token("edge")}`, display: "flex", gap: 0.6 }}>
        <TextField
          value={state.query}
          onChange={(e) => library.setQuery(e.target.value)}
          size="small"
          fullWidth
          placeholder="Search every message…"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Glyph id="icon-search" size={13} />
                </InputAdornment>
              ),
              endAdornment: state.searching ? (
                <InputAdornment position="end">
                  <CircularProgress size={12} />
                </InputAdornment>
              ) : state.query ? (
                <InputAdornment position="end">
                  <Button
                    size="small"
                    variant="text"
                    sx={{ minWidth: 0, px: 0.5, fontSize: 11 }}
                    onClick={() => library.setQuery("")}
                  >
                    clear
                  </Button>
                </InputAdornment>
              ) : undefined
            }
          }}
          sx={{ "& input": { fontSize: 12 } }}
        />
        <Tooltip title="Start a new conversation.">
          <Button size="small" variant="contained" onClick={onNew} sx={{ minWidth: 34, px: 0.8 }}>
            +
          </Button>
        </Tooltip>
      </Box>

      {/* ------------------------------------------------------ project filter */}
      {/*
        One control, two jobs: it narrows the list AND it is what the New button
        starts under. Two controls would let the pane show project A while New
        quietly opens in B — a disagreement nobody notices until a turn has run
        in the wrong tree, which is the exact failure a bound directory exists
        to end. `projects.ts` states it as the store's rule.
      */}
      <Box
        sx={{
          px: 0.8,
          pb: 0.8,
          borderBottom: `1px solid ${token("edge")}`,
          display: "flex",
          gap: 0.6,
          alignItems: "center"
        }}
      >
        <TextField
          select
          size="small"
          fullWidth
          value={projectState.selectedId ?? ""}
          onChange={(e) => projects.select(e.target.value || null)}
          slotProps={{ select: { displayEmpty: true } }}
          sx={{ "& .MuiSelect-select": { fontSize: 12, py: 0.5 } }}
        >
          <MenuItem value="">
            <Box component="span" sx={{ color: token("dim") }}>
              All conversations
            </Box>
          </MenuItem>
          {projectState.projects.map((project) => (
            <MenuItem key={project.id} value={project.id}>
              {project.name}
            </MenuItem>
          ))}
        </TextField>
        <Tooltip title="Projects: a bound working directory, standing instructions and knowledge files.">
          <Button
            size="small"
            variant="outlined"
            aria-label="Manage projects"
            onClick={() => workspaceUi.projects(true)}
            sx={{ minWidth: 34, px: 0.8 }}
          >
            <Glyph id="icon-layers" size={13} />
          </Button>
        </Tooltip>
      </Box>

      {/* -------------------------------------------------------------- rows */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {state.error && (
          <Typography sx={{ fontSize: 11.5, color: token("err"), p: 1 }}>{state.error}</Typography>
        )}

        {!state.ready && (
          <Typography sx={{ fontSize: 11.5, color: token("dim"), p: 1 }}>Loading…</Typography>
        )}

        {state.ready && !metas.length && (
          <Typography sx={{ fontSize: 11.5, color: token("dim"), p: 1, lineHeight: 1.6 }}>
            {state.hits
              ? `Nothing matches “${state.query}”. Every term has to appear in one message — quote a phrase to search it whole.`
              : // "The project is empty" and "the library is empty" are
                // different facts and the filter is three lines away, so the
                // one that mentions the filter is the one that stops a reader
                // concluding their conversations are gone.
                projectState.selectedId
                ? `No conversations in “${projects.selected()?.name ?? "this project"}” yet. The + button starts one here, in its bound directory.`
                : "No conversations yet. The + button starts one."}
          </Typography>
        )}

        {metas.map((meta) => (
          <Row
            key={meta.id}
            meta={meta}
            matches={matchesFor(meta.id)}
            active={meta.id === openId}
            onOpen={() => void session.open(meta.id)}
          />
        ))}
      </Box>

      {/* -------------------------------------------------------------- foot */}
      <Box
        sx={{
          px: 1,
          py: 0.4,
          borderTop: `1px solid ${token("edge")}`,
          display: "flex",
          alignItems: "center",
          gap: 0.6
        }}
      >
        {/* Counted off the ROWS ON SCREEN, not off the whole library: a footer
            saying 42 above a list of 3 is a footer that makes the filter look
            broken. */}
        <Typography sx={{ fontSize: 10.5, color: token("dim"), flex: 1 }}>
          {state.hits
            ? `${metas.length} match${metas.length === 1 ? "" : "es"}`
            : `${metas.length} conversation${metas.length === 1 ? "" : "s"}`}
          {projectState.selectedId ? " in project" : ""}
        </Typography>
        <Tooltip title="Right-click a conversation to pin, rename, export or delete it.">
          <Typography sx={{ fontSize: 10.5, color: token("dim") }}>right-click a row</Typography>
        </Tooltip>
        <Button
          size="small"
          variant="text"
          sx={{ fontSize: 10.5, py: 0, minWidth: 0 }}
          onClick={() => {
            void library.refresh();
            workspaceUi.say("Library reloaded");
          }}
        >
          reload
        </Button>
      </Box>
    </Box>
  );
}

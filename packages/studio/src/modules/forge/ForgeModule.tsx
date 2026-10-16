"use client";

/**
 * @file The Forge's ROSTER half — every persona and skill this install can
 * offer, and the text each one would actually contribute to a session.
 *
 * One of the module's two halves, built in parallel by two sessions on
 * 2026-08-13 (see `forge.decl.ts`): this is what you READ, `ForgeDesigner.tsx`
 * is how you CHANGE it, and `ForgeScreen.tsx` is the only place they meet — it
 * owns the tab strip and the module's `data-axf-area` root, so neither half has
 * to touch the other's file. It imports this one as `RosterInspector`.
 *
 * ## What it is FOR, and how that differs from the panel
 *
 * `agent-forge`'s workspace panel is a picker: one conversation, winners only,
 * click to bind. This screen is the inspector, and the difference shows up in
 * three places.
 *
 *   - **Shadowed entries are shown, not filtered.** This repo's `.claude/` is a
 *     generated mirror of `packages/studio/forge/`, so `molly` legitimately
 *     appears twice — once as `project`, once as `studio`. A reader who can see
 *     only the winner cannot tell that mirror apart from an override somebody
 *     wrote by hand, which is exactly the question this screen exists to
 *     answer. The loser renders dimmed and says who beat it.
 *   - **It reads THIS INSTALL'S tree** (`tree=studio`), not a conversation's.
 *     There is no conversation here to have a working directory.
 *   - **It compiles.** Selecting a persona fetches `composePersonaContext`'s
 *     real output — the same string `claude.context-provider` folds into the
 *     system contract — rather than a preview of the file. An unresolved skill
 *     slug is visible there and nowhere else, and that is the failure the join
 *     was built to surface.
 *
 * ## Density, and no explanation on screen
 *
 * Same rules the Build Manager wrote down: 11–12px, tight rows, no max-width,
 * and the reasoning lives in this docblock rather than in captions. The one
 * exception is the scope legend, which is not explanation but DATA — three
 * absolute paths the reader would otherwise have to guess at.
 *
 * MUI throughout (`.claude/rules/no-hand-rolled-ui.md`), `token()` for every
 * colour so a theme roll takes this screen with it.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import {
  fetchPersonaContext,
  fetchRoster,
  type PersonaInfo,
  type Roster,
  type SkillInfo
} from "../../plugins/agent-forge/client";

const MONO = { fontFamily: token("mono"), fontSize: 11, lineHeight: 1.45 } as const;

/** What each scope means, in one line. The paths come from the roster's own
 *  entries, so this cannot describe a directory the scan did not read. */
const SCOPE_NOTE: Record<string, string> = {
  studio: "ships with AmberX — packages/studio/forge/",
  project: "this tree's own .claude/",
  user: "your home directory's ~/.claude/"
};

function ScopeChip({ scope }: { scope: string }) {
  return (
    <Tooltip title={SCOPE_NOTE[scope] ?? scope}>
      <Chip
        size="small"
        label={scope}
        sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.6 } }}
      />
    </Tooltip>
  );
}

/** The directory each scope was read from, derived from the entries themselves
 *  rather than recomputed — a legend that could disagree with the scan is worse
 *  than no legend. */
function scopeRoots(roster: Roster): { scope: string; dir: string; count: number }[] {
  const seen = new Map<string, { scope: string; dir: string; count: number }>();
  for (const entry of [...roster.personas, ...roster.skills]) {
    const dir = entry.file.slice(0, Math.max(entry.file.lastIndexOf("/"), entry.file.lastIndexOf("\\")));
    const hit = seen.get(entry.scope);
    if (hit) hit.count += 1;
    else seen.set(entry.scope, { scope: entry.scope, dir, count: 1 });
  }
  return [...seen.values()];
}

function PersonaRow({
  persona,
  selected,
  onSelect
}: {
  persona: PersonaInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <ListItemButton
      dense
      selected={selected}
      onClick={onSelect}
      sx={{
        px: 0.8,
        py: 0.4,
        borderRadius: "var(--axf-radius-tight)",
        alignItems: "flex-start",
        // Dimmed rather than hidden: the row is real, it is simply not the one
        // a fresh pick would land on.
        opacity: persona.shadowed ? 0.55 : 1
      }}
    >
      <Stack spacing={0.2} sx={{ minWidth: 0, width: "100%" }}>
        <Stack direction="row" spacing={0.6} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 12, fontWeight: selected ? 700 : 500 }}>
            {persona.name}
          </Typography>
          <ScopeChip scope={persona.scope} />
          {persona.disabled && (
            <Tooltip title="Renamed .md.disabled — the CLI's own off switch. Never compiled.">
              <Chip
                size="small"
                label="off"
                sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.6 } }}
              />
            </Tooltip>
          )}
          {persona.shadowed && (
            <Tooltip title="A nearer scope declares this same slug, so a fresh pick gets that one instead.">
              <Chip
                size="small"
                variant="outlined"
                label="shadowed"
                sx={{ height: 16, fontSize: 9, "& .MuiChip-label": { px: 0.6 } }}
              />
            </Tooltip>
          )}
          {persona.model && (
            <Typography sx={{ ...MONO, fontSize: 10, color: token("dim") }}>
              {persona.model}
            </Typography>
          )}
        </Stack>
        <Typography sx={{ fontSize: 11, color: token("dim"), lineHeight: 1.45 }}>
          {persona.description || persona.bodyPreview.split("\n")[0]}
        </Typography>
        {persona.skills?.length ? (
          <Stack direction="row" spacing={0.4} sx={{ flexWrap: "wrap", pt: 0.2 }}>
            <Glyph id="icon-sparkle" size={11} />
            {persona.skills.map((slug) => (
              <Typography key={slug} sx={{ ...MONO, fontSize: 10, color: token("dim") }}>
                {slug}
              </Typography>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </ListItemButton>
  );
}

function SkillRow({ skill }: { skill: SkillInfo }) {
  return (
    <Stack
      direction="row"
      spacing={0.8}
      sx={{ alignItems: "baseline", py: 0.25, opacity: skill.shadowed ? 0.55 : 1 }}
    >
      <Typography sx={{ ...MONO, minWidth: 168, color: token("fg") }}>{skill.slug}</Typography>
      <ScopeChip scope={skill.scope} />
      <Typography
        sx={{
          fontSize: 11,
          color: token("dim"),
          lineHeight: 1.45,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {skill.description || "—"}
      </Typography>
    </Stack>
  );
}

export default function ForgeModule() {
  const [roster, setRoster] = React.useState<Roster | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [brief, setBrief] = React.useState<string | null>(null);
  const [briefError, setBriefError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    fetchRoster("studio")
      .then((r) => alive && setRoster(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!selected) {
      setBrief(null);
      setBriefError(null);
      return;
    }
    let alive = true;
    setBrief(null);
    setBriefError(null);
    fetchPersonaContext("studio", selected)
      .then((text) => alive && setBrief(text))
      .catch((e: unknown) => alive && setBriefError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [selected]);

  if (error) {
    return (
      <Typography sx={{ fontSize: 12, color: token("err"), p: 1.2 }}>
        The roster could not be read: {error}
      </Typography>
    );
  }

  if (!roster) {
    return (
      <Box sx={{ p: 1.2 }}>
        <CircularProgress size={16} />
      </Box>
    );
  }

  const shadowed = roster.personas.filter((p) => p.shadowed).length;

  return (
    <Stack spacing={0.9} sx={{ p: 1.2 }}>
      <Stack direction="row" spacing={0.8} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <Glyph id="icon-bolt" size={15} />
        <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Forge</Typography>
        <Typography sx={{ fontSize: 11, color: token("dim") }}>
          {roster.personas.length} persona(s), {roster.skills.length} skill(s)
          {shadowed > 0 ? `, ${shadowed} shadowed` : ""}
        </Typography>
      </Stack>

      <Stack spacing={0.1}>
        {scopeRoots(roster).map(({ scope, dir, count }) => (
          <Stack key={scope} direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
            <ScopeChip scope={scope} />
            <Typography sx={{ ...MONO, fontSize: 10, color: token("dim"), wordBreak: "break-all" }}>
              {dir} · {count}
            </Typography>
          </Stack>
        ))}
      </Stack>

      <Divider />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "minmax(320px, 2fr) 3fr" },
          gap: 1.2,
          alignItems: "start"
        }}
      >
        <Stack spacing={0.4} sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 700 }}>Personas</Typography>
          <List dense disablePadding>
            {roster.personas.map((persona) => (
              <PersonaRow
                key={persona.id}
                persona={persona}
                selected={selected === persona.id}
                // Clicking the open one closes it — the only way back to no
                // selection without a second control for it.
                onSelect={() => setSelected(selected === persona.id ? null : persona.id)}
              />
            ))}
          </List>
        </Stack>

        <Stack spacing={0.4} sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 700 }}>
            {selected ? "Compiled brief" : "Select a persona to compile it"}
          </Typography>
          {selected && !brief && !briefError && <CircularProgress size={14} />}
          {briefError && (
            <Typography sx={{ fontSize: 11, color: token("err"), lineHeight: 1.5 }}>
              {briefError}
            </Typography>
          )}
          {brief && (
            <Box
              component="pre"
              sx={{
                ...MONO,
                m: 0,
                p: 0.9,
                maxHeight: 520,
                overflow: "auto",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                bgcolor: token("panel"),
                border: `1px solid ${token("line")}`,
                borderRadius: "var(--axf-radius-tight)"
              }}
            >
              {brief}
            </Box>
          )}
          {!selected && (
            <Typography sx={{ fontSize: 11, color: token("dim"), lineHeight: 1.5 }}>
              This is the exact text `claude.context-provider` folds into a session&apos;s system
              contract on its first turn — declared skills resolved, unresolved ones marked.
            </Typography>
          )}
        </Stack>
      </Box>

      <Divider />

      <Typography sx={{ fontSize: 11.5, fontWeight: 700 }}>Skills</Typography>
      <Stack spacing={0}>
        {roster.skills.map((skill) => (
          <SkillRow key={skill.id} skill={skill} />
        ))}
      </Stack>
    </Stack>
  );
}

"use client";

/**
 * @file Agent Forge's `claude-workspace.panel` contribution — the roster of
 * personas and skills the open conversation's tree actually carries, and the
 * one control that binds one of them to it.
 *
 * ── it reads the conversation from the module's store, and that is the point ─
 *
 * `claude-workspace/points.ts` states the decision this depends on: a panel
 * supplies `render()` and is called with NOTHING, then reads the open
 * conversation from `session.ts` — *"passing the record in as a prop would make
 * the panel's signature part of the contract, so widening it later would break
 * every contribution. A store a panel reads is a seam that widens without a
 * version bump."* This is the first contribution to take that seam up, and it
 * needs the widening the argument predicted: it wants `record.cwd`, which
 * arrived with projects in P4 and would have been a breaking prop change.
 *
 * ── binding vs. quoting ─────────────────────────────────────────────────────
 *
 * Binding a persona is persistent and SERVER-side: `claude.context-provider`
 * folds it into the system contract on the conversation's first turn. It is
 * therefore only meaningful BEFORE that turn, and the pane says so rather than
 * offering a control that would silently do nothing — a resumed session already
 * carries its history, and the broker ignores `system` when `--resume` is on
 * the command line. For a conversation already under way there is the composer
 * action, which pastes the same text into one message.
 *
 * ── the panel is a PICKER, so it shows winners only ─────────────────────────
 *
 * Shadowed entries are filtered out here and nowhere else. `scanRoster` returns
 * every scope's copy flagged, because `/forge` is an INSPECTOR and a reader
 * there needs to see that this repo's `.claude/agents/molly.md` and the
 * studio's shipped `forge/agents/molly.md` are one persona listed twice. A
 * picker with two identical Mollys in it is a picker with a wrong row in it,
 * and the row that would lose the precedence contest is the wrong one to offer.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { useSession } from "../../modules/claude-workspace/session";
import { fetchRoster, readBinding, writeBinding, type Roster } from "./client";

const MONO = { fontFamily: token("mono"), fontSize: 10.5 } as const;

export default function AgentForgePanel() {
  const state = useSession();
  const record = state.record;
  const cwd = record?.cwd ?? null;
  const conversationId = record?.id ?? null;
  /** A conversation the CLI has already answered in. Binding is first-turn
   *  only, so this is what turns the rows read-only. */
  const started = Boolean(record?.cliSessionId);

  const [roster, setRoster] = React.useState<Roster | null>(null);
  const [bound, setBound] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!cwd) {
      setRoster(null);
      return;
    }
    let alive = true;
    setError(null);
    fetchRoster(cwd)
      .then((r) => alive && setRoster(r))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [cwd]);

  React.useEffect(() => {
    if (!conversationId) {
      setBound(null);
      return;
    }
    let alive = true;
    readBinding(conversationId)
      .then((id) => alive && setBound(id))
      .catch(() => alive && setBound(null));
    return () => {
      alive = false;
    };
  }, [conversationId]);

  async function bind(personaId: string): Promise<void> {
    if (!conversationId || busy) return;
    // Toggle: clicking the bound persona unbinds it, which is the only way back
    // to "no persona" without a second control for it.
    const next = bound === personaId ? null : personaId;
    setBusy(true);
    setError(null);
    const previous = bound;
    setBound(next);
    try {
      await writeBinding(conversationId, next);
    } catch (e: unknown) {
      // Put the row back. An optimistic update that survives a failed write is
      // a panel telling the reader something the disk does not agree with.
      setBound(previous);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Winners only — see the picker note in the file header. */
  const personas = roster?.personas.filter((p) => !p.shadowed) ?? [];
  const skills = roster?.skills.filter((s) => !s.shadowed) ?? [];

  if (!record) {
    return (
      <Typography sx={{ fontSize: 11.5, color: token("dim"), lineHeight: 1.6 }}>
        Open a conversation and this lists the personas and skills available to it — the studio&apos;s
        own roster, plus the <code>.claude/</code> files the CLI itself loads for its working
        directory.
      </Typography>
    );
  }

  return (
    <Stack spacing={0.8}>
      <Typography sx={{ ...MONO, color: token("dim"), wordBreak: "break-all" }}>{cwd}</Typography>

      {error && (
        <Typography sx={{ fontSize: 11, color: token("err"), lineHeight: 1.6 }}>{error}</Typography>
      )}

      {!roster && !error && <CircularProgress size={14} />}

      {roster && (
        <>
          <Stack direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
            <Glyph id="icon-account" size={13} />
            <Typography sx={{ fontSize: 11.5, fontWeight: 700 }}>
              Personas ({personas.length})
            </Typography>
          </Stack>

          {started && (
            <Typography sx={{ fontSize: 10.5, color: token("dim"), lineHeight: 1.6 }}>
              This session has already started, so a binding would never reach it — the contract is
              composed on the first turn only. Use the composer action to paste a persona into one
              message instead.
            </Typography>
          )}

          {personas.length === 0 ? (
            <Typography sx={{ fontSize: 11, color: token("dim"), lineHeight: 1.6 }}>
              No personas — nothing in <code>forge/agents</code>, this tree&apos;s{" "}
              <code>.claude/agents</code>, or your home directory.
            </Typography>
          ) : (
            <List dense disablePadding>
              {personas.map((persona) => (
                <ListItemButton
                  key={persona.id}
                  dense
                  disabled={busy || started || persona.disabled}
                  selected={bound === persona.id}
                  onClick={() => void bind(persona.id)}
                  sx={{ px: 0.8, py: 0.3, borderRadius: "var(--axf-radius-tight)" }}
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
                        <Typography sx={{ fontSize: 11.5, fontWeight: bound === persona.id ? 700 : 400 }}>
                          {persona.name}
                        </Typography>
                        <Chip
                          size="small"
                          label={persona.scope}
                          sx={{ height: 15, fontSize: 9, "& .MuiChip-label": { px: 0.6 } }}
                        />
                        {persona.disabled && (
                          <Chip
                            size="small"
                            label="off"
                            sx={{ height: 15, fontSize: 9, "& .MuiChip-label": { px: 0.6 } }}
                          />
                        )}
                        {persona.skills?.length ? (
                          <Tooltip title={`Declares: ${persona.skills.join(", ")}`}>
                            <Box component="span" sx={{ display: "inline-flex" }}>
                              <Glyph id="icon-sparkle" size={11} />
                            </Box>
                          </Tooltip>
                        ) : null}
                      </Stack>
                    }
                    secondary={
                      <Typography
                        sx={{
                          fontSize: 10.5,
                          color: token("dim"),
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        }}
                      >
                        {persona.description || persona.bodyPreview.split("\n")[0]}
                      </Typography>
                    }
                    slotProps={{ secondary: { component: "span" } }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}

          <Divider />

          <Stack direction="row" spacing={0.6} sx={{ alignItems: "center" }}>
            <Glyph id="icon-sparkle" size={13} />
            <Typography sx={{ fontSize: 11.5, fontWeight: 700 }}>
              Skills ({skills.length})
            </Typography>
          </Stack>
          {skills.length === 0 ? (
            <Typography sx={{ fontSize: 11, color: token("dim") }}>No skill bundles.</Typography>
          ) : (
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
              {skills.map((skill) => (
                <Tooltip key={skill.id} title={skill.description || skill.slug}>
                  <Chip
                    size="small"
                    label={skill.slug}
                    variant={skill.disabled ? "outlined" : "filled"}
                    sx={{ height: 18, fontSize: 10, "& .MuiChip-label": { px: 0.7 } }}
                  />
                </Tooltip>
              ))}
            </Box>
          )}
        </>
      )}
    </Stack>
  );
}

"use client";

/**
 * @file The Recorder tab — a full interactive browser plus a tape deck.
 *
 * The left side is the live `BrowserPane` in interactive mode: every click,
 * keystroke and scroll is forwarded to the server-side page, and while the
 * tape is rolling the server logs each one (selector-resolved) into the
 * recording. The right rail is the deck: record / pause / stop-and-save, the
 * live action log, the saved recordings (replayable here, or as a "Replay
 * recording" step in any workflow), and a link harvester that saves what it
 * finds as a named link list.
 *
 * The session id is stable for the page's lifetime, so switching tabs and
 * coming back reattaches to the SAME page — a login you performed is still
 * there. The server closes it after ten idle minutes.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import BrowserPane from "./BrowserPane";
import { browserOp } from "./browserClient";
import { uid } from "./id";
import { deleteRecording, saveRecording, upsertList, useFirecrawlStore } from "./store";
import { MONO } from "./viewers";
import type { BrowserAction, BrowserEvent } from "./types";

/** One recorder page per browser tab, surviving stage switches. */
let recorderSessionId: string | null = null;
function sessionIdFor(): string {
  recorderSessionId ??= uid("recbs");
  return recorderSessionId;
}

type DeckState = "idle" | "recording" | "paused";

export default function RecorderPanel() {
  const sessionId = React.useMemo(sessionIdFor, []);
  const { recordings } = useFirecrawlStore();
  const [deck, setDeck] = React.useState<DeckState>("idle");
  const [log, setLog] = React.useState<readonly BrowserAction[]>([]);
  const [nameDraft, setNameDraft] = React.useState("");
  const [pending, setPending] = React.useState<{ startUrl: string; actions: readonly BrowserAction[] } | null>(null);
  const [harvest, setHarvest] = React.useState<readonly string[] | null>(null);
  const [listName, setListName] = React.useState("");
  const [replaying, setReplaying] = React.useState<string | null>(null);
  const [note, setNote] = React.useState<string | null>(null);
  const logEndRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [log.length]);

  const onEvent = React.useCallback((event: BrowserEvent) => {
    if (event.type === "action") setLog((prev) => [...prev.slice(-199), event.action]);
  }, []);

  const start = async () => {
    setLog([]);
    setPending(null);
    await browserOp({ op: "record-start", sessionId });
    setDeck("recording");
  };
  const pause = async () => {
    await browserOp({ op: "record-pause", sessionId });
    setDeck("paused");
  };
  const resume = async () => {
    await browserOp({ op: "record-resume", sessionId });
    setDeck("recording");
  };
  const stop = async () => {
    const res = await browserOp({ op: "record-stop", sessionId });
    setDeck("idle");
    if (res.actions?.length) {
      setPending({ startUrl: res.startUrl ?? "", actions: res.actions });
      setNameDraft(`Recording ${new Date().toLocaleTimeString()}`);
    } else {
      setNote("Nothing recorded — perform some actions while the tape rolls.");
    }
  };
  const savePending = () => {
    if (!pending) return;
    const name = nameDraft.trim() || "Untitled recording";
    saveRecording(name, pending.startUrl, pending.actions);
    setPending(null);
    setNote(`Saved "${name}" — replay it here, or add a "Replay recording" step to a workflow.`);
  };

  const extract = async () => {
    setHarvest(null);
    const res = await browserOp({ op: "extract-links", sessionId, delayMs: 60 });
    if (res.urls) {
      setHarvest(res.urls);
      setListName("");
    } else if (res.error) {
      setNote(res.error);
    }
  };
  const saveHarvest = () => {
    if (!harvest) return;
    const name = listName.trim();
    if (!name) return;
    upsertList(name, harvest, "replace", "recorder harvest");
    setHarvest(null);
    setNote(`Saved link list "${name}" (${harvest.length} links).`);
  };

  const replay = async (id: string) => {
    const rec = recordings.find((r) => r.id === id);
    if (!rec) return;
    setReplaying(id);
    setLog([]);
    const res = await browserOp({ op: "replay", sessionId, url: rec.startUrl, actions: rec.actions, delayMs: 600 });
    setReplaying(null);
    setNote(res.error ? `Replay hit a wall: ${res.error}` : `Replayed "${rec.name}".`);
  };

  return (
    <Stack direction="row" sx={{ height: "100%", minHeight: 0 }}>
      {/* the live browser */}
      <Box sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <BrowserPane sessionId={sessionId} interactive chrome onEvent={onEvent} />
      </Box>

      {/* the deck */}
      <Stack
        sx={{ width: 320, flexShrink: 0, borderLeft: `1px solid ${token("edge")}`, overflow: "auto", p: 1.25, gap: 1.25 }}
      >
        <Stack direction="row" sx={{ gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
          {deck === "idle" ? (
            <Button size="small" variant="contained" color="error" sx={{ fontSize: 11.5 }} onClick={() => void start()}>
              ● Record
            </Button>
          ) : (
            <>
              {deck === "recording" ? (
                <Button size="small" variant="outlined" sx={{ fontSize: 11.5 }} onClick={() => void pause()}>
                  ⏸ Pause
                </Button>
              ) : (
                <Button size="small" variant="contained" sx={{ fontSize: 11.5 }} onClick={() => void resume()}>
                  ▶ Resume
                </Button>
              )}
              <Button size="small" variant="outlined" color="error" sx={{ fontSize: 11.5 }} onClick={() => void stop()}>
                ■ Stop
              </Button>
              <Chip
                size="small"
                color={deck === "recording" ? "error" : "default"}
                label={deck === "recording" ? "REC" : "paused"}
                sx={{ fontSize: 10.5, fontWeight: 700 }}
              />
            </>
          )}
          <Box sx={{ flex: 1 }} />
          <Tooltip title="Harvest every link on the current page (highlights as it sweeps)">
            <Button size="small" variant="outlined" sx={{ fontSize: 11.5 }} onClick={() => void extract()}>
              ⛏ Links
            </Button>
          </Tooltip>
        </Stack>

        {pending && (
          <Stack sx={{ gap: 0.75, border: `1px solid ${token("edge")}`, borderRadius: token("radius-tight"), p: 1 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
              Save recording · {pending.actions.length} actions
            </Typography>
            <TextField
              size="small"
              fullWidth
              label="Name"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              sx={{ "& .MuiInputBase-input": { fontSize: 12.5 } }}
            />
            <Stack direction="row" sx={{ gap: 0.75 }}>
              <Button size="small" variant="contained" sx={{ fontSize: 11 }} onClick={savePending}>
                Save
              </Button>
              <Button size="small" sx={{ fontSize: 11, color: token("dim") }} onClick={() => setPending(null)}>
                Discard
              </Button>
            </Stack>
          </Stack>
        )}

        {harvest && (
          <Stack sx={{ gap: 0.75, border: `1px solid ${token("edge")}`, borderRadius: token("radius-tight"), p: 1 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 700 }}>
              {harvest.length} links harvested
            </Typography>
            <TextField
              size="small"
              fullWidth
              label="Save as list"
              placeholder="e.g. article pages"
              value={listName}
              onChange={(e) => setListName(e.target.value)}
              sx={{ "& .MuiInputBase-input": { fontSize: 12.5 } }}
            />
            <Stack direction="row" sx={{ gap: 0.75 }}>
              <Button size="small" variant="contained" sx={{ fontSize: 11 }} disabled={!listName.trim()} onClick={saveHarvest}>
                Save list
              </Button>
              <Button size="small" sx={{ fontSize: 11, color: token("dim") }} onClick={() => setHarvest(null)}>
                Dismiss
              </Button>
            </Stack>
          </Stack>
        )}

        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: token("dim") }}>
          Action log
        </Typography>
        <Stack
          sx={{
            gap: 0.25,
            minHeight: 60,
            maxHeight: 220,
            overflow: "auto",
            border: `1px solid ${token("edge")}`,
            borderRadius: token("radius-tight"),
            p: 0.75
          }}
        >
          {log.length === 0 && (
            <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
              Drive the page on the left — every action lands here{deck !== "idle" ? " and on the tape" : ""}.
            </Typography>
          )}
          {log.map((action, i) => (
            <Typography key={i} noWrap sx={{ ...MONO, fontSize: 10.5, color: token("ink") }}>
              {String(i + 1).padStart(2, "0")} · {action.label ?? action.kind}
            </Typography>
          ))}
          <div ref={logEndRef} />
        </Stack>

        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: token("dim") }}>
          Saved recordings
        </Typography>
        {recordings.length === 0 && (
          <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
            None yet. Record a chain — visit, log in, search, click through — then replay it here or
            from a workflow step.
          </Typography>
        )}
        {recordings.map((rec) => (
          <Stack
            key={rec.id}
            direction="row"
            sx={{
              gap: 0.5,
              alignItems: "center",
              border: `1px solid ${token("edge")}`,
              borderRadius: token("radius-tight"),
              px: 0.75,
              py: 0.5
            }}
          >
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 12 }}>{rec.name}</Typography>
              <Typography noWrap sx={{ fontSize: 10, color: token("dim") }}>
                {rec.actions.length} actions · {rec.startUrl || "no start URL"}
              </Typography>
            </Stack>
            <Tooltip title="Replay in this browser">
              <span>
                <IconButton
                  size="small"
                  disabled={replaying !== null}
                  onClick={() => void replay(rec.id)}
                  sx={{ fontSize: 12, width: 24, height: 24, color: token("ok") }}
                >
                  {replaying === rec.id ? "…" : "▶"}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Delete recording">
              <IconButton
                size="small"
                onClick={() => deleteRecording(rec.id)}
                sx={{ fontSize: 12, width: 24, height: 24, color: token("err") }}
              >
                ✕
              </IconButton>
            </Tooltip>
          </Stack>
        ))}

        {note && (
          <Typography sx={{ fontSize: 11.5, color: token("dim") }} onClick={() => setNote(null)}>
            {note}
          </Typography>
        )}
      </Stack>
    </Stack>
  );
}

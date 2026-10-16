"use client";

/**
 * @file Firecrawl module — the /firecrawl screen.
 *
 * Layout: a rail (workflows, datasets) beside a three-tab stage (Builder ·
 * Run · Data). The rail rows and the stage mark `data-axf-area` ids from the
 * decl, so every right-click verb arrives through the registered menu map
 * rather than handlers here — taskman's arrangement.
 *
 * The screen owns exactly what nothing smaller can:
 *
 *   1. **The live run.** `streamRun` folds `RunEvent`s through `reduceRun`
 *      into component state; the abort controller lives here so Stop, a
 *      workflow switch and an unmount all end the stream the same way.
 *   2. **The command seam.** `firecrawl.workflow.run` and
 *      `firecrawl.dataset.view` are plain functions in another file; the
 *      window events they dispatch land here, where the React state is.
 *   3. **The connection strip.** Key presence comes from
 *      `/api/firecrawl/config` (presence only, never the key); the strip
 *      offers a field to store one when none is set.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import Builder from "./Builder";
import DataPanel from "./DataPanel";
import RecorderPanel from "./RecorderPanel";
import RunPanel, { IDLE_RUN, reduceRun } from "./RunPanel";
import type { RunState } from "./RunPanel";
import { outputContent, outputKind } from "./exporters";
import { uid } from "./id";
import { controlRun, streamRun } from "./runClient";
import { getFirecrawlSettings, useFirecrawlSettings } from "./settings";
import {
  deleteList,
  deleteRecording,
  firecrawlStore,
  newWorkflow,
  saveDataset,
  updateWorkflow,
  upsertList,
  useFirecrawlStore
} from "./store";
import { RUN_WORKFLOW_EVENT, VIEW_DATASET_EVENT } from "./ui";
import { BROWSER_KINDS } from "./types";
import type { Dataset, FirecrawlConfigInfo, StepOutput, Workflow } from "./types";

type Stage = "builder" | "run" | "data" | "recorder";

export default function FirecrawlModule() {
  const state = useFirecrawlStore();
  const settings = useFirecrawlSettings();
  const [selectedWf, setSelectedWf] = React.useState<string | null>(null);
  const [selectedDs, setSelectedDs] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<Stage>("builder");
  const [run, setRun] = React.useState<RunState>(IDLE_RUN);
  const [config, setConfig] = React.useState<FirecrawlConfigInfo | null>(null);
  const [keyDraft, setKeyDraft] = React.useState("");
  const [note, setNote] = React.useState<string | null>(null);
  const [speed, setSpeed] = React.useState(() => getFirecrawlSettings().stepDelayMs);
  const [runSession, setRunSession] = React.useState<string | null>(null);
  /** A stored link list opened read-only in the Data tab (synthetic dataset). */
  const [listView, setListView] = React.useState<Dataset | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);
  const runningWfRef = React.useRef<Workflow | null>(null);
  const runIdRef = React.useRef<string | null>(null);
  const runSessionRef = React.useRef<string | null>(null);
  const speedRef = React.useRef(speed);
  speedRef.current = speed;

  const workflow = state.workflows.find((wf) => wf.id === selectedWf) ?? state.workflows[0] ?? null;
  const dataset = state.datasets.find((ds) => ds.id === selectedDs) ?? state.datasets[0] ?? null;

  /* ── connection status ─────────────────────────────────────────────── */

  const refreshConfig = React.useCallback(async () => {
    try {
      const res = await fetch("/api/firecrawl/config");
      setConfig((await res.json()) as FirecrawlConfigInfo);
    } catch {
      setConfig(null);
    }
  }, []);
  React.useEffect(() => void refreshConfig(), [refreshConfig]);

  const storeKey = async () => {
    const apiKey = keyDraft.trim();
    if (!apiKey) return;
    const res = await fetch("/api/firecrawl/config", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey })
    });
    if (res.ok) {
      setKeyDraft("");
      setNote("Key stored server-side. It never rides back to the browser.");
      void refreshConfig();
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setNote(body.error ?? "The key was refused.");
    }
  };

  /* ── running ───────────────────────────────────────────────────────── */

  const startRun = React.useCallback(
    (wf: Workflow, startAt = 0) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      runningWfRef.current = wf;
      const runId = uid("run");
      runIdRef.current = runId;
      // Watchable steps drive ONE stable live session per screen life, so the
      // viewer pane reattaches to the same page run after run.
      const hasBrowser = wf.steps.some((s) => BROWSER_KINDS.includes(s.kind));
      const sessionId = hasBrowser ? (runSessionRef.current ??= uid("runbs")) : null;
      setRunSession(sessionId);
      setStage("run");
      setRun({ ...IDLE_RUN, running: true });
      const stored = firecrawlStore.getState();
      void streamRun(
        wf,
        {
          runId,
          analyzeBudget: getFirecrawlSettings().analyzeBudget,
          startAt,
          stepDelayMs: speedRef.current,
          sessionId: sessionId ?? undefined,
          lists: stored.lists,
          recordings: stored.recordings
        },
        controller.signal,
        (event) => {
          setRun((prev) => reduceRun(prev, event));
          if (event.type === "list") {
            upsertList(event.name, event.urls, event.listMode, event.source);
          }
          if (event.type === "done" && event.output) {
            autosave(wf, event.output);
          }
        }
      ).catch(() => {
        // An aborted fetch rejects; the Stop button already told the user.
      });
    },
    []
  );

  const autosave = (wf: Workflow, output: StepOutput) => {
    if (!getFirecrawlSettings().autosaveDatasets) return;
    saveDataset({
      name: `${wf.name} · ${new Date().toLocaleString()}`,
      kind: outputKind(output),
      content: outputContent(output),
      workflowId: wf.id,
      workflowName: wf.name
    });
  };

  const stopRun = () => {
    // Two abort paths on purpose: the control stop reaches a run whose stream
    // is mid-flight server-side; the fetch abort covers one that has not
    // answered yet. Either alone suffices — together they always land.
    if (runIdRef.current) void controlRun(runIdRef.current, "stop");
    abortRef.current?.abort();
    setRun((prev) => ({ ...prev, running: false, paused: false }));
  };

  const pauseRun = () => {
    if (runIdRef.current) void controlRun(runIdRef.current, "pause");
  };
  const resumeRun = () => {
    if (runIdRef.current) void controlRun(runIdRef.current, "resume");
  };
  const changeSpeed = (ms: number) => {
    setSpeed(ms);
    if (runIdRef.current) void controlRun(runIdRef.current, "speed", ms);
  };

  // Abort a live stream when the screen unmounts — a dismissed run must stop
  // scraping and stop the provider call (the run route's docblock).
  React.useEffect(() => () => abortRef.current?.abort(), []);

  /* ── the command seam ──────────────────────────────────────────────── */

  React.useEffect(() => {
    const onRun = (e: Event) => {
      const id = (e as CustomEvent<{ workflowId?: string }>).detail?.workflowId;
      const wf = firecrawlStore.getState().workflows.find((w) => w.id === id);
      if (wf) {
        setSelectedWf(wf.id);
        startRun(wf);
      }
    };
    const onView = (e: Event) => {
      const id = (e as CustomEvent<{ datasetId?: string }>).detail?.datasetId;
      if (id) {
        setSelectedDs(id);
        setListView(null);
        setStage("data");
      }
    };
    window.addEventListener(RUN_WORKFLOW_EVENT, onRun);
    window.addEventListener(VIEW_DATASET_EVENT, onView);
    return () => {
      window.removeEventListener(RUN_WORKFLOW_EVENT, onRun);
      window.removeEventListener(VIEW_DATASET_EVENT, onView);
    };
  }, [startRun]);

  /* ── render ────────────────────────────────────────────────────────── */

  void settings;
  return (
    <Box
      data-axf-area="firecrawl.surface"
      sx={{ display: "flex", height: "100%", minHeight: 0, background: token("page") }}
    >
      {/* rail */}
      <Stack
        sx={{
          width: 250,
          flexShrink: 0,
          borderRight: `1px solid ${token("edge")}`,
          overflow: "auto"
        }}
      >
        <Stack direction="row" sx={{ alignItems: "center", px: 1.25, pt: 1 }}>
          <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: token("dim"), flex: 1 }}>
            Workflows
          </Typography>
          <Tooltip title="New workflow">
            <IconButton
              size="small"
              onClick={() => {
                const wf = newWorkflow();
                setSelectedWf(wf.id);
                setStage("builder");
              }}
            >
              +
            </IconButton>
          </Tooltip>
        </Stack>
        {state.workflows.map((wf) => (
          <Box
            key={wf.id}
            data-axf-area="firecrawl.workflow"
            data-axf-workflow={wf.id}
            onClick={() => {
              setSelectedWf(wf.id);
              if (stage === "data") setStage("builder");
            }}
            sx={{
              px: 1.25,
              py: 0.6,
              cursor: "pointer",
              background: workflow?.id === wf.id ? token("panel") : "transparent",
              borderLeft: `2px solid ${workflow?.id === wf.id ? token("accent") : "transparent"}`,
              "&:hover": { background: token("panel") }
            }}
          >
            <Typography noWrap sx={{ fontSize: 13 }}>{wf.name}</Typography>
            <Typography noWrap sx={{ fontSize: 10.5, color: token("dim") }}>
              {wf.steps.length} step{wf.steps.length === 1 ? "" : "s"}
            </Typography>
          </Box>
        ))}
        {state.loaded && state.workflows.length === 0 && (
          <Typography sx={{ px: 1.25, py: 1, fontSize: 12, color: token("dim") }}>
            None yet — right-click anywhere for an example, or hit +.
          </Typography>
        )}

        <Typography sx={{ px: 1.25, pt: 2, pb: 0.5, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: token("dim") }}>
          Datasets
        </Typography>
        {state.datasets.map((ds) => (
          <Box
            key={ds.id}
            data-axf-area="firecrawl.dataset"
            data-axf-dataset={ds.id}
            onClick={() => {
              setSelectedDs(ds.id);
              setListView(null);
              setStage("data");
            }}
            sx={{
              px: 1.25,
              py: 0.6,
              cursor: "pointer",
              background: stage === "data" && dataset?.id === ds.id ? token("panel") : "transparent",
              borderLeft: `2px solid ${stage === "data" && dataset?.id === ds.id ? token("accent") : "transparent"}`,
              "&:hover": { background: token("panel") }
            }}
          >
            <Typography noWrap sx={{ fontSize: 12.5 }}>{ds.name}</Typography>
            <Typography noWrap sx={{ fontSize: 10.5, color: token("dim") }}>
              {ds.kind} · {(ds.content.length / 1024).toFixed(1)} KB
            </Typography>
          </Box>
        ))}
        {state.loaded && state.datasets.length === 0 && (
          <Typography sx={{ px: 1.25, py: 1, fontSize: 12, color: token("dim") }}>
            Run results land here.
          </Typography>
        )}

        <Typography sx={{ px: 1.25, pt: 2, pb: 0.5, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: token("dim") }}>
          Link lists
        </Typography>
        {state.lists.map((list) => (
          <Stack
            key={list.id}
            direction="row"
            onClick={() => {
              setListView({
                id: list.id,
                name: `list · ${list.name}`,
                kind: "json",
                content: JSON.stringify(list.urls, null, 2),
                createdAt: list.createdAt
              });
              setStage("data");
            }}
            sx={{
              px: 1.25,
              py: 0.6,
              cursor: "pointer",
              alignItems: "center",
              gap: 0.5,
              background: stage === "data" && listView?.id === list.id ? token("panel") : "transparent",
              borderLeft: `2px solid ${stage === "data" && listView?.id === list.id ? token("accent") : "transparent"}`,
              "&:hover": { background: token("panel") }
            }}
          >
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 12.5 }}>{list.name}</Typography>
              <Typography noWrap sx={{ fontSize: 10.5, color: token("dim") }}>
                {list.urls.length} link{list.urls.length === 1 ? "" : "s"}
                {list.source ? ` · ${list.source}` : ""}
              </Typography>
            </Stack>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                if (listView?.id === list.id) setListView(null);
                deleteList(list.id);
              }}
              sx={{ fontSize: 11, width: 20, height: 20, color: token("dim") }}
            >
              ✕
            </IconButton>
          </Stack>
        ))}
        {state.loaded && state.lists.length === 0 && (
          <Typography sx={{ px: 1.25, py: 1, fontSize: 12, color: token("dim") }}>
            Harvest / paginate / for-each steps save lists here.
          </Typography>
        )}

        <Typography sx={{ px: 1.25, pt: 2, pb: 0.5, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: token("dim") }}>
          Recordings
        </Typography>
        {state.recordings.map((rec) => (
          <Stack
            key={rec.id}
            direction="row"
            onClick={() => setStage("recorder")}
            sx={{
              px: 1.25,
              py: 0.6,
              cursor: "pointer",
              alignItems: "center",
              gap: 0.5,
              "&:hover": { background: token("panel") }
            }}
          >
            <Stack sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 12.5 }}>{rec.name}</Typography>
              <Typography noWrap sx={{ fontSize: 10.5, color: token("dim") }}>
                {rec.actions.length} action{rec.actions.length === 1 ? "" : "s"}
              </Typography>
            </Stack>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                deleteRecording(rec.id);
              }}
              sx={{ fontSize: 11, width: 20, height: 20, color: token("dim") }}
            >
              ✕
            </IconButton>
          </Stack>
        ))}
        {state.loaded && state.recordings.length === 0 && (
          <Typography sx={{ px: 1.25, py: 1, fontSize: 12, color: token("dim") }}>
            The Recorder tab saves action chains here.
          </Typography>
        )}
      </Stack>

      {/* stage */}
      <Stack sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <Stack direction="row" sx={{ gap: 1, alignItems: "center", px: 1.5, pt: 1, flexWrap: "wrap" }}>
          {workflow ? (
            <TextField
              size="small"
              variant="standard"
              value={workflow.name}
              onChange={(e) => updateWorkflow(workflow.id, { name: e.target.value })}
              sx={{ width: 280, "& .MuiInputBase-input": { fontSize: 15, fontWeight: 700 } }}
            />
          ) : (
            <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Firecrawl</Typography>
          )}
          <Box sx={{ flex: 1 }} />
          {config &&
            (config.hasKey ? (
              <Tooltip title={config.source === "env" ? "FIRECRAWL_API_KEY from the server environment" : "Key stored in the studio's kv store"}>
                <Chip size="small" color="success" variant="outlined" label={`connected · ${config.source}`} sx={{ fontSize: 10.5 }} />
              </Tooltip>
            ) : (
              <Stack direction="row" sx={{ gap: 0.5, alignItems: "center" }}>
                <Chip size="small" color="warning" variant="outlined" label="no API key" sx={{ fontSize: 10.5 }} />
                <TextField
                  size="small"
                  type="password"
                  placeholder="fc-…"
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  sx={{ width: 160, "& .MuiInputBase-input": { fontSize: 12, py: 0.5 } }}
                />
                <Button size="small" variant="outlined" sx={{ fontSize: 11 }} onClick={() => void storeKey()}>
                  Save
                </Button>
              </Stack>
            ))}
          <Button
            size="small"
            variant="contained"
            disabled={!workflow || workflow.steps.length === 0 || run.running}
            onClick={() => workflow && startRun(workflow)}
            sx={{ fontSize: 12 }}
          >
            Run
          </Button>
        </Stack>

        {state.saveError && (
          <Stack direction="row" sx={{ gap: 1, alignItems: "center", px: 1.5, py: 0.5 }}>
            <Typography sx={{ fontSize: 12, color: token("err") }}>{state.saveError}</Typography>
            <Button size="small" sx={{ fontSize: 11 }} onClick={() => firecrawlStore.saveNow()}>
              Retry
            </Button>
          </Stack>
        )}

        <Tabs
          value={stage}
          onChange={(_, v: Stage) => setStage(v)}
          sx={{ minHeight: 34, px: 1.5, borderBottom: `1px solid ${token("edge")}`, "& .MuiTab-root": { minHeight: 34, fontSize: 12, py: 0 } }}
        >
          <Tab value="builder" label="Builder" />
          <Tab value="run" label="Run" />
          <Tab value="data" label="Data" />
          <Tab value="recorder" label="Recorder" />
        </Tabs>

        <Box sx={{ flex: 1, minHeight: 0 }}>
          {stage === "builder" &&
            (workflow ? (
              <Builder workflow={workflow} onRunFrom={(index) => startRun(workflow, index)} />
            ) : (
              <Typography sx={{ fontSize: 13, color: token("dim"), textAlign: "center", py: 6 }}>
                Create a workflow to start building.
              </Typography>
            ))}
          {stage === "run" && (
            <RunPanel
              run={run}
              workflowName={runningWfRef.current?.name ?? workflow?.name ?? ""}
              sessionId={runSession}
              speed={speed}
              onSpeed={changeSpeed}
              onPause={pauseRun}
              onResume={resumeRun}
              onStop={stopRun}
            />
          )}
          {stage === "data" && <DataPanel dataset={listView ?? dataset} />}
          {stage === "recorder" && <RecorderPanel />}
        </Box>
      </Stack>

      <Snackbar open={note !== null} autoHideDuration={3000} onClose={() => setNote(null)} message={note ?? ""} />
    </Box>
  );
}

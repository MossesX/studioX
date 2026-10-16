"use client";

/**
 * @file The workflow builder — one card per step, edited in place.
 *
 * Cards mark `data-axf-area="firecrawl.step"` + `data-axf-step` /
 * `data-axf-workflow`, so the decl's step menu (move / duplicate / delete)
 * works on every card without a single onContextMenu handler here — the
 * area walk composes the step rows over the surface rows exactly as taskman's
 * rows do. The buttons duplicate the menu's verbs for discoverability; both
 * run through the same store helpers, so there is one behaviour to test.
 *
 * A loop card nests a second, smaller card list (scrape/analyze only) — one
 * level deep by design; the decl's docblock says why.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { uid } from "./id";
import { getFirecrawlSettings } from "./settings";
import { setSteps, useFirecrawlStore } from "./store";
import { STEP_LABELS, stepSummary } from "./types";
import type {
  AnalyzeStep,
  ForeachStep,
  LinksStep,
  LoopInnerStep,
  LoopStep,
  MapStep,
  PaginateStep,
  RecordStep,
  ScrapeStep,
  SearchStep,
  StepKind,
  Workflow,
  WorkflowStep
} from "./types";

/* ── step factories ──────────────────────────────────────────────────────── */

export function makeStep(kind: StepKind): WorkflowStep {
  const id = uid("step");
  switch (kind) {
    case "search":
      return { id, kind, query: "", limit: 5, withContent: true } satisfies SearchStep;
    case "scrape":
      return { id, kind, urls: "", maxUrls: 10 } satisfies ScrapeStep;
    case "map":
      return { id, kind, url: "", search: "", limit: 100 } satisfies MapStep;
    case "analyze":
      return { id, kind, prompt: "", output: "text" } satisfies AnalyzeStep;
    case "loop":
      return {
        id,
        kind,
        limit: getFirecrawlSettings().loopLimit,
        steps: []
      } satisfies LoopStep;
    case "links":
      return { id, kind, url: "", selector: "", filter: "", saveAs: "", listMode: "replace" } satisfies LinksStep;
    case "paginate":
      return {
        id,
        kind,
        url: "",
        strategy: "next",
        nextSelector: 'a[rel="next"]',
        nextMatch: "auto",
        pattern: "",
        from: 1,
        maxPages: 10,
        collect: "links",
        selector: "",
        filter: "",
        saveAs: ""
      } satisfies PaginateStep;
    case "foreach":
      return {
        id,
        kind,
        listName: "",
        limit: getFirecrawlSettings().loopLimit,
        extractLinks: false,
        condType: "always",
        condValue: "",
        condNegate: false,
        store: "url",
        saveAs: ""
      } satisfies ForeachStep;
    case "record":
      return { id, kind, recordingId: "", url: "" } satisfies RecordStep;
  }
}

/* ── shared card chrome ──────────────────────────────────────────────────── */

const KIND_TINT: Record<StepKind, string> = {
  search: "info",
  scrape: "accent",
  map: "info",
  analyze: "warn",
  loop: "ok",
  links: "accent",
  paginate: "info",
  foreach: "ok",
  record: "warn"
};

function CardShell({
  step,
  index,
  workflowId,
  onPatch,
  children,
  inner
}: {
  step: WorkflowStep;
  index: number;
  workflowId: string;
  onPatch: (patch: Partial<WorkflowStep>) => void;
  children: React.ReactNode;
  /** True for a card nested inside a loop — tighter chrome, no area mark
   *  (the loop card already carries the step area for the whole cluster). */
  inner?: boolean;
}) {
  void onPatch;
  void workflowId;
  return (
    <Box
      sx={{
        border: `1px solid ${token("edge")}`,
        borderLeft: `3px solid ${token(KIND_TINT[step.kind])}`,
        borderRadius: token("radius-tight"),
        background: token("panel"),
        p: inner ? 1 : 1.5
      }}
    >
      <Stack direction="row" sx={{ gap: 1, alignItems: "center", mb: 0.75 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: token(KIND_TINT[step.kind]) }}>
          {inner ? "" : `${index + 1} · `}
          {STEP_LABELS[step.kind]}
        </Typography>
        <Typography noWrap sx={{ fontSize: 11, color: token("dim"), flex: 1 }}>
          {stepSummary(step)}
        </Typography>
      </Stack>
      {children}
    </Box>
  );
}

/* ── per-kind editors ────────────────────────────────────────────────────── */

const FIELD = { size: "small" as const, fullWidth: true };
const FIELD_SX = { "& .MuiInputBase-input": { fontSize: 13 } };

/** Placeholder for the paginate "Next control" field, per match kind. */
const NEXT_PLACEHOLDER: Record<PaginateStep["nextMatch"], string> = {
  auto: 'Next  ·  .pagination .next  ·  #more',
  text: "Next  ·  Older posts  ·  ›",
  id: "loadMore  (the element's id)",
  class: "next-page  (a class name)",
  tag: "button  ·  a  (tag or name attr)",
  css: 'a[rel="next"], .pagination .next'
};

function SearchEditor({ step, patch }: { step: SearchStep; patch: (p: Partial<SearchStep>) => void }) {
  return (
    <Stack sx={{ gap: 1 }}>
      <TextField
        {...FIELD}
        sx={FIELD_SX}
        label="Search query"
        value={step.query}
        onChange={(e) => patch({ query: e.target.value })}
      />
      <Stack direction="row" sx={{ gap: 1.5, alignItems: "center" }}>
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 130 }}
          fullWidth={false}
          type="number"
          label="Results"
          value={step.limit}
          onChange={(e) => patch({ limit: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
        />
        <Stack direction="row" sx={{ alignItems: "center" }}>
          <Switch
            size="small"
            checked={step.withContent}
            onChange={(e) => patch({ withContent: e.target.checked })}
          />
          <Typography sx={{ fontSize: 12, color: token("dim") }}>
            Pull page content (costs a scrape per result)
          </Typography>
        </Stack>
      </Stack>
    </Stack>
  );
}

function ScrapeEditor({ step, patch }: { step: ScrapeStep; patch: (p: Partial<ScrapeStep>) => void }) {
  const literal = step.urls.trim().length > 0;
  return (
    <Stack sx={{ gap: 1 }}>
      <TextField
        {...FIELD}
        sx={FIELD_SX}
        label="URLs (one per line — leave empty to scrape the previous step's links)"
        value={step.urls}
        multiline
        minRows={1}
        maxRows={6}
        onChange={(e) => patch({ urls: e.target.value })}
      />
      {!literal && (
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 200 }}
          fullWidth={false}
          type="number"
          label="Max previous links"
          value={step.maxUrls}
          onChange={(e) => patch({ maxUrls: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })}
        />
      )}
    </Stack>
  );
}

function MapEditor({ step, patch }: { step: MapStep; patch: (p: Partial<MapStep>) => void }) {
  return (
    <Stack direction="row" sx={{ gap: 1 }}>
      <TextField
        {...FIELD}
        sx={FIELD_SX}
        label="Site URL"
        value={step.url}
        onChange={(e) => patch({ url: e.target.value })}
      />
      <TextField
        {...FIELD}
        sx={{ ...FIELD_SX, width: 220 }}
        fullWidth={false}
        label="Filter (optional)"
        value={step.search}
        onChange={(e) => patch({ search: e.target.value })}
      />
      <TextField
        {...FIELD}
        sx={{ ...FIELD_SX, width: 110 }}
        fullWidth={false}
        type="number"
        label="Limit"
        value={step.limit}
        onChange={(e) => patch({ limit: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
      />
    </Stack>
  );
}

function AnalyzeEditor({ step, patch }: { step: AnalyzeStep; patch: (p: Partial<AnalyzeStep>) => void }) {
  return (
    <Stack sx={{ gap: 1 }}>
      <TextField
        {...FIELD}
        sx={FIELD_SX}
        label="What should Freddy do with the data? (plain english)"
        placeholder="e.g. Pick the 5 articles most relevant to WebGPU adoption and explain why each matters."
        value={step.prompt}
        multiline
        minRows={2}
        maxRows={8}
        onChange={(e) => patch({ prompt: e.target.value })}
      />
      <TextField
        {...FIELD}
        sx={{ ...FIELD_SX, width: 260 }}
        fullWidth={false}
        select
        label="Answer shape (what the next step gets)"
        value={step.output}
        onChange={(e) => patch({ output: e.target.value as AnalyzeStep["output"] })}
      >
        <MenuItem value="text">Prose (markdown)</MenuItem>
        <MenuItem value="json">Structured JSON</MenuItem>
        <MenuItem value="links">Links to follow</MenuItem>
      </TextField>
    </Stack>
  );
}

function LinksEditor({ step, patch }: { step: LinksStep; patch: (p: Partial<LinksStep>) => void }) {
  return (
    <Stack sx={{ gap: 1 }}>
      <TextField
        {...FIELD}
        sx={FIELD_SX}
        label="Page URL (empty = first link of the previous step)"
        value={step.url}
        onChange={(e) => patch({ url: e.target.value })}
      />
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 220 }}
          fullWidth={false}
          label="Scope selector (optional)"
          placeholder="e.g. main .results"
          value={step.selector}
          onChange={(e) => patch({ selector: e.target.value })}
        />
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 220 }}
          fullWidth={false}
          label="Href filter (text or /regex/)"
          placeholder="e.g. /product/"
          value={step.filter}
          onChange={(e) => patch({ filter: e.target.value })}
        />
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 200 }}
          fullWidth={false}
          label="Save as list (optional)"
          placeholder="e.g. product pages"
          value={step.saveAs}
          onChange={(e) => patch({ saveAs: e.target.value })}
        />
        {step.saveAs.trim() !== "" && (
          <TextField
            {...FIELD}
            sx={{ ...FIELD_SX, width: 150 }}
            fullWidth={false}
            select
            label="If list exists"
            value={step.listMode}
            onChange={(e) => patch({ listMode: e.target.value as LinksStep["listMode"] })}
          >
            <MenuItem value="replace">Replace it</MenuItem>
            <MenuItem value="append">Append to it</MenuItem>
          </TextField>
        )}
      </Stack>
    </Stack>
  );
}

function PaginateEditor({ step, patch }: { step: PaginateStep; patch: (p: Partial<PaginateStep>) => void }) {
  return (
    <Stack sx={{ gap: 1 }}>
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 170 }}
          fullWidth={false}
          select
          label="Strategy"
          value={step.strategy}
          onChange={(e) => patch({ strategy: e.target.value as PaginateStep["strategy"] })}
        >
          <MenuItem value="next">Click "next" control</MenuItem>
          <MenuItem value="pattern">URL pattern {"{n}"}</MenuItem>
        </TextField>
        {step.strategy === "next" ? (
          <>
            <TextField
              {...FIELD}
              sx={FIELD_SX}
              label="First page URL (empty = previous step's first link)"
              value={step.url}
              onChange={(e) => patch({ url: e.target.value })}
            />
            <TextField
              {...FIELD}
              sx={{ ...FIELD_SX, width: 130 }}
              fullWidth={false}
              select
              label="Find next by"
              value={step.nextMatch}
              onChange={(e) => patch({ nextMatch: e.target.value as PaginateStep["nextMatch"] })}
            >
              <MenuItem value="auto">Auto-detect</MenuItem>
              <MenuItem value="text">Text</MenuItem>
              <MenuItem value="id">Element id</MenuItem>
              <MenuItem value="class">Element class</MenuItem>
              <MenuItem value="tag">Element name</MenuItem>
              <MenuItem value="css">CSS selector</MenuItem>
            </TextField>
            <TextField
              {...FIELD}
              sx={{ ...FIELD_SX, width: 220 }}
              fullWidth={false}
              label="Next control"
              placeholder={NEXT_PLACEHOLDER[step.nextMatch]}
              value={step.nextSelector}
              onChange={(e) => patch({ nextSelector: e.target.value })}
            />
          </>
        ) : (
          <>
            <TextField
              {...FIELD}
              sx={FIELD_SX}
              label="URL pattern with {n}"
              placeholder="https://site.com/blog/page/{n}"
              value={step.pattern}
              onChange={(e) => patch({ pattern: e.target.value })}
            />
            <TextField
              {...FIELD}
              sx={{ ...FIELD_SX, width: 110 }}
              fullWidth={false}
              type="number"
              label="Start {n}"
              value={step.from}
              onChange={(e) => patch({ from: Number(e.target.value) || 1 })}
            />
          </>
        )}
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 110 }}
          fullWidth={false}
          type="number"
          label="Max pages"
          value={step.maxPages}
          onChange={(e) => patch({ maxPages: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })}
        />
      </Stack>
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 190 }}
          fullWidth={false}
          select
          label="Collect from every page"
          value={step.collect}
          onChange={(e) => patch({ collect: e.target.value as PaginateStep["collect"] })}
        >
          <MenuItem value="links">The links on it</MenuItem>
          <MenuItem value="pages">A page snapshot</MenuItem>
        </TextField>
        {step.collect === "links" && (
          <>
            <TextField
              {...FIELD}
              sx={{ ...FIELD_SX, width: 200 }}
              fullWidth={false}
              label="Scope selector (optional)"
              value={step.selector}
              onChange={(e) => patch({ selector: e.target.value })}
            />
            <TextField
              {...FIELD}
              sx={{ ...FIELD_SX, width: 200 }}
              fullWidth={false}
              label="Href filter (text or /regex/)"
              value={step.filter}
              onChange={(e) => patch({ filter: e.target.value })}
            />
            <TextField
              {...FIELD}
              sx={{ ...FIELD_SX, width: 190 }}
              fullWidth={false}
              label="Save as list (optional)"
              value={step.saveAs}
              onChange={(e) => patch({ saveAs: e.target.value })}
            />
          </>
        )}
      </Stack>
    </Stack>
  );
}

function ForeachEditor({ step, patch }: { step: ForeachStep; patch: (p: Partial<ForeachStep>) => void }) {
  const { lists } = useFirecrawlStore();
  return (
    <Stack sx={{ gap: 1 }}>
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 230 }}
          fullWidth={false}
          select
          label="Walk which links?"
          value={step.listName}
          onChange={(e) => patch({ listName: e.target.value })}
        >
          <MenuItem value="">Previous step's links</MenuItem>
          {lists.map((list) => (
            <MenuItem key={list.id} value={list.name}>
              list "{list.name}" ({list.urls.length})
            </MenuItem>
          ))}
        </TextField>
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 110 }}
          fullWidth={false}
          type="number"
          label="Max items"
          value={step.limit}
          onChange={(e) => patch({ limit: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
        />
        <Stack direction="row" sx={{ alignItems: "center" }}>
          <Switch
            size="small"
            checked={step.extractLinks}
            onChange={(e) => patch({ extractLinks: e.target.checked })}
          />
          <Typography sx={{ fontSize: 12, color: token("dim") }}>
            Harvest each page's links (highlighted)
          </Typography>
        </Stack>
      </Stack>
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", alignItems: "center" }}>
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 210 }}
          fullWidth={false}
          select
          label="Keep the page when…"
          value={step.condType}
          onChange={(e) => patch({ condType: e.target.value as ForeachStep["condType"] })}
        >
          <MenuItem value="always">Always (keep everything)</MenuItem>
          <MenuItem value="selector">CSS selector exists</MenuItem>
          <MenuItem value="text">Page text contains</MenuItem>
          <MenuItem value="regex">Page text matches /regex/</MenuItem>
          <MenuItem value="url">Final URL matches</MenuItem>
        </TextField>
        {step.condType !== "always" && (
          <>
            <TextField
              {...FIELD}
              sx={{ ...FIELD_SX, width: 240 }}
              fullWidth={false}
              label={
                step.condType === "selector"
                  ? "Selector"
                  : step.condType === "url"
                    ? "URL text or /regex/"
                    : "Text or /regex/"
              }
              value={step.condValue}
              onChange={(e) => patch({ condValue: e.target.value })}
            />
            <Stack direction="row" sx={{ alignItems: "center" }}>
              <Switch
                size="small"
                checked={step.condNegate}
                onChange={(e) => patch({ condNegate: e.target.checked })}
              />
              <Typography sx={{ fontSize: 12, color: token("dim") }}>Invert (keep non-matches)</Typography>
            </Stack>
          </>
        )}
      </Stack>
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 230 }}
          fullWidth={false}
          select
          label="Store for each kept page"
          value={step.store}
          onChange={(e) => patch({ store: e.target.value as ForeachStep["store"] })}
        >
          <MenuItem value="url">Its URL</MenuItem>
          <MenuItem value="links">Its harvested links</MenuItem>
          <MenuItem value="page">A page snapshot (dataset)</MenuItem>
        </TextField>
        {step.store !== "page" && (
          <TextField
            {...FIELD}
            sx={{ ...FIELD_SX, width: 220 }}
            fullWidth={false}
            label="Save kept items as list (optional)"
            value={step.saveAs}
            onChange={(e) => patch({ saveAs: e.target.value })}
          />
        )}
      </Stack>
    </Stack>
  );
}

function RecordEditor({ step, patch }: { step: RecordStep; patch: (p: Partial<RecordStep>) => void }) {
  const { recordings } = useFirecrawlStore();
  return (
    <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap" }}>
      <TextField
        {...FIELD}
        sx={{ ...FIELD_SX, width: 280 }}
        fullWidth={false}
        select
        label="Recording to replay"
        value={step.recordingId}
        onChange={(e) => patch({ recordingId: e.target.value })}
      >
        <MenuItem value="">
          <em>Pick one — record in the Recorder tab</em>
        </MenuItem>
        {recordings.map((rec) => (
          <MenuItem key={rec.id} value={rec.id}>
            {rec.name} ({rec.actions.length} actions)
          </MenuItem>
        ))}
      </TextField>
      <TextField
        {...FIELD}
        sx={FIELD_SX}
        label="Start URL override (optional — empty = the recording's own)"
        value={step.url}
        onChange={(e) => patch({ url: e.target.value })}
      />
    </Stack>
  );
}

function LoopEditor({
  step,
  patch,
  workflowId
}: {
  step: LoopStep;
  patch: (p: Partial<LoopStep>) => void;
  workflowId: string;
}) {
  const setInner = (update: (prev: readonly LoopInnerStep[]) => readonly LoopInnerStep[]) =>
    patch({ steps: update(step.steps) });
  return (
    <Stack sx={{ gap: 1 }}>
      <Stack direction="row" sx={{ gap: 1.5, alignItems: "center" }}>
        <TextField
          {...FIELD}
          sx={{ ...FIELD_SX, width: 130 }}
          fullWidth={false}
          type="number"
          label="Max items"
          value={step.limit}
          onChange={(e) => patch({ limit: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })}
        />
        <Typography sx={{ fontSize: 12, color: token("dim") }}>
          Runs the inner steps once per link (or JSON item) from the previous step.
        </Typography>
      </Stack>
      <Stack sx={{ gap: 1, pl: 1.5, borderLeft: `2px dashed ${token("edge")}` }}>
        {step.steps.map((inner, j) => (
          <Box key={inner.id}>
            <CardShell step={inner} index={j} workflowId={workflowId} onPatch={() => {}} inner>
              {inner.kind === "scrape" ? (
                <ScrapeEditor
                  step={inner}
                  patch={(p) =>
                    setInner((prev) =>
                      prev.map((s) => (s.id === inner.id ? ({ ...s, ...p } as LoopInnerStep) : s))
                    )
                  }
                />
              ) : (
                <AnalyzeEditor
                  step={inner}
                  patch={(p) =>
                    setInner((prev) =>
                      prev.map((s) => (s.id === inner.id ? ({ ...s, ...p } as LoopInnerStep) : s))
                    )
                  }
                />
              )}
              <Stack direction="row" sx={{ justifyContent: "flex-end" }}>
                <Button
                  size="small"
                  color="inherit"
                  sx={{ fontSize: 11, color: token("dim") }}
                  onClick={() => setInner((prev) => prev.filter((s) => s.id !== inner.id))}
                >
                  Remove
                </Button>
              </Stack>
            </CardShell>
          </Box>
        ))}
        <Stack direction="row" sx={{ gap: 1 }}>
          <Button
            size="small"
            variant="outlined"
            sx={{ fontSize: 11 }}
            onClick={() => setInner((prev) => [...prev, makeStep("scrape") as LoopInnerStep])}
          >
            + Scrape each
          </Button>
          <Button
            size="small"
            variant="outlined"
            sx={{ fontSize: 11 }}
            onClick={() => setInner((prev) => [...prev, makeStep("analyze") as LoopInnerStep])}
          >
            + Analyze each
          </Button>
        </Stack>
      </Stack>
    </Stack>
  );
}

/* ── the builder ─────────────────────────────────────────────────────────── */

export default function Builder({
  workflow,
  onRunFrom
}: {
  workflow: Workflow;
  /** Run the pipeline starting at this step index (Run from here). */
  onRunFrom?: (index: number) => void;
}) {
  const patchStep = (stepId: string, patch: Partial<WorkflowStep>) =>
    setSteps(workflow.id, (prev) =>
      prev.map((s) => (s.id === stepId ? ({ ...s, ...patch } as WorkflowStep) : s))
    );

  return (
    <Stack sx={{ gap: 1.25, p: 1.5, overflow: "auto", height: "100%" }}>
      {workflow.steps.length === 0 && (
        <Typography sx={{ fontSize: 13, color: token("dim"), textAlign: "center", py: 4 }}>
          Empty pipeline — add a first step below. The usual opener is <b>Search</b> (discover
          pages) or <b>Scrape</b> (when you already have URLs).
        </Typography>
      )}
      {workflow.steps.map((step, i) => (
        <Stack key={step.id} direction="row" sx={{ gap: 0.5, alignItems: "stretch" }}>
          {/* The step's context-menu marker — the decl's `firecrawl.step`
              area, harvested with the step and workflow ids the commands
              read back out of `MenuContext.data`. */}
          <Box
            data-axf-area="firecrawl.step"
            data-axf-step={step.id}
            data-axf-workflow={workflow.id}
            sx={{ flex: 1, minWidth: 0 }}
          >
            <CardShell step={step} index={i} workflowId={workflow.id} onPatch={(p) => patchStep(step.id, p)}>
              {step.kind === "search" && <SearchEditor step={step} patch={(p) => patchStep(step.id, p)} />}
              {step.kind === "scrape" && <ScrapeEditor step={step} patch={(p) => patchStep(step.id, p)} />}
              {step.kind === "map" && <MapEditor step={step} patch={(p) => patchStep(step.id, p)} />}
              {step.kind === "analyze" && <AnalyzeEditor step={step} patch={(p) => patchStep(step.id, p)} />}
              {step.kind === "loop" && (
                <LoopEditor step={step} patch={(p) => patchStep(step.id, p)} workflowId={workflow.id} />
              )}
              {step.kind === "links" && <LinksEditor step={step} patch={(p) => patchStep(step.id, p)} />}
              {step.kind === "paginate" && <PaginateEditor step={step} patch={(p) => patchStep(step.id, p)} />}
              {step.kind === "foreach" && <ForeachEditor step={step} patch={(p) => patchStep(step.id, p)} />}
              {step.kind === "record" && <RecordEditor step={step} patch={(p) => patchStep(step.id, p)} />}
            </CardShell>
          </Box>
          <Stack sx={{ gap: 0, justifyContent: "center" }}>
            {onRunFrom && (
              <Tooltip title="Run from this step" placement="left">
                <IconButton
                  size="small"
                  onClick={() => onRunFrom(i)}
                  sx={{ fontSize: 13, width: 24, height: 24, color: token("ok") }}
                >
                  ▶
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Move up" placement="left">
              <span>
                <IconButton
                  size="small"
                  disabled={i === 0}
                  onClick={() =>
                    setSteps(workflow.id, (prev) => {
                      const next = [...prev];
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      return next;
                    })
                  }
                  sx={{ fontSize: 13, width: 24, height: 24 }}
                >
                  ↑
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Move down" placement="left">
              <span>
                <IconButton
                  size="small"
                  disabled={i === workflow.steps.length - 1}
                  onClick={() =>
                    setSteps(workflow.id, (prev) => {
                      const next = [...prev];
                      [next[i], next[i + 1]] = [next[i + 1], next[i]];
                      return next;
                    })
                  }
                  sx={{ fontSize: 13, width: 24, height: 24 }}
                >
                  ↓
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Delete step" placement="left">
              <IconButton
                size="small"
                onClick={() => setSteps(workflow.id, (prev) => prev.filter((s) => s.id !== step.id))}
                sx={{ fontSize: 13, width: 24, height: 24, color: token("err") }}
              >
                ✕
              </IconButton>
            </Tooltip>
          </Stack>
        </Stack>
      ))}
      <Stack direction="row" sx={{ gap: 1, flexWrap: "wrap", pt: 0.5 }}>
        {(Object.keys(STEP_LABELS) as StepKind[]).map((kind) => (
          <Button
            key={kind}
            size="small"
            variant="outlined"
            sx={{ fontSize: 12 }}
            onClick={() => setSteps(workflow.id, (prev) => [...prev, makeStep(kind)])}
          >
            + {STEP_LABELS[kind]}
          </Button>
        ))}
      </Stack>
    </Stack>
  );
}

"use client";

/**
 * @file The Data panel — dataset viewer, format switcher, export suite.
 *
 * One dataset on screen, four formats (JSON tree / markdown / table / raw)
 * and two layouts: single view, or a split pane showing two formats side by
 * side (the JSON-beside-markdown read the owner asked the module for). The
 * default format comes from the module settings (`defaultView`), `auto`
 * meaning "whatever the dataset's kind renders best".
 *
 * Exports go through `exporters.ts` — the same functions the context-menu
 * commands call, so a download means the same bytes from either surface.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import Markdown from "../claude-workspace/MarkdownView";
import {
  datasetToCsv,
  datasetToJson,
  datasetToMarkdown,
  download,
  fileStem
} from "./exporters";
import { renameDataset } from "./store";
import { useFirecrawlSettings } from "./settings";
import { JsonTree, RawView, TableView } from "./viewers";
import type { Dataset } from "./types";

type ViewFormat = "json" | "markdown" | "table" | "raw";

function autoFormat(ds: Dataset): ViewFormat {
  return ds.kind === "markdown" ? "markdown" : "json";
}

function ViewBody({ ds, format }: { ds: Dataset; format: ViewFormat }) {
  switch (format) {
    case "json":
      return <JsonTree source={ds.kind === "json" ? ds.content : datasetToJson(ds)} />;
    case "markdown":
      return (
        <Box sx={{ p: 1.5, overflow: "auto", height: "100%" }}>
          <Markdown source={datasetToMarkdown(ds)} />
        </Box>
      );
    case "table":
      return <TableView source={ds.kind === "json" ? ds.content : datasetToJson(ds)} />;
    case "raw":
      return <RawView source={ds.content} />;
  }
}

export default function DataPanel({ dataset }: { dataset: Dataset | null }) {
  const settings = useFirecrawlSettings();
  const [format, setFormat] = React.useState<ViewFormat | null>(null);
  const [split, setSplit] = React.useState(false);
  const [splitFormat, setSplitFormat] = React.useState<ViewFormat>("markdown");
  const [note, setNote] = React.useState<string | null>(null);
  const [name, setName] = React.useState<string>(dataset?.name ?? "");
  const dsId = dataset?.id;
  React.useEffect(() => {
    setName(dataset?.name ?? "");
    setFormat(null);
  }, [dsId, dataset?.name]);

  if (!dataset) {
    return (
      <Typography sx={{ fontSize: 13, color: token("dim"), textAlign: "center", py: 6 }}>
        No dataset selected — run a workflow and save a step's output, or pick one from the rail.
      </Typography>
    );
  }

  const active: ViewFormat =
    format ??
    (settings.defaultView === "auto" ? autoFormat(dataset) : (settings.defaultView as ViewFormat));

  const csv = () => {
    const out = datasetToCsv(dataset);
    if (out === null) {
      setNote("No tabular shape in this dataset — CSV needs an array of objects.");
      return;
    }
    download(`${fileStem(dataset.name)}.csv`, out, "text/csv");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(dataset.content);
      setNote("Copied to the clipboard.");
    } catch {
      setNote("The browser refused clipboard access.");
    }
  };

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Stack direction="row" sx={{ gap: 1, alignItems: "center", flexWrap: "wrap", p: 1, borderBottom: `1px solid ${token("edge")}` }}>
        <TextField
          size="small"
          variant="standard"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== dataset.name && renameDataset(dataset.id, name.trim())}
          sx={{ width: 260, "& .MuiInputBase-input": { fontSize: 13, fontWeight: 700 } }}
        />
        <Typography sx={{ fontSize: 11, color: token("dim") }}>
          {dataset.kind} · {new Date(dataset.createdAt).toLocaleString()}
          {dataset.workflowName ? ` · from "${dataset.workflowName}"` : ""}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={active}
          onChange={(_, v: ViewFormat | null) => v && setFormat(v)}
        >
          <ToggleButton value="json" sx={{ fontSize: 11, py: 0.25 }}>JSON tree</ToggleButton>
          <ToggleButton value="markdown" sx={{ fontSize: 11, py: 0.25 }}>Markdown</ToggleButton>
          <ToggleButton value="table" sx={{ fontSize: 11, py: 0.25 }}>Table</ToggleButton>
          <ToggleButton value="raw" sx={{ fontSize: 11, py: 0.25 }}>Raw</ToggleButton>
        </ToggleButtonGroup>
        <ToggleButton
          size="small"
          value="split"
          selected={split}
          onChange={() => setSplit((s) => !s)}
          sx={{ fontSize: 11, py: 0.25 }}
        >
          Split
        </ToggleButton>
      </Stack>

      <Box sx={{ flex: 1, minHeight: 0, display: "flex" }}>
        <Box sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
          <ViewBody ds={dataset} format={active} />
        </Box>
        {split && (
          <>
            <Box sx={{ width: "1px", background: token("edge") }} />
            <Box sx={{ flex: 1, minWidth: 0, overflow: "auto" }}>
              <Stack direction="row" sx={{ justifyContent: "flex-end", p: 0.5 }}>
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={splitFormat}
                  onChange={(_, v: ViewFormat | null) => v && setSplitFormat(v)}
                >
                  {(["json", "markdown", "table", "raw"] as ViewFormat[]).map((f) => (
                    <ToggleButton key={f} value={f} sx={{ fontSize: 10, py: 0.1 }}>
                      {f}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
              </Stack>
              <ViewBody ds={dataset} format={splitFormat} />
            </Box>
          </>
        )}
      </Box>

      <Stack direction="row" sx={{ gap: 1, p: 1, borderTop: `1px solid ${token("edge")}` }}>
        <Typography sx={{ fontSize: 11, color: token("dim"), alignSelf: "center" }}>Export:</Typography>
        <Button size="small" variant="outlined" sx={{ fontSize: 11 }} onClick={() => download(`${fileStem(dataset.name)}.json`, datasetToJson(dataset), "application/json")}>
          JSON
        </Button>
        <Button size="small" variant="outlined" sx={{ fontSize: 11 }} onClick={() => download(`${fileStem(dataset.name)}.md`, datasetToMarkdown(dataset), "text/markdown")}>
          Markdown
        </Button>
        <Button size="small" variant="outlined" sx={{ fontSize: 11 }} onClick={csv}>
          CSV
        </Button>
        <Button size="small" variant="outlined" sx={{ fontSize: 11 }} onClick={() => void copy()}>
          Copy
        </Button>
      </Stack>

      <Snackbar
        open={note !== null}
        autoHideDuration={2500}
        onClose={() => setNote(null)}
        message={note ?? ""}
      />
    </Stack>
  );
}

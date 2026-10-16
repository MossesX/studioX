/**
 * @file Right-hand detail editor for the selected task item — GizmoX's
 * `ItemDetail` (MASTER §5): every field editable in place, plus duplicate /
 * float-list / delete and the sub-item + timestamp footer.
 *
 * This pane is why the first port felt empty. The tree already carried every
 * operation, but three of them (duplicate, float, delete) and six of the fields
 * (type, action, category, priority, colour, due, notes) had NO surface at all
 * — a `TaskItem` could be created and checked off and never edited. The fields
 * themselves live in `ItemFields`; this is the frame and the action row.
 *
 * Rebuilt on MUI (2026-08-11): the three actions are `Button`s and the rule is
 * a `Divider`.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import ItemFields from "./ItemFields";
import { countItems } from "./taskOps";
import type { TaskItem } from "./types";

export interface ItemDetailProps {
  item: TaskItem | null;
  onPatch: (id: string, patch: Partial<TaskItem>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onOpenWindow: () => void;
}

export default function ItemDetail({
  item,
  onPatch,
  onDelete,
  onDuplicate,
  onOpenWindow
}: ItemDetailProps) {
  if (!item) {
    return (
      <Box
        sx={{
          height: "100%",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          textAlign: "center",
          color: token("dim"),
          fontSize: 12.5
        }}
      >
        <Typography sx={{ fontSize: 12.5, color: token("dim") }}>
          Select an item to edit its details
        </Typography>
      </Box>
    );
  }

  const counts = countItems(item.children);

  return (
    <Box sx={{ height: "100%", overflow: "auto", padding: "12px" }}>
      <ItemFields value={item} onChange={(patch) => onPatch(item.id, patch)} />

      {item.source && (
        <Typography sx={{ marginTop: "10px", color: token("dim"), fontSize: 11 }}>
          From {item.source.module}: {item.source.ref}
        </Typography>
      )}

      <Divider sx={{ margin: "12px 0" }} />

      <Stack direction="row" sx={{ alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
        <Button size="small" onClick={() => onDuplicate(item.id)}>
          ⧉ Duplicate
        </Button>
        <Button size="small" onClick={onOpenWindow}>
          ⇱ Float list
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" color="error" onClick={() => onDelete(item.id)}>
          Delete
        </Button>
      </Stack>

      <Typography sx={{ marginTop: "10px", color: token("dim"), fontSize: 11 }}>
        {counts.total > 0 ? `${counts.done}/${counts.total} sub-items · ` : ""}
        created {item.createdAt ? new Date(item.createdAt).toLocaleString() : "—"} · updated{" "}
        {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—"}
      </Typography>
    </Box>
  );
}

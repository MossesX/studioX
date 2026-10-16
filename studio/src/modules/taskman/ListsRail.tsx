/**
 * @file The lists rail — the "All lists" column, its collapsible GROUPS, and
 * the ctrl-click selection.
 *
 * Lifted out of `TaskmanModule.tsx` on 2026-08-14, when the owner's request
 * turned a flat map over `ctrl.lists` into four bands, a per-group header with
 * its own context area, a multi-select, and a selection strip. That is a
 * component, not a fragment, and leaving it inline would have made the module
 * screen a file you scroll to find the tree in.
 *
 * ── the three marked areas ──────────────────────────────────────────────────
 *
 * `taskman.group` on a group header, `taskman.list` on a list row, and the
 * whole rail sits inside the screen's `taskman.surface`. The DOM does the
 * nesting, so right-clicking a list row inside a group composes the list rows
 * and the surface rows — and NOT the group's, because a header is a sibling of
 * the rows beneath it rather than their ancestor. That is the correct reading:
 * *New list in this group* on a row that is already in the group would be a
 * second way to say *New list*, and *Delete group* one keystroke from *Delete
 * list* is a menu that invites the wrong click.
 *
 * ── selection ───────────────────────────────────────────────────────────────
 *
 * Owner: *"allow multiple list selections by holding control."* Plain click
 * scopes the pane to one list and makes the selection exactly that list;
 * ctrl-click (or ⌘-click) toggles a list in and out WITHOUT changing the scope,
 * because re-scoping the item pane on every tick would make choosing five lists
 * mean loading five different trees on the way.
 *
 * The selection lives in the store rather than here — see `TaskState`: the
 * delete command is a plain function over the store and could not read React
 * state.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { commands, token } from "@axf/core";

import { ACTIVE_LIST_GLOW } from "./activity";
import { listsInGroup, sortedGroups, ungroupedLists } from "./groups";
import { paletteColor } from "./palette";
import { countItems } from "./taskOps";
import type { TaskController } from "./useTaskController";
import type { TaskGroup, TaskList } from "./types";

interface RailProps {
  ctrl: TaskController;
  /** "all", or the id of the list the item pane is scoped to. */
  scope: string;
  onScope: (scope: string) => void;
  /** List ids with a build running against them — the pulsing glow. */
  activeListIds: readonly string[];
}

/** One list row. Everything the flat rail had, plus the selection tick. */
function RailListRow({
  list,
  ctrl,
  scope,
  onScope,
  selected,
  selectionSize,
  glowing,
  indent
}: {
  list: TaskList;
  ctrl: TaskController;
  scope: string;
  onScope: (scope: string) => void;
  selected: boolean;
  selectionSize: number;
  glowing: boolean;
  indent: number;
}) {
  const c = paletteColor(list.color);
  const counts = countItems(list.items);
  // The × takes the whole selection when this row is in one — so the tooltip
  // has to say so. A button that deletes five things while its title says
  // "Delete list" is the kind of surprise there is no undo for.
  const takesSelection = selected && selectionSize > 1;

  const click = (e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      ctrl.toggleListSelected(list.id);
      return;
    }
    ctrl.setSelection([list.id]);
    onScope(list.id);
  };

  return (
    <Stack
      direction="row"
      className="axs-tm-railrow"
      data-axf-area="taskman.list"
      data-axf-list={list.id}
      onClick={click}
      sx={{
        alignItems: "center",
        gap: "6px",
        padding: "5px 12px",
        paddingLeft: `${12 + indent}px`,
        cursor: "pointer",
        borderLeft: `2px solid ${scope === list.id ? c.main : "transparent"}`,
        background: selected
          ? // The selection reads differently from the scope on purpose: one is
            // "the pane is showing this", the other is "this is in the batch".
            // Painting them the same makes a five-list delete look like it is
            // about the one list you are looking at.
            `color-mix(in srgb, ${token("accent")} 18%, transparent)`
          : scope === list.id
            ? c.soft
            : undefined,
        outline: selected ? `1px solid ${token("accent")}` : undefined,
        outlineOffset: "-1px",
        ...(glowing ? ACTIVE_LIST_GLOW : null)
      }}
    >
      <Box
        component="span"
        aria-hidden
        sx={{ width: 9, height: 9, borderRadius: "50%", background: c.main, flexShrink: 0 }}
      />
      <Typography
        component="span"
        sx={{
          fontSize: 13,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }}
      >
        {list.name}
      </Typography>
      {list.pinned && (
        <Typography
          component="span"
          title="Pinned"
          aria-label="Pinned"
          sx={{ fontSize: 10, color: token("dim") }}
        >
          ●
        </Typography>
      )}
      <IconButton
        size="small"
        className="axs-tm-dimmed"
        title={list.pinned ? "Unpin list" : "Pin list to the top"}
        aria-label={list.pinned ? "Unpin list" : "Pin list to the top"}
        onClick={(e) => {
          e.stopPropagation();
          ctrl.patchList(list.id, { pinned: !list.pinned });
        }}
        sx={{ padding: "2px", fontSize: 13, color: token("dim") }}
      >
        ⌂
      </IconButton>
      <IconButton
        size="small"
        className="axs-tm-dimmed"
        title="Open as floating window"
        aria-label="Open as floating window"
        onClick={(e) => {
          e.stopPropagation();
          ctrl.openListWindow(list.id);
        }}
        sx={{ padding: "2px", fontSize: 13, color: token("dim") }}
      >
        ⧉
      </IconButton>
      <IconButton
        size="small"
        className="axs-tm-dimmed"
        title={takesSelection ? `Delete ${selectionSize} selected lists` : "Delete list"}
        aria-label={takesSelection ? `Delete ${selectionSize} selected lists` : "Delete list"}
        onClick={(e) => {
          e.stopPropagation();
          void ctrl.removeList(list.id).then((result) => {
            // The scope follows the data: a pane scoped to a list that was just
            // archived would render an empty tree with the list's name over it.
            if (result.ok && scope === list.id) onScope("all");
          });
        }}
        sx={{ padding: "2px", fontSize: 13, color: token("dim"), "&:hover": { color: token("err") } }}
      >
        ×
      </IconButton>
      <Typography component="span" sx={{ color: token("dim"), fontSize: 11, fontFamily: token("mono") }}>
        {counts.done}/{counts.total}
      </Typography>
    </Stack>
  );
}

/** A group header: the disclosure triangle, the name, and how many lists. */
function GroupHeader({
  group,
  count,
  onToggle
}: {
  group: TaskGroup;
  count: number;
  onToggle: () => void;
}) {
  return (
    <Stack
      direction="row"
      className="axs-tm-railrow"
      data-axf-area="taskman.group"
      data-axf-group={group.id}
      onClick={onToggle}
      sx={{
        alignItems: "center",
        gap: "6px",
        padding: "6px 12px 4px",
        cursor: "pointer",
        userSelect: "none"
      }}
    >
      <Typography
        component="span"
        aria-hidden
        sx={{
          fontSize: 9,
          width: 10,
          color: token("dim"),
          transform: group.collapsed ? "rotate(-90deg)" : "none",
          transition: "transform 120ms"
        }}
      >
        ▼
      </Typography>
      <Typography
        component="span"
        sx={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: token("mono"),
          fontSize: 10.5,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: token("dim")
        }}
      >
        {group.name}
      </Typography>
      {/* An engine fills this band, so say so rather than letting the greyed-out
          Rename row be the only hint. */}
      {group.managedBy && (
        <Typography
          component="span"
          title="Kept in step by the system"
          sx={{ fontSize: 9.5, color: token("dim"), opacity: 0.7 }}
        >
          auto
        </Typography>
      )}
      <Typography
        component="span"
        sx={{ color: token("dim"), fontSize: 11, fontFamily: token("mono") }}
      >
        {count}
      </Typography>
    </Stack>
  );
}

export default function ListsRail({ ctrl, scope, onScope, activeListIds }: RailProps) {
  const groups = sortedGroups(ctrl.groups);
  const loose = ungroupedLists(ctrl.lists, ctrl.groups);
  const selected = new Set(ctrl.selectedListIds);

  const row = (list: TaskList, indent: number) => (
    <RailListRow
      key={list.id}
      list={list}
      ctrl={ctrl}
      scope={scope}
      onScope={onScope}
      selected={selected.has(list.id)}
      selectionSize={ctrl.selectedListIds.length}
      glowing={activeListIds.includes(list.id)}
      indent={indent}
    />
  );

  return (
    <>
      <Box sx={{ flex: 1, overflow: "auto", padding: "4px 0" }}>
        <Stack
          direction="row"
          className="axs-tm-railrow"
          onClick={() => {
            ctrl.setSelection([]);
            onScope("all");
          }}
          sx={{
            alignItems: "center",
            gap: "8px",
            padding: "5px 12px",
            cursor: "pointer",
            borderLeft: `2px solid ${scope === "all" ? token("accent") : "transparent"}`,
            background:
              scope === "all" ? `color-mix(in srgb, ${token("accent")} 10%, transparent)` : undefined
          }}
        >
          <Typography component="span" sx={{ fontSize: 13, fontWeight: 700, flex: 1 }}>
            All lists
          </Typography>
          <Typography
            component="span"
            sx={{ color: token("dim"), fontSize: 11, fontFamily: token("mono") }}
          >
            {ctrl.lists.length}
          </Typography>
        </Stack>

        {groups.map((group) => {
          const inGroup = listsInGroup(ctrl.lists, group.id);
          return (
            <React.Fragment key={group.id}>
              <GroupHeader
                group={group}
                count={inGroup.length}
                onToggle={() => ctrl.toggleGroupCollapse(group.id)}
              />
              {!group.collapsed &&
                (inGroup.length === 0 ? (
                  <Typography
                    sx={{ padding: "2px 12px 4px 34px", color: token("dim"), fontSize: 11.5, opacity: 0.7 }}
                  >
                    {group.managedBy ? "Nothing here yet" : "Empty — right-click to add a list"}
                  </Typography>
                ) : (
                  inGroup.map((list) => row(list, 14))
                ))}
            </React.Fragment>
          );
        })}

        {/* The root band: lists in no group. No header — these are simply the
            lists, and a header called "Other" over the only band that existed
            before today would rename the reader's own lists at them. */}
        {loose.length > 0 && <Box sx={{ height: 6 }} />}
        {loose.map((list) => row(list, 0))}
      </Box>

      {/* The selection strip. It exists because a ctrl-click selection is
          otherwise only actionable through a right-click, and a feature whose
          only entry point is a context menu is one most people never find. */}
      {ctrl.selectedListIds.length > 1 && (
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            gap: "8px",
            padding: "6px 8px 6px 12px",
            borderTop: `1px solid ${token("edge")}`,
            background: `color-mix(in srgb, ${token("accent")} 8%, transparent)`
          }}
        >
          <Typography sx={{ flex: 1, fontSize: 12 }}>
            {ctrl.selectedListIds.length} selected
          </Typography>
          <Button
            size="small"
            onClick={() => ctrl.setSelection([])}
            sx={{ fontSize: 12, textTransform: "none", color: token("dim") }}
          >
            Clear
          </Button>
          <Button
            size="small"
            onClick={() => {
              void ctrl.removeList(ctrl.selectedListIds[0]).then((result) => {
                if (result.ok && ctrl.selectedListIds.includes(scope)) onScope("all");
              });
            }}
            sx={{ fontSize: 12, textTransform: "none", color: token("err") }}
          >
            Delete
          </Button>
        </Stack>
      )}

      <Stack direction="row" sx={{ gap: "6px", margin: "8px" }}>
        <Button
          variant="outlined"
          size="small"
          onClick={() => {
            const id = ctrl.addList({ name: `List ${ctrl.lists.length + 1}` });
            ctrl.setSelection([id]);
            onScope(id);
          }}
          sx={{
            flex: 1,
            justifyContent: "flex-start",
            fontSize: 12.5,
            color: token("dim"),
            borderStyle: "dashed",
            borderColor: token("edge")
          }}
        >
          + New list
        </Button>
        <Button
          variant="outlined"
          size="small"
          title="Add a collapsible group to this column"
          onClick={() => commands.run("taskman.group.add")}
          sx={{
            fontSize: 12.5,
            color: token("dim"),
            borderStyle: "dashed",
            borderColor: token("edge"),
            textTransform: "none"
          }}
        >
          + Group
        </Button>
      </Stack>
    </>
  );
}

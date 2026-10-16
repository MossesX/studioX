/**
 * @file The Task Manager screen — GizmoX's `TasksModule` ported to the studio
 * shell (MASTER §5): the multi-list rail (All-lists scope, pinned-first,
 * per-list progress), the item tree, the Integrations pane, the right-hand
 * detail editor, and the floating list windows.
 *
 * ── the context menus are DECLARED, not built here ───────────────────────────
 *
 * Three areas are marked in this file and in `TaskTree`: `taskman.surface` on
 * the root (so a right-click on empty space still gets "New list"),
 * `taskman.list` on every rail row and tree list header, and `taskman.item` on
 * every tree row. The ROWS live in `taskman.decl.ts` and the BEHAVIOUR in
 * `taskman.commands.ts`; nothing in this file handles a `contextmenu` event.
 *
 * That separation is the whole point of core's menu contract. GizmoX reached
 * the same five operations through forty hand-written `useCtx` calls, and its
 * own post-mortem is that the menus were never the problem — the COVERAGE was,
 * because a habit has holes. Here a surface marks itself and stops thinking
 * about menus, and `test/ctx-conformance.test.ts` scans both directions: a
 * marker nobody declared and an area nobody marks are both failures.
 *
 * ── two views ───────────────────────────────────────────────────────────────
 *
 * **Tree** is the outline — nesting, drag to re-parent, inline rename.
 * **Grid** is the table — sortable columns, one row per item, expand to see
 * children. Both render the same store rows and both mark the same areas, so
 * the context menus work identically in either.
 *
 * The Grid landed one pass after the Tree (2026-08-11) and is a real MUI
 * `Table`; the two earlier versions of it hand-rolled a CSS grid because
 * studio had no table primitive at the time. See `TaskGrid.tsx`.
 *
 * ── MUI (2026-08-11) ────────────────────────────────────────────────────────
 * Tabs are `Tabs`/`Tab`, the filter and the buttons are `TextField`/`Button`,
 * panes are `Box`/`Stack`. Bespoke: the two pane SPLITTERS (a pane width during
 * a drag is a measured number — the `PaneLayout` exception) and the hover rules
 * in `GlobalStyles`, which `sx` cannot express for a DESCENDANT.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import GlobalStyles from "@mui/material/GlobalStyles";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";

import { Slot, commands, token } from "@axf/core";

import { GLOW_KEYFRAMES, useTaskActivity } from "./activity";
import ItemDetail from "./ItemDetail";
import { getTaskProviders, type IntegrationCandidate, type TaskProvider } from "./integrations";
import ListsRail from "./ListsRail";
import { paletteColor } from "./palette";
import { useTaskmanSettings } from "./settings";
import TaskGrid from "./TaskGrid";
import TaskTree from "./TaskTree";
import TaskWindows from "./TaskWindows";
import { filterItems, findItem } from "./taskOps";
import { useTaskController } from "./useTaskController";

/** Payload shape `taskman.item-action` requires (see the module declaration). */
interface ItemActionPayload {
  label: string;
  command: string;
}

/**
 * Hover rules. These are the one thing `sx` cannot express, because each is a
 * rule about a DESCENDANT of the hovered element (`:hover .child`) rather than
 * about the element itself. `GlobalStyles` rather than a raw `<style>` element,
 * following the Build Manager's pulse keyframes.
 */
const HOVER_RULES = (
  <GlobalStyles
    styles={{
      ".axs-tm-row:hover": { background: "color-mix(in srgb, var(--axf-ink) 6%, transparent)" },
      ".axs-tm-rowtools": { display: "none" },
      ".axs-tm-row:hover .axs-tm-rowtools": { display: "inline-flex" },
      ".axs-tm-listheader:hover": { background: "color-mix(in srgb, var(--axf-ink) 5%, transparent)" },
      ".axs-tm-railrow:hover": { background: "color-mix(in srgb, var(--axf-ink) 5%, transparent)" },
      /* The float / pin / delete buttons are DIMMED until hover, never hidden:
         an affordance revealed only on hover reads as an absent feature, which
         is exactly how the first port lost its two signature operations. */
      ".axs-tm-railrow .axs-tm-dimmed": { opacity: 0.35 },
      ".axs-tm-railrow:hover .axs-tm-dimmed": { opacity: 1 },
      ".axs-tm-splitter:hover": { background: "color-mix(in srgb, var(--axf-accent) 45%, transparent)" },
      /* The build glow's keyframes. `sx` can express the animation shorthand
         but not the @keyframes rule it names, so the rule is injected here,
         once, and `activity.ts` owns both halves so they cannot drift. */
      ...GLOW_KEYFRAMES
    }}
  />
);

/**
 * A drag handle between two panes. Pointer events, not mouse: the same choice
 * `TaskWindows` made, so a pen or touch drag resizes as well as a mouse does.
 */
function Splitter({ onDelta, side }: { onDelta: (dx: number) => void; side: "left" | "right" }) {
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    let last = e.clientX;
    const move = (ev: PointerEvent) => {
      onDelta(ev.clientX - last);
      last = ev.clientX;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <Box
      onPointerDown={start}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} pane`}
      className="axs-tm-splitter"
      sx={{
        width: "5px",
        flexShrink: 0,
        cursor: "col-resize",
        touchAction: "none",
        background: "transparent",
        transition: "background-color 120ms"
      }}
    />
  );
}

function ProviderSection({
  provider,
  onAdd
}: {
  provider: TaskProvider;
  onAdd: (cand: IntegrationCandidate) => void;
}) {
  const candidates = provider.useCandidates();
  const c = paletteColor(provider.color);
  return (
    <Box sx={{ marginBottom: "14px" }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: "8px", padding: "4px 8px" }}>
        <Box
          component="span"
          aria-hidden
          sx={{ width: 9, height: 9, borderRadius: "50%", background: c.main, flexShrink: 0 }}
        />
        <Typography component="span" sx={{ fontWeight: 700, fontSize: 13 }}>
          {provider.title}
        </Typography>
        <Typography
          component="span"
          sx={{
            fontSize: 10,
            padding: "3px 7px",
            borderRadius: "999px",
            color: c.main,
            background: c.soft
          }}
        >
          {candidates.length}
        </Typography>
      </Stack>
      {candidates.length === 0 ? (
        <Typography sx={{ paddingLeft: "25px", color: token("dim"), fontSize: 11.5 }}>
          Nothing to integrate right now
        </Typography>
      ) : (
        candidates.map((cand) => (
          <Stack
            key={cand.id}
            direction="row"
            className="axs-tm-row"
            sx={{ alignItems: "center", gap: "8px", padding: "3px 8px 3px 25px", borderRadius: "4px" }}
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography
                sx={{
                  fontSize: 13,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {cand.label}
              </Typography>
              {cand.sublabel && (
                <Typography sx={{ color: token("dim"), fontSize: 11 }}>{cand.sublabel}</Typography>
              )}
            </Box>
            <IconButton
              size="small"
              title="Add as task"
              aria-label="Add as task"
              onClick={() => onAdd(cand)}
              sx={{ padding: "2px", fontSize: 14, color: token("accent") }}
            >
              +
            </IconButton>
          </Stack>
        ))
      )}
    </Box>
  );
}

export default function TaskmanModule() {
  const ctrl = useTaskController();
  const settings = useTaskmanSettings();
  const activity = useTaskActivity();
  const [scope, setScope] = React.useState<string>("all");
  const [pane, setPane] = React.useState<"items" | "integrations">("items");
  const [view, setView] = React.useState<"tree" | "grid">("tree");
  const [filter, setFilter] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [railW, setRailW] = React.useState(230);
  const [detailW, setDetailW] = React.useState(320);

  const visibleLists = scope === "all" ? ctrl.lists : ctrl.lists.filter((l) => l.id === scope);
  const sections = visibleLists.map((list) => ({ list, items: filterItems(list.items, filter) }));
  const focusListId = scope === "all" ? (ctrl.lists[0]?.id ?? "") : scope;
  const found = selectedId ? findItem(ctrl.lists, selectedId) : null;
  const selected = found?.item ?? null;

  const addItemToFocus = (partial?: Parameters<typeof ctrl.addItem>[1]) => {
    const id = ctrl.addItem({ listId: focusListId, parentId: null, index: -1 }, partial);
    setSelectedId(id);
    return id;
  };

  /* The three handlers Tree and Grid share. Defined once on purpose: they were
     inline in the Tree's props, and the Grid would have had to repeat them —
     which is exactly how "delete also clears the selection" ends up true in one
     view and false in the other. */
  const toggleListCollapse = (id: string) =>
    ctrl.patchList(id, { collapsed: !ctrl.lists.find((l) => l.id === id)?.collapsed });

  const addChild = (item: { id: string; color: string }, listId: string) =>
    ctrl.addItem({ listId, parentId: item.id, index: -1 }, { color: item.color });

  const deleteItem = (id: string) => {
    ctrl.remove(id);
    // A deleted item must not stay in the detail pane, editable, in either view.
    if (selectedId === id) setSelectedId(null);
  };

  return (
    <Box
      /* The outermost area: every row's menu composes ITS rows on top of these,
         and a right-click on empty space gets these alone. */
      data-axf-area="taskman.surface"
      sx={{ display: "flex", height: "100%", minHeight: 0, color: token("ink") }}
    >
      {HOVER_RULES}

      {/* ------------------------------ lists rail ------------------------------ */}
      <Stack
        sx={{
          width: railW,
          flexShrink: 0,
          minHeight: 0,
          borderRight: `1px solid ${token("edge")}`
        }}
      >
        <Stack direction="row" sx={{ alignItems: "center", padding: "10px 8px 4px 12px" }}>
          <Typography
            component="span"
            sx={{
              flex: 1,
              color: token("dim"),
              fontFamily: token("mono"),
              fontSize: 10.5,
              letterSpacing: "0.15em",
              textTransform: "uppercase"
            }}
          >
            Lists
          </Typography>
          {/* The settings affordance moved to the SHELL (core 0.0.20): the
              gear on ModuleHost and the universal "Module settings" row open
              the one SettingsDialog — the deletion TaskmanSui predicted. */}
        </Stack>

        {/* The lists bar, placed INLINE (2026-08-13).
         *
         * This div is a placeholder, not a bar: core's `InlineToolbars` — one
         * document scanner mounted by `AppShell` — finds the id and portals the
         * real `taskman-lists-bar` asset into it. That is the mechanism the
         * owner asked for the same day ("insert toolbar assets inline simply by
         * putting toolbars asset id inline in the html"), and this is its first
         * consumer, so the method ships with something real using it rather
         * than as a capability nobody has exercised.
         *
         * The alternative — three IconButtons here — is exactly what the
         * toolbar asset kind exists to stop, and would put the actions outside
         * the designer's reach. */}
        <Box data-axf-toolbar-asset="taskman-lists-bar" />

        {/* The rail's rows, its collapsible GROUPS and its ctrl-click
         * selection — all of it in `ListsRail.tsx`, lifted out of this file on
         * 2026-08-14 when the owner's request turned a flat map over
         * `ctrl.lists` into four bands with their own context area. See that
         * file's header for why the group header is a sibling of its rows
         * rather than their ancestor. */}
        <ListsRail
          ctrl={ctrl}
          scope={scope}
          onScope={setScope}
          activeListIds={activity.activeListIds}
        />
      </Stack>

      <Splitter side="left" onDelta={(dx) => setRailW((w) => Math.min(420, Math.max(150, w + dx)))} />

      {/* ------------------------------ center pane ------------------------------ */}
      <Stack sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        <Stack
          direction="row"
          sx={{ alignItems: "center", padding: "0 8px", borderBottom: `1px solid ${token("edge")}` }}
        >
          <Tabs
            value={pane}
            onChange={(_, v: "items" | "integrations") => setPane(v)}
            slotProps={{ indicator: { sx: { background: token("accent") } } }}
            sx={{ minHeight: 36 }}
          >
            <Tab
              value="items"
              label="Items"
              sx={{ minHeight: 36, fontSize: 12.5, textTransform: "none" }}
            />
            <Tab
              value="integrations"
              label="Integrations"
              sx={{ minHeight: 36, fontSize: 12.5, textTransform: "none" }}
            />
          </Tabs>
          <Box sx={{ flex: 1 }} />
          <Typography sx={{ color: token("dim"), fontSize: 11.5 }}>
            {scope === "all"
              ? `${ctrl.lists.length} lists`
              : (ctrl.lists.find((l) => l.id === scope)?.name ?? "")}
          </Typography>
        </Stack>

        {pane === "items" && (
          <>
            <Stack
              direction="row"
              sx={{
                alignItems: "center",
                gap: "8px",
                padding: "5px 8px",
                borderBottom: `1px solid ${token("edge")}`
              }}
            >
              <ToggleButtonGroup
                exclusive
                size="small"
                value={view}
                /* `v` is null when the active button is clicked again —
                   deselecting would leave the pane with no view at all. */
                onChange={(_, v: "tree" | "grid" | null) => v && setView(v)}
                aria-label="Item view"
                sx={{
                  "& .MuiToggleButton-root": {
                    padding: "3px 10px",
                    fontSize: 12.5,
                    textTransform: "none",
                    border: `1px solid ${token("edge")}`
                  },
                  "& .Mui-selected": { color: token("accent") }
                }}
              >
                <ToggleButton value="tree" aria-label="Tree view">
                  ⌸ Tree
                </ToggleButton>
                <ToggleButton value="grid" aria-label="Grid view">
                  ▦ Grid
                </ToggleButton>
              </ToggleButtonGroup>
              <Box sx={{ flex: 1 }} />
              <TextField
                placeholder="Filter…"
                size="small"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                sx={{
                  width: 170,
                  "& .MuiInputBase-input": { fontSize: 12.5, padding: "4px 10px" },
                  "& .MuiOutlinedInput-root": { borderRadius: "999px" }
                }}
              />
              <Button
                variant="contained"
                size="small"
                disabled={!focusListId}
                onClick={() => addItemToFocus()}
                sx={{ borderRadius: "999px", fontSize: 12.5, textTransform: "none" }}
              >
                + New item
              </Button>
            </Stack>

            {view === "tree" ? (
              <TaskTree
                sections={sections}
                showListHeaders={scope === "all"}
                selectedId={selectedId}
                dense={settings.dense}
                crossOutDone={settings.crossOutDone}
                onSelect={setSelectedId}
                onToggleDone={ctrl.toggleDone}
                onToggleCollapse={ctrl.toggleCollapse}
                onToggleListCollapse={toggleListCollapse}
                onRename={ctrl.rename}
                onMove={ctrl.move}
                onAddChild={addChild}
                onDelete={deleteItem}
              />
            ) : (
              <TaskGrid
                sections={sections}
                showListHeaders={scope === "all"}
                selectedId={selectedId}
                crossOut={settings.crossOutDone}
                onSelect={setSelectedId}
                onToggleDone={ctrl.toggleDone}
                onToggleListCollapse={toggleListCollapse}
                onMove={ctrl.move}
                onAddChild={addChild}
                onDelete={deleteItem}
                onOpenListWindow={ctrl.openListWindow}
              />
            )}
          </>
        )}

        {pane === "integrations" && (
          <Box sx={{ flex: 1, minHeight: 0, overflow: "auto", padding: "8px" }}>
            <Typography sx={{ margin: "0 0 10px", padding: "0 8px", color: token("dim"), fontSize: 11.5 }}>
              Modules, plugins and future extensions feed candidates here — one click turns them into
              tracked items{" "}
              {scope !== "all" ? "in the focused list" : `in "${ctrl.lists[0]?.name ?? "…"}"`}.
            </Typography>
            {getTaskProviders().map((p) => (
              <ProviderSection
                key={p.id}
                provider={p}
                onAdd={(cand) => {
                  addItemToFocus(cand.item);
                  // The reader is being sent to look at the item that was just
                  // made, so put the pane back on the tree.
                  setPane("items");
                }}
              />
            ))}
          </Box>
        )}

        {/* Selected-item strip: whatever plugged into taskman.item-action. */}
        {selected && (
          <Stack
            direction="row"
            sx={{
              alignItems: "center",
              gap: "8px",
              padding: "5px 10px",
              borderTop: `1px solid ${token("edge")}`,
              fontSize: 12
            }}
          >
            <Typography component="span" sx={{ color: token("dim"), fontSize: 12 }}>
              Selected:
            </Typography>
            <Typography
              component="span"
              sx={{
                fontWeight: 600,
                fontSize: 12,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              }}
            >
              {selected.title}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Slot
              point="taskman.item-action"
              render={(payload) => {
                const action = payload as ItemActionPayload;
                return (
                  <Button
                    size="small"
                    onClick={() => commands.run(action.command)}
                    sx={{ fontSize: 12, textTransform: "none", color: token("accent") }}
                  >
                    {action.label}
                  </Button>
                );
              }}
            />
          </Stack>
        )}
      </Stack>

      <Splitter
        side="right"
        onDelta={(dx) => setDetailW((w) => Math.min(560, Math.max(230, w - dx)))}
      />

      {/* ------------------------------ detail pane ------------------------------ */}
      <Box
        sx={{
          width: detailW,
          flexShrink: 0,
          minHeight: 0,
          borderLeft: `1px solid ${token("edge")}`
        }}
      >
        <ItemDetail
          item={selected}
          onPatch={ctrl.patch}
          onDelete={(id) => {
            ctrl.remove(id);
            setSelectedId(null);
          }}
          onDuplicate={ctrl.duplicate}
          onOpenWindow={() => ctrl.openListWindow(found?.listId ?? focusListId)}
        />
      </Box>

      <TaskWindows ctrl={ctrl} />
    </Box>
  );
}

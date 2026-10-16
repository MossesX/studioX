/**
 * @file The NAV MENU tab — build, edit and save nav-menu assets, and pick the
 * one this theme uses.
 *
 * The sibling of `ToolbarTab`, over the other piece of chrome. The same split
 * holds: the ASSET owns what is navigable (items, routes, glyphs), the theme's
 * LAYOUT dials own where and how it presents (edge, style, size, motion — all
 * on the Dials tab), and the theme's `navMenu` chrome dial owns WHICH asset
 * renders. Selecting here repaints the real shell nav immediately; *Apply to
 * app* persists it; a saved look restores it, because the selection is a dial.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { defineNavMenu, theme as themeStore, useAppliedThemeValues, useNavMenus } from "@axf/core";
import type { NavItem, NavMenuAsset } from "@axf/core";

import { chromeSlug } from "../../chrome/assets";
import { CandidateCard, freshItemId, GlyphSelect, MONO, moved, RowMoves, useChromeDoc } from "./chrome-bits";

const ICON_CATEGORIES = ["icon"] as const;

const ITEM_KINDS: readonly NavItem["kind"][] = ["link", "section", "divider"];

function newItem(kind: NavItem["kind"], taken: ReadonlySet<string>): NavItem {
  const id = freshItemId(kind, taken);
  switch (kind) {
    case "link":
      return { kind, id, label: "New link", glyph: "icon-grid", route: "/" };
    case "section":
      return { kind, id, label: "Section" };
    case "divider":
      return { kind, id };
  }
}

export default function NavMenuTab() {
  const snapshot = useNavMenus();
  const values = useAppliedThemeValues();
  const { doc, save, loaded } = useChromeDoc();

  const dialled = String(values.navMenu ?? "").trim();
  const customIds = React.useMemo(() => new Set(doc.navs.map((n) => n.id)), [doc.navs]);
  const candidates = React.useMemo(
    () => snapshot.all.filter((n) => n.surface === "app.nav"),
    [snapshot.all]
  );
  const registryDefault = snapshot.active.get("app.nav")?.id ?? null;

  /** Routes the studio actually serves, offered as suggestions for a link. */
  const knownRoutes = React.useMemo(() => {
    const routes = new Set<string>();
    for (const menu of snapshot.all) {
      for (const item of menu.items) if (item.kind === "link") routes.add(item.route);
    }
    return [...routes].sort();
  }, [snapshot.all]);

  const [draft, setDraft] = React.useState<NavMenuAsset | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [savedFlash, setSavedFlash] = React.useState(false);

  const duplicate = React.useCallback((asset: NavMenuAsset) => {
    const base = asset.title.replace(/\s*\(copy.*\)$/, "");
    let title = `${base} (copy)`;
    let id = chromeSlug(title);
    let n = 2;
    while (customIds.has(id)) {
      title = `${base} (copy ${n})`;
      id = chromeSlug(title);
      n += 1;
    }
    setDraft({ ...asset, id, title, items: asset.items.map((i) => ({ ...i })) });
    setProblem(null);
  }, [customIds]);

  const saveDraft = React.useCallback(async () => {
    if (!draft) return;
    try {
      const valid = defineNavMenu(draft);
      const rest = doc.navs.filter((n) => n.id !== valid.id);
      const ok = await save({ ...doc, navs: [...rest, valid] });
      setProblem(ok ? null : "saved locally, but the server mirror failed — it will not survive a reload");
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [draft, doc, save]);

  const remove = React.useCallback(async (id: string) => {
    await save({ ...doc, navs: doc.navs.filter((n) => n.id !== id) });
    if (dialled === id) themeStore.setValue("navMenu", "");
    if (draft?.id === id) setDraft(null);
  }, [doc, save, dialled, draft]);

  const patchItem = (index: number, next: NavItem) => {
    if (!draft) return;
    const items = [...draft.items];
    items[index] = next;
    setDraft({ ...draft, items });
  };

  return (
    <Box sx={{ display: "grid", gap: 2, alignItems: "start", gridTemplateColumns: { xs: "1fr", lg: "minmax(380px, 42%) 1fr" } }}>
      {/* -------------------------------------------------------- candidates */}
      <Stack spacing={1.5}>
        <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            <Typography variant="subtitle2">Nav menus</Typography>
            <Chip size="small" variant="outlined" label={candidates.length} sx={{ ...MONO, height: 18 }} />
            <Box sx={{ flex: 1 }} />
            <Button
              size="small"
              variant="outlined"
              disabled={!dialled}
              onClick={() => themeStore.setValue("navMenu", "")}
            >
              Use app default
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            The theme decides which menu the shell places; where it sits and how it draws are the
            layout dials on the Dials tab. Picking one repaints the app now; <strong>Apply to
            app</strong> saves it.
          </Typography>
          <Divider />
          {candidates.map((asset) => (
            <CandidateCard
              key={asset.id}
              id={asset.id}
              title={asset.title}
              description={asset.description}
              custom={customIds.has(asset.id)}
              inTheme={dialled === asset.id}
              registryDefault={!dialled && registryDefault === asset.id}
              editing={draft?.id === asset.id}
              onUse={() => themeStore.setValue("navMenu", asset.id)}
              onEdit={customIds.has(asset.id) ? () => {
                setDraft({ ...asset, items: asset.items.map((i) => ({ ...i })) });
                setProblem(null);
              } : undefined}
              onDuplicate={() => duplicate(asset)}
              onDelete={customIds.has(asset.id) ? () => void remove(asset.id) : undefined}
            />
          ))}
          {!loaded ? (
            <Typography variant="caption" color="text.secondary">
              Loading saved menus…
            </Typography>
          ) : null}
        </Paper>
      </Stack>

      {/* ------------------------------------------------------------ editor */}
      <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1.25 }}>
        {!draft ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            Nothing being edited. <strong>Duplicate</strong> a menu on the left to start from it —
            built-ins are code, so they are copied into an editable asset rather than changed in
            place.
          </Typography>
        ) : (
          <>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
              <Typography variant="subtitle2">Editing</Typography>
              <Chip size="small" variant="outlined" label={draft.id} sx={{ ...MONO, height: 18 }} />
              <Box sx={{ flex: 1 }} />
              <Button size="small" onClick={() => setDraft(null)}>Close</Button>
              <Button size="small" variant="contained" onClick={() => void saveDraft()}>
                {savedFlash ? "Saved" : "Save menu"}
              </Button>
            </Stack>

            {problem ? <Alert severity="error" sx={{ py: 0 }}>{problem}</Alert> : null}

            <TextField
              size="small"
              fullWidth
              label="Title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <TextField
              size="small"
              fullWidth
              label="Description"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />

            <Divider />
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                Items, top to bottom. Icons come from the branding pack; a menu needs at least one
                link.
              </Typography>
              <Box sx={{ flex: 1 }} />
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel id="add-nav-item">Add item</InputLabel>
                <Select
                  labelId="add-nav-item"
                  label="Add item"
                  value=""
                  onChange={(e) => {
                    const kind = e.target.value as NavItem["kind"];
                    if (!kind) return;
                    const taken = new Set(draft.items.map((i) => i.id));
                    setDraft({ ...draft, items: [...draft.items, newItem(kind, taken)] });
                  }}
                >
                  {ITEM_KINDS.map((k) => (
                    <MenuItem key={k} value={k}>{k}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>

            <Stack spacing={0.75}>
              {draft.items.map((item, index) => (
                <Paper key={item.id} variant="outlined" sx={{ p: 1, display: "grid", gap: 0.75 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Chip size="small" label={item.kind} sx={{ ...MONO, height: 18 }} />
                    <Typography variant="caption" sx={{ ...MONO, color: "text.secondary" }}>
                      {item.id}
                    </Typography>
                    <Box sx={{ flex: 1 }} />
                    <RowMoves
                      onUp={index > 0 ? () => setDraft({ ...draft, items: moved(draft.items, index, index - 1) }) : null}
                      onDown={index < draft.items.length - 1 ? () => setDraft({ ...draft, items: moved(draft.items, index, index + 1) }) : null}
                      onRemove={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })}
                    />
                  </Stack>

                  {item.kind === "link" ? (
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                      <TextField
                        size="small" label="Label" sx={{ flex: 1, minWidth: 140 }}
                        value={item.label}
                        onChange={(e) => patchItem(index, { ...item, label: e.target.value })}
                      />
                      <Box sx={{ minWidth: 190 }}>
                        <GlyphSelect
                          label="Icon"
                          value={item.glyph}
                          categories={ICON_CATEGORIES}
                          onChange={(glyph) => patchItem(index, { ...item, glyph })}
                        />
                      </Box>
                      <FormControl size="small" sx={{ minWidth: 170 }}>
                        <InputLabel id={`route-${item.id}`}>Route</InputLabel>
                        <Select
                          labelId={`route-${item.id}`}
                          label="Route"
                          value={knownRoutes.includes(item.route) ? item.route : ""}
                          onChange={(e) => {
                            if (e.target.value) patchItem(index, { ...item, route: e.target.value });
                          }}
                          displayEmpty
                          renderValue={(v) => (v ? String(v) : item.route)}
                        >
                          {knownRoutes.map((r) => (
                            <MenuItem key={r} value={r}>{r}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <TextField
                        size="small" label="Route (free)" sx={{ width: 150 }}
                        value={item.route}
                        onChange={(e) => patchItem(index, { ...item, route: e.target.value })}
                      />
                    </Stack>
                  ) : null}

                  {item.kind === "section" ? (
                    <TextField
                      size="small" label="Label" sx={{ maxWidth: 260 }}
                      value={item.label}
                      onChange={(e) => patchItem(index, { ...item, label: e.target.value })}
                    />
                  ) : null}
                </Paper>
              ))}
            </Stack>

            <Typography variant="caption" color="text.secondary">
              Saving validates through core&apos;s `defineNavMenu` — a link without a glyph or a
              label, a route that does not start with `/`, or a menu with no links is refused with
              the reason. Custom menus persist on the server and register on boot.
            </Typography>
          </>
        )}
      </Paper>
    </Box>
  );
}

/**
 * @file The TOOLBAR tab — build, edit and save banner toolbars, and pick the
 * one this theme uses.
 *
 * Owner request, 2026-08-12: *"make a toolbar tab and a navigation menu tab to
 * build edit and save toolbar and navigation menu assets and select one thats
 * part of the theme design. allow selecting logos from branding packs for the
 * toolbar"*.
 *
 * The moving parts, and who owns each:
 *
 *   - **candidates** — every registered `app.banner` toolbar: the built-ins
 *     (code, in `src/toolbars/`) plus the user-authored ones (data, in the
 *     chrome-assets document). Built-ins are duplicated to edit, never edited
 *     in place — an asset that is code stays code.
 *   - **selection** — the theme's `bannerBar` dial. "Use in theme" is a dial
 *     edit like any other: the app repaints immediately (the designer's
 *     preview) and *Apply to app* in the header is what persists it. A saved
 *     look therefore carries its bar with it, because the bar IS a dial.
 *   - **the drawing** — a brand item's `glyph` is picked from the ACTIVE
 *     branding pack (logos, marks, lockups, wordmarks), which is the owner's
 *     "logos from branding packs" — the pack stays a fixed global setting;
 *     the bar only names which of its drawings to use.
 *
 * There is no preview pane here on purpose: selecting a bar repaints the REAL
 * banner over this very screen, which is a truer preview than any thumbnail.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { defineToolbar, theme as themeStore, useAppliedThemeValues, useToolbars } from "@axf/core";
import type { ToolbarAsset, ToolbarItem } from "@axf/core";

import { chromeSlug, CUSTOM_PREFIX } from "../../chrome/assets";
import { CandidateCard, freshItemId, GlyphSelect, MONO, moved, RowMoves, useChromeDoc } from "./chrome-bits";

/** Drawings a banner brand item should offer — the pack's logo shelf. */
const BRAND_CATEGORIES = ["logo", "mark", "wordmark", "lockup", "badge", "watermark"] as const;
/** Drawings an action/menu/field icon should offer. */
const ICON_CATEGORIES = ["icon"] as const;

const ITEM_KINDS: readonly ToolbarItem["kind"][] = [
  "brand", "label", "divider", "spacer", "slot", "action", "menu", "field", "status"
];

/** A new item of a kind, valid enough to save immediately. */
function newItem(kind: ToolbarItem["kind"], taken: ReadonlySet<string>): ToolbarItem {
  const id = freshItemId(kind, taken);
  switch (kind) {
    case "brand":
      return { kind, id, glyph: "lockup-horizontal", width: 104, command: "nav.home" };
    case "label":
      return { kind, id, text: "Label" };
    case "divider":
    case "spacer":
    case "slot":
      return { kind, id };
    case "action":
      return { kind, id, glyph: "icon-gear", title: "Action", command: "settings.open" };
    case "menu":
      return { kind, id, glyph: "icon-grid", label: "Menu", command: "modules.open" };
    case "field":
      return { kind, id, glyph: "icon-search", placeholder: "Search…", width: 220, command: "search.open" };
    case "status":
      return { kind, id, tone: "dim" };
  }
}

export default function ToolbarTab() {
  const snapshot = useToolbars();
  const values = useAppliedThemeValues();
  const { doc, save, loaded } = useChromeDoc();

  const dialled = String(values.bannerBar ?? "").trim();
  const customIds = React.useMemo(() => new Set(doc.toolbars.map((t) => t.id)), [doc.toolbars]);
  const candidates = React.useMemo(
    () => snapshot.all.filter((t) => t.surface === "app.banner"),
    [snapshot.all]
  );
  const registryDefault = snapshot.active.get("app.banner")?.id ?? null;

  const [draft, setDraft] = React.useState<ToolbarAsset | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [savedFlash, setSavedFlash] = React.useState(false);

  const use = React.useCallback((id: string) => {
    // A dial edit like any other: preview now, Apply to app persists.
    themeStore.setValue("bannerBar", id);
  }, []);

  const duplicate = React.useCallback((asset: ToolbarAsset) => {
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
      const valid = defineToolbar(draft);
      const rest = doc.toolbars.filter((t) => t.id !== valid.id);
      const ok = await save({ ...doc, toolbars: [...rest, valid] });
      setProblem(ok ? null : "saved locally, but the server mirror failed — it will not survive a reload");
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error));
    }
  }, [draft, doc, save]);

  const remove = React.useCallback(async (id: string) => {
    await save({ ...doc, toolbars: doc.toolbars.filter((t) => t.id !== id) });
    // Keep the chips truthful: a dial naming a deleted bar would silently fall
    // back anyway; clearing it says so instead.
    if (dialled === id) themeStore.setValue("bannerBar", "");
    if (draft?.id === id) setDraft(null);
  }, [doc, save, dialled, draft]);

  const patchItem = (index: number, next: ToolbarItem) => {
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
            <Typography variant="subtitle2">Banner toolbars</Typography>
            <Chip size="small" variant="outlined" label={candidates.length} sx={{ ...MONO, height: 18 }} />
            <Box sx={{ flex: 1 }} />
            <Button
              size="small"
              variant="outlined"
              disabled={Boolean(dialled) === false}
              onClick={() => themeStore.setValue("bannerBar", "")}
            >
              Use app default
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            The theme decides which bar draws the banner. Picking one repaints the app now; the
            header&apos;s <strong>Apply to app</strong> saves it, and a saved look restores it.
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
              onUse={() => use(asset.id)}
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
              Loading saved toolbars…
            </Typography>
          ) : null}
        </Paper>
      </Stack>

      {/* ------------------------------------------------------------ editor */}
      <Paper variant="outlined" sx={{ p: 1.5, display: "grid", gap: 1.25 }}>
        {!draft ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            Nothing being edited. <strong>Duplicate</strong> a bar on the left to start from it —
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
                {savedFlash ? "Saved" : "Save toolbar"}
              </Button>
            </Stack>

            {problem ? <Alert severity="error" sx={{ py: 0 }}>{problem}</Alert> : null}

            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                label="Title"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
              <TextField
                size="small"
                label="Height px"
                type="number"
                sx={{ width: 110 }}
                value={draft.height ?? 40}
                onChange={(e) => setDraft({ ...draft, height: Number(e.target.value) || undefined })}
              />
              {/* The bar's DECLARED icon size and words — what it ships with,
                  and what every reader's own right-click settings start from.
                  Blank/0 means "the shipped 13px", which is why the field falls
                  back to `undefined` rather than writing a number nobody chose. */}
              <TextField
                size="small"
                label="Icon px"
                type="number"
                sx={{ width: 100 }}
                value={draft.iconSize ?? 13}
                onChange={(e) => setDraft({ ...draft, iconSize: Number(e.target.value) || undefined })}
              />
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={draft.labels !== false}
                    onChange={(_, v) => setDraft({ ...draft, labels: v ? undefined : false })}
                  />
                }
                label={<Typography variant="caption">text</Typography>}
              />
              <FormControl size="small" sx={{ minWidth: 120 }}>
                <InputLabel id="bar-bg">Surface</InputLabel>
                <Select
                  labelId="bar-bg"
                  label="Surface"
                  value={draft.background ?? "panel2"}
                  onChange={(e) =>
                    setDraft({ ...draft, background: e.target.value as ToolbarAsset["background"] })
                  }
                >
                  <MenuItem value="page">page</MenuItem>
                  <MenuItem value="panel">panel</MenuItem>
                  <MenuItem value="panel2">panel2</MenuItem>
                </Select>
              </FormControl>
            </Stack>
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
                Items, left to right. A banner must carry exactly the brand it means to show.
              </Typography>
              <Box sx={{ flex: 1 }} />
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel id="add-item">Add item</InputLabel>
                <Select
                  labelId="add-item"
                  label="Add item"
                  value=""
                  onChange={(e) => {
                    const kind = e.target.value as ToolbarItem["kind"];
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

                  {item.kind === "brand" ? (
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                      <Box sx={{ flex: 1, minWidth: 220 }}>
                        <GlyphSelect
                          label="Logo from the branding pack"
                          value={item.glyph ?? ""}
                          categories={BRAND_CATEGORIES}
                          onChange={(glyph) => patchItem(index, { ...item, glyph: glyph || undefined })}
                        />
                      </Box>
                      <TextField
                        size="small" label="Width px" type="number" sx={{ width: 100 }}
                        value={item.width ?? 104}
                        onChange={(e) => patchItem(index, { ...item, width: Number(e.target.value) || undefined })}
                      />
                      <TextField
                        size="small" label="Command (optional)" sx={{ width: 170 }}
                        value={item.command ?? ""}
                        onChange={(e) => patchItem(index, { ...item, command: e.target.value || undefined })}
                      />
                    </Stack>
                  ) : null}

                  {item.kind === "label" ? (
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                      <TextField
                        size="small" label="Text" sx={{ flex: 1, minWidth: 160 }}
                        value={item.text}
                        onChange={(e) => patchItem(index, { ...item, text: e.target.value })}
                      />
                      <FormControl size="small" sx={{ minWidth: 100 }}>
                        <InputLabel id={`tone-${item.id}`}>Tone</InputLabel>
                        <Select
                          labelId={`tone-${item.id}`} label="Tone" value={item.tone ?? "dim"}
                          onChange={(e) => patchItem(index, { ...item, tone: e.target.value as "ink" | "dim" | "accent" })}
                        >
                          <MenuItem value="ink">ink</MenuItem>
                          <MenuItem value="dim">dim</MenuItem>
                          <MenuItem value="accent">accent</MenuItem>
                        </Select>
                      </FormControl>
                      <FormControlLabel
                        control={<Switch size="small" checked={item.caps !== false}
                          onChange={(_, v) => patchItem(index, { ...item, caps: v ? undefined : false })} />}
                        label={<Typography variant="caption">caps</Typography>}
                      />
                    </Stack>
                  ) : null}

                  {item.kind === "action" || item.kind === "menu" ? (
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                      <Box sx={{ flex: 1, minWidth: 190 }}>
                        <GlyphSelect
                          label="Icon"
                          value={item.glyph}
                          categories={ICON_CATEGORIES}
                          onChange={(glyph) => patchItem(index, { ...item, glyph })}
                        />
                      </Box>
                      {item.kind === "action" ? (
                        <>
                          <TextField size="small" label="Tooltip" sx={{ width: 170 }} value={item.title}
                            onChange={(e) => patchItem(index, { ...item, title: e.target.value })} />
                          <TextField size="small" label="Button label (optional)" sx={{ width: 170 }} value={item.label ?? ""}
                            onChange={(e) => patchItem(index, { ...item, label: e.target.value || undefined })} />
                        </>
                      ) : (
                        <TextField size="small" label="Label" sx={{ width: 150 }} value={item.label}
                          onChange={(e) => patchItem(index, { ...item, label: e.target.value })} />
                      )}
                      <TextField size="small" label="Command" sx={{ width: 170 }} value={item.command}
                        onChange={(e) => patchItem(index, { ...item, command: e.target.value })} />
                    </Stack>
                  ) : null}

                  {item.kind === "field" ? (
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
                      <Box sx={{ minWidth: 180 }}>
                        <GlyphSelect
                          label="Icon"
                          value={item.glyph}
                          categories={ICON_CATEGORIES}
                          onChange={(glyph) => patchItem(index, { ...item, glyph })}
                        />
                      </Box>
                      <TextField size="small" label="Placeholder" sx={{ flex: 1, minWidth: 150 }} value={item.placeholder}
                        onChange={(e) => patchItem(index, { ...item, placeholder: e.target.value })} />
                      <TextField size="small" label="Hotkey hint" sx={{ width: 110 }} value={item.hint ?? ""}
                        onChange={(e) => patchItem(index, { ...item, hint: e.target.value || undefined })} />
                      <TextField size="small" label="Width px" type="number" sx={{ width: 100 }} value={item.width ?? 200}
                        onChange={(e) => patchItem(index, { ...item, width: Number(e.target.value) || undefined })} />
                      <TextField size="small" label="Command" sx={{ width: 160 }} value={item.command}
                        onChange={(e) => patchItem(index, { ...item, command: e.target.value })} />
                    </Stack>
                  ) : null}

                  {item.kind === "status" ? (
                    <FormControl size="small" sx={{ maxWidth: 160 }}>
                      <InputLabel id={`stone-${item.id}`}>Tone</InputLabel>
                      <Select
                        labelId={`stone-${item.id}`} label="Tone" value={item.tone ?? "dim"}
                        onChange={(e) => patchItem(index, { ...item, tone: e.target.value as "ink" | "dim" | "accent" | "ok" | "warn" | "err" })}
                      >
                        {["ink", "dim", "accent", "ok", "warn", "err"].map((t) => (
                          <MenuItem key={t} value={t}>{t}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : null}

                  {item.kind === "slot" ? (
                    <Typography variant="caption" color="text.secondary">
                      A named region the shell fills (`context`, `dock`, `clock`…). The id decides
                      what lands in it.
                    </Typography>
                  ) : null}
                </Paper>
              ))}
            </Stack>

            <Typography variant="caption" color="text.secondary">
              Saving validates through core&apos;s `defineToolbar` — a banner with no brand item, a
              duplicate id or an empty command is refused with the reason, not stored broken. Custom
              bars persist on the server (ids start with `{CUSTOM_PREFIX}`) and register on boot.
            </Typography>
          </>
        )}
      </Paper>
    </Box>
  );
}

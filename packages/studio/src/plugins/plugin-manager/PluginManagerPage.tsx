/**
 * @file `/plugins` — the Plugin Manager.
 *
 * The consumer `studio.plugin` and `studio.settings-section` were declared FOR
 * (studio.points.ts: "declared before the manager exists, deliberately"). The
 * roster it shows is a JOIN of three sources, and the join is the design:
 *
 *   1. **The live registry** — every contribution's `from` names its plugin,
 *      so the roster derives from what is REGISTERED rather than from a list
 *      someone maintains. A plugin nobody edited into this page still appears
 *      here the moment it contributes anything.
 *   2. **`studio.plugin` roster rows** — the enrichment a plugin states about
 *      itself (summary, target, settings owner, the row that means "on").
 *      Where a plugin declares none, the manager infers what it can: a
 *      registered settings owner with the plugin's id, an `enabled` row by
 *      its conventional key.
 *   3. **The server's disk report** (`/api/plugins`) — directories,
 *      manifests, the assets ledger, which plugins the engine imported.
 *
 * Enable/disable follows the one-switch doctrine the roster payload states:
 * a plugin with an `enabledKey` flips through its OWN settings store (the
 * same write its own dialog makes); an imported plugin flips through the
 * ledger and the generated loader; a built-in with neither is honestly
 * "always on while registered". Settings EDITING is the shell's one
 * `SettingsDialog` — this page renders declared rows read-only and opens
 * that dialog to change them, because a second settings UI is exactly what
 * `settings/decl.ts` replaced four times over.
 */
"use client";

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Tab from "@mui/material/Tab";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, registry, settings, settingsUi, useModuleSettings } from "@axf/core";
import type { ExtensionPoint, SettingRow } from "@axf/core";

import type { StudioPluginPayload } from "../../studio.points";
import { PLUGIN_MANAGER_EVENT } from "./plugin-manager.commands";
import { PLUGIN_MANAGER_ID } from "./plugin-manager.decl";
import type {
  ImportResult,
  PluginDirReport,
  PluginFileInfo,
  PluginFileKind,
  PluginInventory,
  PluginListResponse
} from "./types";

const MONO = { fontFamily: "var(--axf-mono)", fontSize: 11 } as const;

/* ── the joined roster ────────────────────────────────────────────────────── */

interface RosterEntry {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** The roster vocabulary (`core` | `module` | `subsystem`), best known. */
  readonly target: string;
  /** Points this plugin is LIVE on right now. */
  readonly livePoints: readonly string[];
  readonly settingsOwner?: string;
  readonly enabledKey?: string;
  /** The settings kv namespace, when the owner is registered — the files
   *  tab's `ns`. */
  readonly ns?: string;
  readonly announced: boolean;
  readonly disk?: PluginDirReport;
}

function targetOfManifest(target: string | undefined): string {
  if (!target) return "core";
  if (target.startsWith("module:")) return "module";
  if (target === "universal") return "core";
  return target;
}

/**
 * Join the three sources. Pure over its inputs so `useMemo` on (registry
 * version, settings tick, disk report) is the whole caching story.
 */
function deriveRoster(disk: readonly PluginDirReport[]): RosterEntry[] {
  const moduleIds = new Set(registry.modules().map((m) => m.id));
  const announced = new Map<string, StudioPluginPayload>();
  for (const c of registry.contributionsTo<StudioPluginPayload>("studio.plugin")) {
    announced.set(c.payload.id, c.payload);
  }

  const liveByFrom = new Map<string, Set<string>>();
  for (const point of registry.points()) {
    for (const c of registry.contributionsTo(point.id)) {
      if (moduleIds.has(c.from)) continue;
      let set = liveByFrom.get(c.from);
      if (!set) liveByFrom.set(c.from, (set = new Set()));
      set.add(point.id);
    }
  }

  const diskById = new Map(disk.map((d) => [d.id, d]));
  const ids = new Set<string>([...announced.keys(), ...liveByFrom.keys(), ...diskById.keys()]);

  const entries: RosterEntry[] = [];
  for (const id of ids) {
    const a = announced.get(id);
    const d = diskById.get(id);
    const owner = a?.settingsOwner ?? (settings.has(id) ? id : undefined);
    const decl = owner ? settings.get(owner)?.decl : undefined;
    const enabledKey =
      a?.enabledKey ?? (decl?.rows.some((r: SettingRow) => r.key === "enabled") ? "enabled" : undefined);
    entries.push({
      id,
      title: a?.title ?? d?.manifest?.name ?? id,
      summary: a?.summary ?? d?.manifest?.summary ?? "",
      target: a?.target ?? targetOfManifest(d?.manifest?.target ?? d?.registered?.target),
      livePoints: [...(liveByFrom.get(id) ?? [])].sort(),
      ...(owner ? { settingsOwner: owner } : {}),
      ...(enabledKey ? { enabledKey } : {}),
      ...(decl?.ns ? { ns: decl.ns } : {}),
      announced: announced.has(id),
      ...(d ? { disk: d } : {})
    });
  }
  return entries.sort((x, y) => x.title.localeCompare(y.title));
}

/* ── small pieces ─────────────────────────────────────────────────────────── */

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString();
}

/**
 * The one-switch doctrine as a component: bound to the plugin's OWN settings
 * store through the same hook its own surface reads, flipping the same row
 * its own dialog flips. One component instance per plugin row keeps the hook
 * rule and the doctrine in the same place.
 */
function OwnStoreSwitch({ owner, enabledKey }: { owner: string; enabledKey: string }) {
  const values = useModuleSettings(owner);
  const store = settings.get(owner);
  if (!store) return <Chip size="small" variant="outlined" label="store not registered" />;
  const on = Boolean(values[enabledKey] ?? true);
  return (
    <Tooltip title={`Flips "${enabledKey}" in ${owner}'s own settings — the same switch its dialog shows`}>
      <Switch size="small" checked={on} onChange={() => store.set(enabledKey, !on)} />
    </Tooltip>
  );
}

function KindChip({ kind }: { kind: PluginFileKind }) {
  const color = kind === "modified" ? "warning" : kind === "generated" ? "info" : "default";
  return <Chip size="small" color={color} variant="outlined" label={kind} />;
}

/* ── detail tabs ──────────────────────────────────────────────────────────── */

function OverviewTab({
  entry,
  points,
  onExport,
  onUninstall,
  onImportedFlip,
  busy
}: {
  entry: RosterEntry;
  points: readonly ExtensionPoint[];
  onExport: () => void;
  onUninstall: () => void;
  onImportedFlip: (enabled: boolean) => void;
  busy: boolean;
}) {
  const pointById = React.useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const violations = registry.violations().filter((v) => v.from === entry.id);
  const d = entry.disk;
  const imported = d?.imported === true;

  return (
    <Stack spacing={2}>
      {entry.summary ? (
        <Typography variant="body2">{entry.summary}</Typography>
      ) : (
        <Typography variant="body2" color="text.secondary">
          This plugin announces no summary — a `studio.plugin` roster row would give it one.
        </Typography>
      )}

      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
        <Chip size="small" label={`target: ${entry.target}`} variant="outlined" />
        {d?.manifest ? (
          <Chip size="small" label={`v${d.manifest.version} · ${d.manifest.kind} · ${d.manifest.layer}`} variant="outlined" />
        ) : (
          <Chip size="small" label="no manifest.json" color="warning" variant="outlined" />
        )}
        <Chip
          size="small"
          label={imported ? "imported package" : "built-in (statically composed)"}
          color={imported ? "info" : "default"}
          variant="outlined"
        />
        {d?.registered ? (
          <Chip size="small" label={`ledger: ${d.registered.enabled ? "enabled" : "disabled"}`} variant="outlined" />
        ) : null}
        {entry.livePoints.length === 0 ? (
          <Chip size="small" label="not registered this boot" color="warning" variant="outlined" />
        ) : null}
      </Stack>

      {d?.manifestProblem ? <Alert severity="warning">manifest.json: {d.manifestProblem}</Alert> : null}
      {violations.length ? (
        <Alert severity="error">
          {violations.length} refused contribution(s):{" "}
          {violations.map((v) => `${v.point} — ${v.problem}`).join(" · ")}
        </Alert>
      ) : null}

      <Divider />

      <Typography variant="subtitle2">Contributes to</Typography>
      {entry.livePoints.length ? (
        <Stack spacing={0.75}>
          {entry.livePoints.map((pid) => {
            const p = pointById.get(pid);
            return (
              <Stack key={pid} direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                <Typography component="span" sx={MONO}>
                  {pid}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {p ? `${p.title} — ${p.description}` : "point not declared this boot"}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
      ) : (
        <Typography variant="caption" color="text.secondary">
          Nothing live this boot — on disk but not composed, or its host is absent.
        </Typography>
      )}

      <Divider />

      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", alignItems: "center" }} useFlexGap>
        {entry.settingsOwner && entry.enabledKey ? (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <OwnStoreSwitch owner={entry.settingsOwner} enabledKey={entry.enabledKey} />
            <Typography variant="caption">enabled (own store)</Typography>
          </Stack>
        ) : imported && d?.registered ? (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <Switch
              size="small"
              checked={d.registered.enabled}
              disabled={busy}
              onChange={(e) => onImportedFlip(e.target.checked)}
            />
            <Typography variant="caption">enabled (ledger — applies at next compile)</Typography>
          </Stack>
        ) : (
          <Tooltip title="Declares neither an enable switch nor an engine ledger entry">
            <Chip size="small" variant="outlined" label="always on while registered" />
          </Tooltip>
        )}
        {entry.settingsOwner && settings.has(entry.settingsOwner) ? (
          <Button size="small" variant="outlined" onClick={() => settingsUi.open(entry.settingsOwner!)}>
            Settings
          </Button>
        ) : null}
        <Button size="small" variant="outlined" disabled={!d} onClick={onExport}>
          Export package
        </Button>
        {imported ? (
          <Button size="small" color="error" variant="outlined" disabled={busy} onClick={onUninstall}>
            Uninstall
          </Button>
        ) : (
          <Tooltip title="Built-ins are composed in studio.subsystem.ts — the engine only uninstalls plugins it imported">
            <span>
              <Button size="small" color="error" variant="outlined" disabled>
                Uninstall
              </Button>
            </span>
          </Tooltip>
        )}
      </Stack>
    </Stack>
  );
}

function SettingsTab({ entry }: { entry: RosterEntry }) {
  const owner = entry.settingsOwner;
  const values = useModuleSettings(owner ?? "");
  if (!owner || !settings.has(owner)) {
    return (
      <Typography variant="body2" color="text.secondary">
        This plugin declares no settings. A `ModuleSettingsDecl` on its decl plus a line in the
        host&apos;s `registerModuleSettings` loop is what adds some.
      </Typography>
    );
  }
  const store = settings.get(owner);
  const rows = store?.decl.rows ?? [];
  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
          Declared rows — owner <Box component="span" sx={MONO}>{owner}</Box>, ns{" "}
          <Box component="span" sx={MONO}>{store?.decl.ns}</Box>
        </Typography>
        <Button size="small" variant="contained" onClick={() => settingsUi.open(owner)}>
          Open settings dialog
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        Values are edited through the shell&apos;s one dialog — this table only reads.
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Setting</TableCell>
            <TableCell>Key</TableCell>
            <TableCell>Kind</TableCell>
            <TableCell>Value</TableCell>
            <TableCell>Default</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row: SettingRow) => (
            <TableRow key={row.key} hover>
              <TableCell>
                <Tooltip title={row.hint}>
                  <span>{row.label}</span>
                </Tooltip>
              </TableCell>
              <TableCell sx={MONO}>{row.key}</TableCell>
              <TableCell>{row.kind}</TableCell>
              <TableCell sx={MONO}>{String(values[row.key] ?? row.defaultValue)}</TableCell>
              <TableCell sx={{ ...MONO, color: "text.secondary" }}>{String(row.defaultValue)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Stack>
  );
}

function DocsTab({ entry, inventory }: { entry: RosterEntry; inventory: PluginInventory | null }) {
  const manifest = entry.disk?.manifest;
  return (
    <Stack spacing={2}>
      {manifest?.summary ? <Typography variant="body2">{manifest.summary}</Typography> : null}
      {inventory?.readme ? (
        <Paper variant="outlined" sx={{ p: 2, overflow: "auto", maxHeight: 420 }}>
          <Typography component="pre" sx={{ ...MONO, fontSize: 12, whiteSpace: "pre-wrap", m: 0 }}>
            {inventory.readme}
          </Typography>
        </Paper>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No README.md in the plugin&apos;s directory. The Overview tab&apos;s contribution list is
          the generated reference; the project documentation lives at <a href="/docs">/docs</a>.
        </Typography>
      )}
    </Stack>
  );
}

function FilesTab({
  inventory,
  loading,
  error,
  onRefresh
}: {
  inventory: PluginInventory | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const groups = React.useMemo(() => {
    const g: Record<PluginFileKind, PluginFileInfo[]> = { modified: [], generated: [], source: [] };
    for (const f of inventory?.files ?? []) g[f.kind].push(f);
    return g;
  }, [inventory]);

  if (loading) return <CircularProgress size={22} />;
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!inventory) return null;

  const order: { kind: PluginFileKind; title: string; blurb: string }[] = [
    { kind: "modified", title: "Modified now", blurb: "tracked in git and currently dirty" },
    { kind: "generated", title: "Generated", blurb: "untracked — produced at runtime, never exported" },
    { kind: "source", title: "Source", blurb: "tracked in git and clean" }
  ];

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
        <Typography variant="caption" sx={{ flexGrow: 1 }} color="text.secondary">
          {inventory.files.length} file(s) under <Box component="span" sx={MONO}>{inventory.root}</Box>
          {inventory.files.some((f) => !f.path.startsWith(inventory.root)) ? " and its data" : ""}
        </Typography>
        <Button size="small" onClick={onRefresh}>
          Refresh
        </Button>
      </Stack>
      {!inventory.gitAware ? (
        <Alert severity="warning">
          git was unavailable — “source” vs “modified” could not be told apart, so every tracked-looking
          file reports as source.
        </Alert>
      ) : null}
      {inventory.truncated ? (
        <Alert severity="warning">The walk hit a structural cap — this list is incomplete.</Alert>
      ) : null}
      {order.map(({ kind, title, blurb }) =>
        groups[kind].length ? (
          <Box key={kind}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 0.5 }}>
              <Typography variant="subtitle2">{title}</Typography>
              <Typography variant="caption" color="text.secondary">
                {groups[kind].length} · {blurb}
              </Typography>
            </Stack>
            <Table size="small">
              <TableBody>
                {groups[kind].map((f) => (
                  <TableRow key={f.path} hover>
                    <TableCell sx={MONO}>{f.path}</TableCell>
                    <TableCell sx={{ width: 90 }}>
                      <KindChip kind={f.kind} />
                    </TableCell>
                    <TableCell sx={{ ...MONO, width: 80, textAlign: "right" }}>{formatBytes(f.size)}</TableCell>
                    <TableCell sx={{ ...MONO, width: 170, color: "text.secondary" }}>
                      {formatWhen(f.mtime)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        ) : null
      )}
    </Stack>
  );
}

/* ── the page ─────────────────────────────────────────────────────────────── */

export default function PluginManagerPage() {
  const version = React.useSyncExternalStore(registry.subscribe, registry.version, () => 0);
  const [mounted, setMounted] = React.useState(false);
  const [settingsTick, setSettingsTick] = React.useState(0);
  const [disk, setDisk] = React.useState<readonly PluginDirReport[]>([]);
  const [diskError, setDiskError] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState(0);
  const [inv, setInv] = React.useState<PluginInventory | null>(null);
  const [invLoading, setInvLoading] = React.useState(false);
  const [invError, setInvError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const managerSettings = useModuleSettings(PLUGIN_MANAGER_ID);
  const confirmUninstall = Boolean(managerSettings.confirmUninstall ?? true);

  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => settings.subscribe(() => setSettingsTick((t) => t + 1)), []);

  const loadDisk = React.useCallback(async () => {
    try {
      const res = await fetch("/api/plugins", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
      const data = (await res.json()) as PluginListResponse;
      setDisk(data.plugins);
      setDiskError(null);
    } catch (e) {
      setDiskError(e instanceof Error ? e.message : "disk report failed");
    }
  }, []);
  React.useEffect(() => {
    void loadDisk();
  }, [loadDisk]);

  const roster = React.useMemo(
    () => (mounted ? deriveRoster(disk) : []),
    // `version` and `settingsTick` ARE the dependencies — the registry and the
    // settings registry fill during an async boot, and this join must recompute
    // when they do (the assistant-window lesson, applied here).
    [mounted, disk, version, settingsTick]
  );
  const points = React.useMemo(() => (mounted ? registry.points() : []), [mounted, version]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(
      (r) =>
        r.id.includes(q) ||
        r.title.toLowerCase().includes(q) ||
        r.summary.toLowerCase().includes(q) ||
        r.livePoints.some((p) => p.includes(q))
    );
  }, [roster, query]);

  const selected = roster.find((r) => r.id === selectedId) ?? null;

  /* inventory fetch for the selected plugin */
  const loadInventory = React.useCallback(async (entry: RosterEntry) => {
    setInvLoading(true);
    setInvError(null);
    try {
      const params = new URLSearchParams();
      if (entry.ns) params.set("ns", entry.ns);
      const qs = params.toString();
      const res = await fetch(`/api/plugins/${entry.id}/inventory${qs ? `?${qs}` : ""}`, {
        cache: "no-store"
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? `HTTP ${res.status}`);
      setInv((await res.json()) as PluginInventory);
    } catch (e) {
      setInv(null);
      setInvError(e instanceof Error ? e.message : "inventory failed");
    } finally {
      setInvLoading(false);
    }
  }, []);

  React.useEffect(() => {
    setInv(null);
    setInvError(null);
    if (selected?.disk) void loadInventory(selected);
  }, [selectedId, selected?.disk ? 1 : 0]); // eslint-disable-line react-hooks/exhaustive-deps

  /* the commands' window events */
  React.useEffect(() => {
    const onEvent = (e: Event) => {
      const verb = (e as CustomEvent<{ verb?: string }>).detail?.verb;
      if (verb === "refresh") void loadDisk();
      if (verb === "import") fileInput.current?.click();
    };
    window.addEventListener(PLUGIN_MANAGER_EVENT, onEvent);
    return () => window.removeEventListener(PLUGIN_MANAGER_EVENT, onEvent);
  }, [loadDisk]);

  /* import flow */
  const doImport = React.useCallback(
    async (file: File, overwrite: boolean) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/plugins/import${overwrite ? "?overwrite=1" : ""}`, {
          method: "POST",
          headers: { "content-type": "application/zip" },
          body: file
        });
        const body = await res.json();
        if (res.status === 409 && !overwrite) {
          if (window.confirm(`${body.error}\n\nReplace it? The existing directory is archived first.`)) {
            await doImport(file, true);
          }
          return;
        }
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        const result = body as ImportResult;
        setNotice(
          `Imported "${result.id}" v${result.version} (${result.files} files). ` +
            `Registers at the next compile.` +
            (result.warnings.length ? ` — ${result.warnings.join(" · ")}` : "")
        );
        await loadDisk();
      } catch (e) {
        setNotice(`Import failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(false);
      }
    },
    [loadDisk]
  );

  const doUninstall = React.useCallback(
    async (entry: RosterEntry) => {
      if (
        confirmUninstall &&
        !window.confirm(
          `Uninstall "${entry.id}"? Its source directory is archived under assets/archive/plugin/, ` +
            `its ledger entry is removed, and it deregisters at the next compile.`
        )
      ) {
        return;
      }
      setBusy(true);
      try {
        const res = await fetch(`/api/plugins/${entry.id}`, { method: "DELETE" });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setNotice(
          `Uninstalled "${entry.id}"` + (body.archivedTo ? ` — archived to ${body.archivedTo}` : "")
        );
        setSelectedId(null);
        await loadDisk();
      } catch (e) {
        setNotice(`Uninstall failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(false);
      }
    },
    [confirmUninstall, loadDisk]
  );

  const doImportedFlip = React.useCallback(
    async (entry: RosterEntry, enabled: boolean) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/plugins/${entry.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled })
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setNotice(`"${entry.id}" ${enabled ? "enabled" : "disabled"} — applies at the next compile.`);
        await loadDisk();
      } catch (e) {
        setNotice(`Flip failed: ${e instanceof Error ? e.message : e}`);
      } finally {
        setBusy(false);
      }
    },
    [loadDisk]
  );

  const report = registry.report();

  if (!mounted) return null;

  return (
    <Box data-axf-area="plugin-manager.surface" sx={{ p: { xs: 2, md: 3 }, maxWidth: 1440, mx: "auto" }}>
      {/* header */}
      <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: "flex-start", flexWrap: "wrap" }} useFlexGap>
        <Box sx={{ width: 40, height: 40, flexShrink: 0 }}>
          <Glyph id="icon-layers" />
        </Box>
        <Box sx={{ flexGrow: 1, minWidth: 260 }}>
          <Typography variant="h5">Plugin Manager</Typography>
          <Typography variant="body2" color="text.secondary">
            {roster.length} plugins · {report.points} points · {report.contributions} contributions
            {report.violations.length ? ` · ${report.violations.length} violations` : ""}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <TextField
            size="small"
            placeholder="Search id, title, point…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button size="small" variant="outlined" onClick={() => void loadDisk()}>
            Refresh
          </Button>
          <Button
            size="small"
            variant="contained"
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            Import package…
          </Button>
          {/* The picker is never seen — the Button above it is the control.
              `Box component="input"` rather than a raw <input>, the same shape
              ProfilePane, the amberxvid gallery and the expenses vault use for
              theirs: check:ui's rule is that where an MUI component exists it
              is used, and a hidden field is not an exception to it. */}
          <Box
            component="input"
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            sx={{ display: "none" }}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0];
              // Clearing the input lets the same file be picked twice — a
              // browser fires no change event for an unchanged value.
              e.target.value = "";
              if (f) void doImport(f, false);
            }}
          />
        </Stack>
      </Stack>

      {diskError ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          The disk report failed ({diskError}) — showing the live registry alone.
        </Alert>
      ) : null}

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
        {/* roster list */}
        <Paper variant="outlined" sx={{ width: { xs: "100%", md: 380 }, flexShrink: 0 }}>
          <Stack divider={<Divider />}>
            {filtered.map((r) => (
              <Box
                key={r.id}
                data-axf-area="plugin-manager.entry"
                data-axf-plugin={r.id}
                data-axf-settings-owner={r.settingsOwner ?? ""}
                data-axf-enabled-key={r.enabledKey ?? ""}
                onClick={() => setSelectedId(r.id)}
                sx={{
                  p: 1.25,
                  cursor: "pointer",
                  bgcolor: r.id === selectedId ? "action.selected" : undefined,
                  "&:hover": { bgcolor: "action.hover" }
                }}
              >
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                    {r.title}
                  </Typography>
                  {r.settingsOwner && r.enabledKey ? (
                    <OwnStoreSwitch owner={r.settingsOwner} enabledKey={r.enabledKey} />
                  ) : null}
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                  <Box component="span" sx={MONO}>
                    {r.id}
                  </Box>
                  {" · "}
                  {r.target}
                  {r.disk?.imported ? " · imported" : ""}
                  {r.livePoints.length === 0 ? " · inactive" : ` · ${r.livePoints.length} point(s)`}
                </Typography>
              </Box>
            ))}
            {filtered.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                Nothing matches “{query}”.
              </Typography>
            ) : null}
          </Stack>
        </Paper>

        {/* detail */}
        <Paper variant="outlined" sx={{ flexGrow: 1, minWidth: 0, width: "100%" }}>
          {selected ? (
            <Box
              data-axf-area="plugin-manager.entry"
              data-axf-plugin={selected.id}
              data-axf-settings-owner={selected.settingsOwner ?? ""}
              data-axf-enabled-key={selected.enabledKey ?? ""}
            >
              <Box sx={{ px: 2, pt: 1.5 }}>
                <Typography variant="h6">{selected.title}</Typography>
                <Tabs value={tab} onChange={(_e, v) => setTab(v)} sx={{ minHeight: 36 }}>
                  <Tab label="Overview" sx={{ minHeight: 36 }} />
                  <Tab label="Settings" sx={{ minHeight: 36 }} />
                  <Tab label="Docs" sx={{ minHeight: 36 }} />
                  <Tab label="Files" sx={{ minHeight: 36 }} />
                </Tabs>
              </Box>
              <Divider />
              <Box sx={{ p: 2 }}>
                {tab === 0 ? (
                  <OverviewTab
                    entry={selected}
                    points={points}
                    busy={busy}
                    onExport={() =>
                      window.location.assign(`/api/plugins/${encodeURIComponent(selected.id)}/export`)
                    }
                    onUninstall={() => void doUninstall(selected)}
                    onImportedFlip={(enabled) => void doImportedFlip(selected, enabled)}
                  />
                ) : null}
                {tab === 1 ? <SettingsTab entry={selected} /> : null}
                {tab === 2 ? <DocsTab entry={selected} inventory={inv} /> : null}
                {tab === 3 ? (
                  selected.disk ? (
                    <FilesTab
                      inventory={inv}
                      loading={invLoading}
                      error={invError}
                      onRefresh={() => void loadInventory(selected)}
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      No directory on disk — this plugin is registered but its files are not under
                      `src/plugins/{selected.id}/`.
                    </Typography>
                  )
                ) : null}
              </Box>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ p: 3 }}>
              Select a plugin. Right-click a row for its menu; the switch beside a row flips the
              plugin through its own settings store.
            </Typography>
          )}
        </Paper>
      </Stack>

      <Snackbar
        open={notice !== null}
        autoHideDuration={8000}
        onClose={() => setNotice(null)}
        message={notice ?? ""}
      />
    </Box>
  );
}

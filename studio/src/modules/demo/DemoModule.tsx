/**
 * @file The Core Inspector screen.
 *
 * Every value here is read from the live kernel and registry at render time.
 * Nothing is authored, nothing is mocked, nothing is a hardcoded example — so
 * a capability that is broken shows as broken. That is what makes this a tool
 * for building the core rather than a demo of it.
 *
 * ── RESTORED IN P2, AND WHAT CAME BACK IS SMALLER (2026-08-10) ───────────────
 *
 * The v0.3.0 P0 "strip to the frame" run archived and deleted this module. P2
 * restores it — on MUI, per the owner's standing instruction — because it is
 * not only a screen: it is the framework's ONLY registered module, and three of
 * P2's own gates need one to exist at all.
 *
 *   - `npm run peel` takes a module id and reads `src/modules/<id>/`. With
 *     `src/modules/` empty the peel gate cannot run, so "peel still works after
 *     the MUI rebuild" was unprovable rather than proven.
 *   - `ModuleHost` and `Slot` have no subject without a hosted module, and
 *     both were rebuilt on MUI this phase.
 *   - The crash-isolation mutation needs a module screen to throw from and a
 *     plugin contribution to throw from, so that "module failed" and "plugin
 *     failed" can be told apart.
 *
 * Two panes did NOT come back, deliberately: `ThemePanes` (the roller) and
 * `StylePanes` (the pack hot-swap). Both survived the strip as first-class
 * surfaces of their own — the `theme-designer` plugin and the `brand-gallery`
 * plugin — and restoring them here would be two screens for one job, which is
 * how a surface starts drifting from the one people actually use. What is
 * restored is the inspector proper: the kernel, the registry, the declared
 * points, the peel closure, the capabilities and the published variables.
 *
 * ── MUI ─────────────────────────────────────────────────────────────────────
 *
 * `Card`/`CardHeader`-shaped panels via `Paper`, `Stack` for the bands,
 * `Typography` for text, `Divider` between rows, `Chip` for the contributed
 * badge. Colours still come from `token()` (`var(--axf-*)`) rather than from
 * MUI's palette, for the reason the whole engine exists: those are the values
 * a theme roll republishes, so this screen repaints without re-rendering.
 */
"use client";

import * as React from "react";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import {
  AXF_CAPABILITIES,
  AXF_CORE_VERSION,
  kernel,
  packs,
  registry,
  Slot,
  theme as themeStore,
  themeVariables,
  token,
  useDashboards,
  useHost,
  useModuleSettings,
  useNavMenus,
  useTheme,
  useToolbars
} from "@axf/core";

import type { BadgePayload, NotePayload } from "../../plugins/demo-badge/plugin";

/* ------------------------------------------------------------------ atoms */

/** Mono, at the inspector's reading size. Shared so the rows line up. */
const mono = { fontFamily: token("mono"), fontSize: 12.5 } as const;

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  // Long cards scroll inside themselves rather than stretching the row: the
  // grid places cards side by side, and one 40-row card used to set the
  // height of the whole band. The cap keeps every card glanceable; the body
  // scrolls for the rest.
  return (
    <Paper
      component="section"
      elevation={0}
      sx={{
        background: token("panel"),
        border: `1px solid ${token("edge")}`,
        borderRadius: token("radius"),
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        maxHeight: 420
      }}
    >
      <Typography
        component="h2"
        sx={{
          fontFamily: token("mono"),
          fontSize: 11,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: token("dim"),
          margin: "0 0 10px",
          flexShrink: 0
        }}
      >
        {title}
      </Typography>
      <Box sx={{ overflowY: "auto", minHeight: 0 }}>{children}</Box>
    </Paper>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Divider sx={{ borderColor: token("edge") }} />
      <Box sx={{ display: "flex", gap: "10px", padding: "6px 0", alignItems: "baseline" }}>
        {children}
      </Box>
    </>
  );
}

/** Mono text that is a VALUE rather than prose — an id, a count, a token. */
function Mono({ children, tone, size }: { children: React.ReactNode; tone?: string; size?: number }) {
  return (
    <Typography
      component="code"
      sx={{ ...mono, ...(size ? { fontSize: size } : null), ...(tone ? { color: token(tone) } : null) }}
    >
      {children}
    </Typography>
  );
}

/** Pushes what follows to the far edge of a row. */
const Spacer = () => <Box sx={{ flex: 1 }} />;

const STATE_TONE: Record<string, string> = {
  started: "ok",
  pending: "dim",
  failed: "err",
  blocked: "warn"
};

/* ------------------------------------------------------------------ screen */

export default function DemoModule() {
  const { module } = useHost();
  // Module settings (core 0.0.20): the inspector's one row. Live, so the
  // shell dialog's switch folds the card away without a reload.
  const showCapabilities = useModuleSettings("demo").showCapabilities !== false;
  const themeState = useTheme();
  /**
   * The four SIBLING registries.
   *
   * These are hooks rather than part of the mount-effect snapshot below,
   * because unlike the kernel and the module registry these change while the
   * page is open — a banner swap, a nav swap or a pack selection all re-render
   * this card the moment they happen, which is the only honest way for an
   * inspector to report a live registry.
   */
  const toolbarSnap = useToolbars();
  const navSnap = useNavMenus();
  const dashSnap = useDashboards();
  /** The `dashboard` chrome dial — what the picker below reads and writes. */
  const dashDial = String(themeState.values.dashboard ?? "");
  // What CSS actually receives, derived from the live theme — so a dial that
  // fails to publish shows as absent here rather than as a surface that quietly
  // kept its old value.
  const publishedVars = React.useMemo(
    () => themeVariables(themeState.values),
    [themeState.values]
  );

  // The kernel and registry are mutated during boot, which happens before the
  // first paint. Reading them in state on mount (rather than during render)
  // keeps this honest under React's double-invoked development render.
  const [snapshot, setSnapshot] = React.useState<{
    statuses: ReturnType<typeof kernel.statuses>;
    report: ReturnType<typeof registry.report>;
    modules: ReturnType<typeof registry.modules>;
    points: ReturnType<typeof registry.points>;
    closure: ReturnType<typeof registry.closureOf>;
    /** The pack registry exports no hook, so it is read here with the rest. */
    packs: ReturnType<typeof packs.packs>;
  } | null>(null);

  React.useEffect(() => {
    setSnapshot({
      statuses: kernel.statuses(),
      report: registry.report(),
      modules: registry.modules(),
      points: registry.points(),
      closure: registry.closureOf(module.id),
      packs: packs.packs()
    });
  }, [module.id]);

  return (
    // The area id the decl's `menus` declares — marking it is the screen's
    // whole part in the contract; the rows themselves live on the decl.
    <Box
      component="main"
      data-axf-area="demo.inspector"
      sx={{ padding: "22px 26px", display: "grid", gap: "16px", maxWidth: 1180 }}
    >
      <Stack direction="row" useFlexGap sx={{ alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <Box
          sx={{
            width: 10,
            height: 10,
            borderRadius: "3px",
            background: token("accent"),
            boxShadow: `0 0 12px ${token("accent")}`
          }}
        />
        <Typography component="h1" sx={{ fontSize: 19, fontWeight: 700, margin: 0 }}>
          {module.title}
        </Typography>
        <Mono tone="dim">@axf/core {AXF_CORE_VERSION}</Mono>
        <Spacer />
        {/* Contributed through the host's slot — this module imports nothing
            from the plugin that supplies these. */}
        <Slot
          point="demo.badge"
          render={(payload: BadgePayload, from) => (
            <Chip
              size="small"
              variant="outlined"
              label={payload.label}
              title={`contributed by ${from}`}
              sx={{
                ...mono,
                fontSize: 11,
                height: "auto",
                padding: "3px 3px",
                borderRadius: "999px",
                color: token(payload.tone),
                borderColor: token(payload.tone)
              }}
            />
          )}
        >
          <Mono tone="dim" size={11}>
            no badges contributed
          </Mono>
        </Slot>
      </Stack>

      <Typography sx={{ margin: 0, color: token("dim"), maxWidth: 760, lineHeight: 1.55 }}>
        {module.summary}
      </Typography>

      <Box
        sx={{
          display: "grid",
          gap: "16px",
          gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))"
        }}
      >
        <Card title="Kernel · subsystems">
          {!snapshot ? (
            <Mono tone="dim">reading…</Mono>
          ) : snapshot.statuses.length === 0 ? (
            <Mono tone="err">nothing registered — the kernel booted empty</Mono>
          ) : (
            snapshot.statuses.map((s) => (
              <Row key={s.id}>
                <Mono tone={STATE_TONE[s.state]}>{s.state}</Mono>
                <Mono>{s.id}</Mono>
                <Mono tone="dim" size={11}>
                  {s.layer}
                  {s.startedInMs !== undefined ? ` · ${s.startedInMs}ms` : ""}
                </Mono>
                <Spacer />
                {s.error ? <Mono tone="err">{s.error}</Mono> : null}
                {s.blockedBy ? <Mono tone="warn">needs {s.blockedBy.join(", ")}</Mono> : null}
              </Row>
            ))
          )}
        </Card>

        <Card title="Registry · modules, points, contributions">
          {snapshot ? (
            <>
              {/* Named in the title and stated here, because "Registry" alone
                  read as "everything registered" — and the banner and the nav
                  are registered assets this registry has never held. They live
                  in four sibling registries; the next card is them. */}
              <Typography
                sx={{ margin: "0 0 8px", color: token("dim"), fontSize: 11.5, lineHeight: 1.5 }}
              >
                Modules and the extension-point graph only. Toolbars, navs, dashboards and packs
                each keep their own registry — see below.
              </Typography>
              <Row>
                <Mono>modules</Mono>
                <Spacer />
                <Mono tone="accent">{snapshot.report.modules}</Mono>
              </Row>
              <Row>
                <Mono>extension points</Mono>
                <Spacer />
                <Mono tone="accent">{snapshot.report.points}</Mono>
              </Row>
              <Row>
                <Mono>contributions</Mono>
                <Spacer />
                <Mono tone="accent">{snapshot.report.contributions}</Mono>
              </Row>
              <Row>
                <Mono>violations</Mono>
                <Spacer />
                <Mono tone={snapshot.report.violations.length ? "err" : "ok"}>
                  {snapshot.report.violations.length}
                </Mono>
              </Row>
              {snapshot.report.violations.map((v, i) => (
                <Row key={i}>
                  <Mono tone="err" size={11}>
                    {v.from} → {v.point}: {v.problem}
                  </Mono>
                </Row>
              ))}
            </>
          ) : (
            <Mono tone="dim">reading…</Mono>
          )}
        </Card>

        <Card title="Asset registries · toolbars, navs, dashboards, packs">
          <Typography
            sx={{ margin: "0 0 8px", color: token("dim"), fontSize: 11.5, lineHeight: 1.5 }}
          >
            Four registries the card above cannot see. Each is its own singleton with its own
            subscribe/snapshot, which is why a banner is a registered asset and still never appeared
            in a &ldquo;Registry&rdquo; count. Live: a swap here re-renders this card.
          </Typography>

          {/* One row per registry: how many are registered, and which is live.
              `active` is a Map<surface, asset> — a registry can hold several
              candidates for one surface and exactly one of them is mounted. */}
          <Row>
            <Mono>toolbars</Mono>
            <Mono tone="dim" size={11}>
              {[...toolbarSnap.active].map(([s, t]) => `${s}=${t.id}`).join(" · ") || "none active"}
            </Mono>
            <Spacer />
            <Mono tone="accent">{toolbarSnap.all.length}</Mono>
          </Row>
          <Row>
            <Mono>navs</Mono>
            <Mono tone="dim" size={11}>
              {[...navSnap.active].map(([s, m]) => `${s}=${m.id}`).join(" · ") || "none active"}
            </Mono>
            <Spacer />
            <Mono tone="accent">{navSnap.all.length}</Mono>
          </Row>
          <Row>
            <Mono>dashboards</Mono>
            <Mono tone="dim" size={11}>
              {dashSnap.resolution.dashboard?.id ?? "none resolved"}
              {/* A stored id that stopped resolving falls back AND says so —
                  reporting the substitution is the whole point of the field,
                  and swallowing it here would hide a stale preference. */}
              {dashSnap.resolution.substituted
                ? ` · substituted for "${dashSnap.resolution.requestedId ?? "?"}"`
                : ""}
            </Mono>
            <Spacer />
            <Mono tone="accent">{dashSnap.all.length}</Mono>
          </Row>
          {/* The dashboard is the ONE asset registry this screen can also
              WRITE to, and it earns that on the owner's instruction ("in core
              inspector allow selecting dashboard"). It is a plain dial edit —
              `theme.setValue("dashboard", id)` — so it goes through the same
              chokepoint the designer's picker does and lands in the same
              override count. This screen holds no preview, so the store's own
              rule applies unchanged: selecting applies, and applying saves. */}
          <Row>
            <Mono>selected</Mono>
            <Box sx={{ flex: 1, maxWidth: 340 }}>
              <Tooltip title="Which registered wrapper the THEME asks for. Empty falls through to the registry default. This is the `dashboard` chrome dial — the same value the designer's Dashboard tab writes.">
                <TextField
                  select
                  size="small"
                  fullWidth
                  label="Dashboard wrapper"
                  value={dashDial}
                  onChange={(e) => themeStore.setValue("dashboard", e.target.value)}
                  slotProps={{
                    htmlInput: { "data-axf-dashboard-select": "" },
                    // `displayEmpty`, because "" is a REAL choice here — it
                    // means "whatever the registry's floor is". Without it MUI
                    // renders a zero-width space for an empty value and ignores
                    // the matching MenuItem, so the default reads as a blank
                    // control rather than as the default. Observed live.
                    select: { displayEmpty: true }
                  }}
                  sx={{ "& .MuiSelect-select": { ...mono } }}
                >
                  <MenuItem value="" sx={mono}>
                    (app default{dashSnap.all[0] ? ` — ${dashSnap.all[0].id}` : ""})
                  </MenuItem>
                  {dashSnap.all.map((d) => (
                    <MenuItem key={d.id} value={d.id} sx={mono}>
                      {d.id}
                    </MenuItem>
                  ))}
                </TextField>
              </Tooltip>
            </Box>
          </Row>

          <Row>
            <Mono>packs</Mono>
            <Mono tone="dim" size={11}>
              {snapshot
                ? Object.entries(
                    snapshot.packs.reduce<Record<string, number>>((acc, p) => {
                      acc[p.type] = (acc[p.type] ?? 0) + 1;
                      return acc;
                    }, {})
                  )
                    .map(([kind, n]) => `${kind}×${n}`)
                    .join(" · ") || "none"
                : "reading…"}
            </Mono>
            <Spacer />
            <Mono tone="accent">{snapshot?.packs.length ?? "…"}</Mono>
          </Row>

          {/* The assets themselves, so "registered" is a list rather than a
              number — the same standard the points card is held to. */}
          {[...toolbarSnap.all.map((t) => ({ kind: "toolbar", id: t.id, extra: t.role })),
            ...navSnap.all.map((m) => ({ kind: "nav", id: m.id, extra: m.surface })),
            ...dashSnap.all.map((d) => ({ kind: "dashboard", id: d.id, extra: "" }))].map((a) => (
            <Row key={`${a.kind}:${a.id}`}>
              <Mono tone="dim" size={11}>
                {a.kind}
              </Mono>
              <Mono>{a.id}</Mono>
              <Spacer />
              {a.extra ? (
                <Mono tone="dim" size={11}>
                  {a.extra}
                </Mono>
              ) : null}
            </Row>
          ))}
        </Card>

        <Card title="Declared extension points">
          {snapshot?.points.length ? (
            snapshot.points.map((p) => (
              <Row key={p.id}>
                <Box sx={{ display: "grid", gap: "3px" }}>
                  <Mono tone="accent">{p.id}</Mono>
                  <Typography sx={{ color: token("dim"), fontSize: 11.5, lineHeight: 1.45 }}>
                    {p.description}
                  </Typography>
                  <Mono tone="dim" size={11}>
                    {p.kind} · {p.cardinality}
                    {p.requires ? ` · requires ${p.requires.join(", ")}` : ""}
                    {" · "}
                    {registry.contributionsTo(p.id).length} contributed
                  </Mono>
                </Box>
              </Row>
            ))
          ) : (
            <Mono tone="dim">none declared</Mono>
          )}
        </Card>

        <Card title={`Peel closure · ${module.id}`}>
          <Typography
            sx={{ margin: "0 0 8px", color: token("dim"), fontSize: 11.5, lineHeight: 1.5 }}
          >
            What this module would carry if peeled — computed from its declared points, not from a
            hand-kept list. This is the question GizmoX cannot answer.
          </Typography>
          {snapshot?.closure ? (
            <>
              <Row>
                <Mono>points</Mono>
                <Spacer />
                <Mono tone="accent">{snapshot.closure.points.join(", ") || "—"}</Mono>
              </Row>
              <Row>
                <Mono>carries</Mono>
                <Spacer />
                <Mono tone="accent">{snapshot.closure.carries.join(", ") || "—"}</Mono>
              </Row>
            </>
          ) : (
            <Mono tone="dim">reading…</Mono>
          )}
        </Card>

        {showCapabilities && (
        <Card title="Core capabilities · and what justified each">
          {AXF_CAPABILITIES.map((c) => (
            <Row key={c.id}>
              <Box sx={{ display: "grid", gap: "3px" }}>
                <Mono tone="accent">
                  {c.id}{" "}
                  <Box component="span" sx={{ color: token("dim") }}>
                    since {c.since}
                  </Box>
                </Mono>
                <Typography sx={{ color: token("dim"), fontSize: 11.5, lineHeight: 1.45 }}>
                  {c.because}
                </Typography>
              </Box>
            </Row>
          ))}
        </Card>
        )}

        <Card title="Published variables · what CSS actually receives">
          {Object.entries(publishedVars).map(([key, value]) => (
            <Row key={key}>
              <Box
                sx={{
                  width: 14,
                  height: 14,
                  borderRadius: "3px",
                  border: `1px solid ${token("edge")}`,
                  // The swatch shows the value ITSELF, which is why this one
                  // colour is not a token: it is the published variable being
                  // reported on, and painting it from the theme instead would
                  // make every row agree with itself by construction.
                  background: value.startsWith("#") ? value : "transparent",
                  flexShrink: 0
                }}
              />
              <Mono>{key}</Mono>
              <Spacer />
              <Typography
                component="code"
                sx={{
                  ...mono,
                  color: token("dim"),
                  fontSize: 11,
                  maxWidth: 210,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap"
                }}
              >
                {value}
              </Typography>
            </Row>
          ))}
        </Card>
      </Box>

      <Card title="Contributed notes">
        <Slot
          point="demo.note"
          render={(payload: NotePayload, from) => (
            <Row>
              <Mono tone="accent" size={11}>
                {from}
              </Mono>
              <Typography sx={{ lineHeight: 1.5 }}>{payload.text}</Typography>
            </Row>
          )}
        >
          <Mono tone="dim">nothing contributed to demo.note</Mono>
        </Slot>
      </Card>
    </Box>
  );
}

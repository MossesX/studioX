/**
 * @file `/docs` — the interactive project documentation.
 *
 * ## What this is, and why it exists as a screen rather than a markdown file
 *
 * The project's memory lives in three places that each rot differently:
 * `PLANNING-STATE.md` (2,470 append-ordered lines, oldest first, where the
 * current truth is at the FOOT and everything above it may or may not be
 * superseded), `issues.md` (the fix list), and roughly 130 session transcripts
 * nobody can read. A new session's first cost has been re-deriving what
 * already exists, and the `.newx.` prompt was built specifically to stop that.
 *
 * This surface is the same job done for a HUMAN: what was supposed to be
 * built, what was built, what was cancelled and WHY, and what is still open —
 * each entry linked to the screen it describes, so reading about the theme
 * engine is one click from turning its dials.
 *
 * Three editorial rules, all from the brief:
 *
 *   1. **No stale information.** A renamed or reversed decision is recorded at
 *      its current truth, not struck through.
 *   2. **Cancelled work is the exception, and it stays WITH ITS REASON.** A
 *      cancelled decision that gets deleted gets re-proposed — style packs were
 *      proposed, cancelled, revived and cancelled again inside one day.
 *   3. **The chains show the MECHANISM.** Not a box per file, but what is
 *      handed to what, and what dynamic data gets picked up along the way.
 *
 * ## What it deliberately is NOT
 *
 * It is not the documentation ENGINE (`INITIATION-PROMPT.md` §6, still
 * unbuilt), and it does not pretend to be: nothing generates it, it is
 * authored data in `docs.data.ts` beside this file. It is also not a registered
 * module — it is a route and a plugin, for the same reason `/brand`,
 * `/settings` and `/theme-designer` are: it documents this install rather than
 * shipping with a peeled app, and the module cap exists so that "should this be
 * a module?" is answered NO by default.
 *
 * Chrome — style root, MUI provider, banner, nav, dashboard wrapper — is all
 * `StudioShell`'s. This renders content only.
 */
"use client";

import * as React from "react";

import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph } from "@axf/core";

import { CHAIN_DIAGRAMS } from "./Diagrams";
import {
  CHAINS,
  FEATURES,
  SPEND,
  TIMELINE,
  TUTORIALS
} from "./docs.data";
import type { Area, Feature, FeatureStatus } from "./docs.data";

/* ───────────────────────────────────────────────────────── small pieces ─── */

const STATUS_META: Record<FeatureStatus, { label: string; colour: "success" | "warning" | "error" | "info" | "default"; blurb: string }> = {
  built: { label: "built", colour: "success", blurb: "on disk, running, verified" },
  pending: { label: "pending", colour: "warning", blurb: "wanted, nothing on disk" },
  cancelled: { label: "cancelled", colour: "error", blurb: "deliberately ended — the row says why" },
  removed: { label: "removed", colour: "error", blurb: "built, then deleted by a later decision" },
  superseded: { label: "superseded", colour: "info", blurb: "replaced by something doing the same job" }
};

const AREA_LABEL: Record<Area, string> = {
  framework: "Framework",
  theme: "Theme engine",
  brand: "Branding & assets",
  chrome: "Shell & chrome",
  modules: "Modules",
  build: "Build system",
  sdk: "SDK",
  process: "Process & rules"
};

function StatusChip({ status, size = "small" }: { status: FeatureStatus; size?: "small" | "medium" }) {
  const m = STATUS_META[status];
  return (
    <Tooltip title={m.blurb}>
      <Chip size={size} label={m.label} color={m.colour} variant={status === "built" ? "filled" : "outlined"} />
    </Tooltip>
  );
}

/** A repo path. Monospace, dim, and never a link — these are not routes. */
function Path({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="code"
      sx={{
        fontFamily: "var(--axf-font-mono, monospace)",
        fontSize: "0.78rem",
        color: "text.secondary",
        wordBreak: "break-all"
      }}
    >
      {children}
    </Box>
  );
}

/** A link that lands on the real screen. The whole point of the page. */
function OpenLink({ route, label }: { route: string; label?: string }) {
  return (
    <Button
      size="small"
      variant="outlined"
      href={route}
      startIcon={<Box sx={{ width: 14, height: 14 }}><Glyph id="icon-play" /></Box>}
      sx={{ textTransform: "none" }}
    >
      {label ?? route}
    </Button>
  );
}

function Code({ children }: { children: string }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        mt: 1,
        p: 1.5,
        overflowX: "auto",
        borderRadius: 1,
        bgcolor: "action.hover",
        border: 1,
        borderColor: "divider",
        fontFamily: "var(--axf-font-mono, monospace)",
        fontSize: "0.76rem",
        lineHeight: 1.6
      }}
    >
      {children}
    </Box>
  );
}

/** The owner's words. Kept verbatim, including the typing — a paraphrase of a
 *  directive is how a directive drifts. */
function Quote({ children }: { children: string }) {
  return (
    <Box
      sx={{
        mt: 1.5,
        pl: 1.5,
        borderLeft: 3,
        borderColor: "primary.main",
        color: "text.secondary",
        fontStyle: "italic",
        fontSize: "0.85rem"
      }}
    >
      “{children}”
    </Box>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, height: "100%" }}>
      <Stack direction="row" sx={{ mb: 1, alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="subtitle2" sx={{ letterSpacing: 0.4, textTransform: "uppercase", color: "text.secondary" }}>
          {title}
        </Typography>
        {action}
      </Stack>
      {children}
    </Paper>
  );
}

/** Responsive grid without reaching for a layout library. `Box` + `sx` is an
 *  MUI surface, so `check:ui`'s chrome rule is satisfied by construction. */
function Cards({ min = 320, children }: { min?: number; children: React.ReactNode }) {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: { xs: "1fr", md: `repeat(auto-fit, minmax(${min}px, 1fr))` }
      }}
    >
      {children}
    </Box>
  );
}

/* ═════════════════════════════════════════════════════════════ overview ═══ */

function OverviewTab() {
  const count = (s: FeatureStatus) => FEATURES.filter((f) => f.status === s).length;
  const total = SPEND.reduce((n, s) => n + s.usd, 0);

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined" icon={<Box sx={{ width: 18, height: 18 }}><Glyph id="icon-book" /></Box>}>
        <AlertTitle>What AmberX AI Studio is</AlertTitle>
        An <strong>SDK built on a framework being written at the same time</strong>. Modules are
        developed inside the Studio and then <strong>peeled</strong> into standalone applications
        that inherit the environment, the theme engine, the asset engine and (eventually) auth. The
        framework is <Path>@axf/core</Path>; the SDK is <Path>@axs/studio</Path>, the app you are
        reading this in. They are two packages with no path alias between them, so a core→SDK import
        does not fail a review — it fails to resolve.
        <Quote>
          im just hoping you know what you are doing and we have everything decided to protect me
          before we start building. thats why i wasted thousands of dollars building gizmox by the
          seat of my pants its all polluted and bloated and modules cross contaminate each other with bugs
        </Quote>
      </Alert>

      <Cards min={200}>
        {(["built", "pending", "cancelled", "removed", "superseded"] as const).map((s) => (
          <Paper key={s} variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h3" sx={{ fontWeight: 700, lineHeight: 1 }}>
              {count(s)}
            </Typography>
            <Box sx={{ mt: 1 }}>
              <StatusChip status={s} />
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
              {STATUS_META[s].blurb}
            </Typography>
          </Paper>
        ))}
      </Cards>

      <Cards>
        <Section title="Where things stand · 2026-08-12">
          <Stack spacing={1.2}>
            <Typography variant="body2">
              Everything runs from <Path>packages/</Path> at the root. The <Path>pre-build/</Path>{" "}
              scaffold is <strong>gone</strong> — the port ran on 2026-08-11, and a{" "}
              <Path>pre-build/</Path> directory reappearing is now the thing that means something
              went wrong.
            </Typography>
            <Typography variant="body2">
              <strong>MUI is the rule in both packages</strong> and the theme engine drives it.{" "}
              <Path>@mui/icons-material</Path> is permanently excluded — icons resolve through the
              branding pack so they recolour with the theme.
            </Typography>
            <Typography variant="body2">
              <strong>5 of the suite&rsquo;s 12 module slots</strong> are used: buildmgr, dashboard,
              demo, expenses, taskman.
            </Typography>
            <Typography variant="body2">
              <strong>Style packages no longer exist</strong> and the branding pack is a fixed app
              setting. The theme owns every <Path>--axf-*</Path> value, without exception — which is
              what finally made a roll always visibly restyle the app.
            </Typography>
          </Stack>
        </Section>

        <Section title="The three things that actually protect this project">
          <Stack spacing={1.2}>
            <Typography variant="body2">
              <strong>1 · The two packages.</strong> The engine and the app physically cannot import
              each other. Not “shouldn&rsquo;t” — <em>cannot</em>.
            </Typography>
            <Typography variant="body2">
              <strong>2 · The peel test.</strong> One module, one plugin installed on it, peeled,
              booted, asserted to render. If that is green the whole model works. If it is not,
              nothing else is trustworthy.
            </Typography>
            <Typography variant="body2">
              <strong>3 · Gates, not documents.</strong> Every rule is a test that goes red. A rule
              written as a sentence in markdown is a suggestion. Several gates run the real
              chokepoints and watch their own mutations go red on <em>every</em> run — a guard nobody
              has watched fail is a guard nobody has tested.
            </Typography>
          </Stack>
        </Section>

        <Section title="Recorded build spend" action={<Chip size="small" label={`$${total.toFixed(2)}`} />}>
          <TableContainer sx={{ overflowX: "auto" }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>project</TableCell>
                  <TableCell align="right">usd</TableCell>
                  <TableCell>note</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {SPEND.map((s) => (
                  <TableRow key={s.project}>
                    <TableCell><Path>{s.project}</Path></TableCell>
                    <TableCell align="right">{s.usd ? `$${s.usd.toFixed(2)}` : "—"}</TableCell>
                    <TableCell sx={{ color: "text.secondary", fontSize: "0.78rem" }}>{s.note}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
            Ledger figures only, read from each <Path>.bmpx</Path> manifest. Session work done
            outside a build is not in here, and a <strong>sentinel kill does not bill into the
            ledger at all</strong> — so real spend is higher than this by exactly the amount that is
            hardest to see.
          </Typography>
        </Section>

        <Section title="Rules still in force">
          <Stack spacing={1}>
            {[
              ["No hand-rolled UI", "If an MUI component exists, it is used — including assets. Enforced by check:ui, which discovers files on disk."],
              ["Contract ids only", "A surface names `icon-grid`, never `grid`. No alias table, no fallback chain. The packs JSON is what connects an id to a graphic."],
              ["Fix without asking — but prove it", "Do not ask permission to fix a defect. Triple-check it is the right thing, actually required, and demonstrably solves the problem. For a guard: break it on purpose and watch it go red."],
              ["Minimal suis, and minimal is a ceiling", "Only settings a surface cannot work properly without. None of GizmoX's settings contract comes across."],
              ["No documentation output on builds", "No build_log.mdx, no docgen. A new documentation engine is coming; raw build exhaust is a record, not documentation."],
              ["One writer per path", "Sessions run concurrently in this tree. :3200 belongs to whoever started it — attach, never restart."]
            ].map(([t, d]) => (
              <Box key={t}>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>{t}</Typography>
                <Typography variant="body2" color="text.secondary">{d}</Typography>
              </Box>
            ))}
          </Stack>
        </Section>
      </Cards>

      <Section title="Jump to a surface">
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
          {[
            ["/", "Dashboard"],
            ["/demo", "Core Inspector"],
            ["/theme-designer", "Theme Designer"],
            ["/brand", "Brand gallery"],
            ["/settings", "Settings"],
            ["/buildmgr", "Build Manager"],
            ["/taskman", "Task Manager"],
            ["/expenses", "Expense Tracker"],
            ["/status", "Boot status"],
            ["/mui-probe", "MUI probe"]
          ].map(([r, l]) => (
            <OpenLink key={r} route={r} label={l} />
          ))}
        </Stack>
      </Section>
    </Stack>
  );
}

/* ═════════════════════════════════════════════════════════════ features ═══ */

function FeatureRow({ feature }: { feature: Feature }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <TableRow
        hover
        data-axf-area="docs.entry"
        data-axf-entry={feature.id}
        data-axf-route={feature.route ?? ""}
        sx={{ "& > *": { borderBottom: "unset" }, cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
      >
        <TableCell sx={{ width: 34 }}>
          <Box sx={{ width: 14, height: 14, opacity: 0.7 }}>
            <Glyph id={open ? "icon-chevron-up" : "icon-chevron-down"} />
          </Box>
        </TableCell>
        <TableCell>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{feature.title}</Typography>
        </TableCell>
        <TableCell sx={{ whiteSpace: "nowrap" }}>
          <Chip size="small" variant="outlined" label={AREA_LABEL[feature.area]} />
        </TableCell>
        <TableCell><StatusChip status={feature.status} /></TableCell>
        <TableCell sx={{ whiteSpace: "nowrap", color: "text.secondary", fontSize: "0.78rem" }}>
          {feature.on}
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell sx={{ py: 0, borderBottom: open ? undefined : "none" }} colSpan={5}>
          <Collapse in={open} unmountOnExit>
            <Box sx={{ py: 2, pl: { xs: 0, sm: 4 }, pr: 1 }}>
              <Typography variant="body2" sx={{ mb: 1.5 }}>{feature.what}</Typography>

              {feature.why ? (
                <Alert severity={feature.status === "superseded" ? "info" : "warning"} variant="outlined" sx={{ mb: 1.5 }}>
                  <AlertTitle sx={{ fontSize: "0.8rem" }}>
                    {feature.status === "superseded" ? "Replaced because" : "Cancelled because"}
                  </AlertTitle>
                  {feature.why}
                </Alert>
              ) : null}

              {feature.proof?.length ? (
                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="caption" sx={{ textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
                    how it was proven
                  </Typography>
                  <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                    {feature.proof.map((p) => (
                      <Typography key={p} variant="body2" color="text.secondary">· {p}</Typography>
                    ))}
                  </Stack>
                </Box>
              ) : null}

              {feature.where.length ? (
                <Box sx={{ mb: 1.5 }}>
                  <Typography variant="caption" sx={{ textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
                    where
                  </Typography>
                  <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                    {feature.where.map((w) => <Path key={w}>{w}</Path>)}
                  </Stack>
                </Box>
              ) : null}

              {feature.quote ? <Quote>{feature.quote}</Quote> : null}

              {feature.route ? (
                <Box sx={{ mt: 2 }}>
                  <OpenLink route={feature.route} label={`open ${feature.route}`} />
                </Box>
              ) : null}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

function FeaturesTab() {
  const [status, setStatus] = React.useState<FeatureStatus | "all">("all");
  const [area, setArea] = React.useState<Area | "all">("all");

  const rows = FEATURES.filter(
    (f) => (status === "all" || f.status === status) && (area === "all" || f.area === area)
  );

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1.5}>
          <Box>
            <Typography variant="caption" sx={{ textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
              status
            </Typography>
            <Box sx={{ mt: 0.5, overflowX: "auto" }}>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={status}
                onChange={(_e, v) => v && setStatus(v)}
              >
                <ToggleButton value="all" sx={{ textTransform: "none" }}>all · {FEATURES.length}</ToggleButton>
                {(Object.keys(STATUS_META) as FeatureStatus[]).map((s) => (
                  <ToggleButton key={s} value={s} sx={{ textTransform: "none" }}>
                    {STATUS_META[s].label} · {FEATURES.filter((f) => f.status === s).length}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>
          </Box>
          <Box>
            <Typography variant="caption" sx={{ textTransform: "uppercase", letterSpacing: 0.5, color: "text.secondary" }}>
              area
            </Typography>
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mt: 0.5 }}>
              <Chip
                size="small"
                label="all"
                color={area === "all" ? "primary" : "default"}
                variant={area === "all" ? "filled" : "outlined"}
                onClick={() => setArea("all")}
              />
              {(Object.keys(AREA_LABEL) as Area[]).map((a) => (
                <Chip
                  key={a}
                  size="small"
                  label={`${AREA_LABEL[a]} · ${FEATURES.filter((f) => f.area === a).length}`}
                  color={area === a ? "primary" : "default"}
                  variant={area === a ? "filled" : "outlined"}
                  onClick={() => setArea(a)}
                />
              ))}
            </Stack>
          </Box>
        </Stack>
      </Paper>

      <Paper variant="outlined">
        <TableContainer sx={{ overflowX: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell />
                <TableCell>feature</TableCell>
                <TableCell>area</TableCell>
                <TableCell>status</TableCell>
                <TableCell>since</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((f) => <FeatureRow key={f.id} feature={f} />)}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      Nothing matches that combination.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Typography variant="caption" color="text.secondary">
        Click a row to expand it. Right-click one to open the surface it describes, or copy the entry
        and its file paths.
      </Typography>
    </Stack>
  );
}

/* ═══════════════════════════════════════════════════════════════ chains ═══ */

function ChainsTab() {
  const [i, setI] = React.useState(0);
  const chain = CHAINS[i];
  const Diagram = CHAIN_DIAGRAMS[chain.id];

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Tabs value={i} onChange={(_e, v) => setI(v)} variant="scrollable" scrollButtons="auto">
          {CHAINS.map((c) => <Tab key={c.id} label={c.title} sx={{ textTransform: "none" }} />)}
        </Tabs>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h6">{chain.title}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "var(--axf-font-mono, monospace)" }}>
          {chain.subtitle}
        </Typography>
        <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>
          <AlertTitle sx={{ fontSize: "0.8rem" }}>what goes wrong if this chain is wrong</AlertTitle>
          {chain.failureMode}
        </Alert>
        <Box sx={{ mt: 2 }}>{Diagram ? <Diagram /> : null}</Box>
      </Paper>

      <Paper variant="outlined">
        <TableContainer sx={{ overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 30 }}>#</TableCell>
                <TableCell>step</TableCell>
                <TableCell>what happens</TableCell>
                <TableCell>dynamic data picked up here</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {chain.steps.map((s) => (
                <TableRow key={s.n} hover>
                  <TableCell sx={{ verticalAlign: "top", color: "text.secondary" }}>{s.n}</TableCell>
                  <TableCell sx={{ verticalAlign: "top", minWidth: 190 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.title}</Typography>
                    <Path>{s.at}</Path>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "top", minWidth: 320 }}>
                    <Typography variant="body2">{s.does}</Typography>
                  </TableCell>
                  <TableCell sx={{ verticalAlign: "top", minWidth: 220 }}>
                    {s.picksUp ? (
                      <Typography variant="body2" sx={{ color: "warning.main", fontSize: "0.8rem" }}>
                        {s.picksUp}
                      </Typography>
                    ) : (
                      <Typography variant="body2" color="text.disabled">—</Typography>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {chain.gates?.length ? (
        <Section title="what holds this chain honest">
          <Stack spacing={0.75}>
            {chain.gates.map((g) => (
              <Typography key={g} variant="body2" color="text.secondary">· {g}</Typography>
            ))}
          </Stack>
        </Section>
      ) : null}
    </Stack>
  );
}

/* ════════════════════════════════════════════════════════════ tutorials ═══ */

function TutorialsTab() {
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        Each of these ends on something you can run. The <strong>trap</strong> at the top of every
        one is the mistake it exists to stop you making — in every case because somebody already
        made it here.
      </Typography>
      {TUTORIALS.map((t) => (
        <Accordion key={t.id} disableGutters variant="outlined">
          <AccordionSummary
            expandIcon={<Box sx={{ width: 14, height: 14 }}><Glyph id="icon-chevron-down" /></Box>}
          >
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "center" }} useFlexGap>
              <Typography sx={{ fontWeight: 600 }}>{t.title}</Typography>
              <Chip size="small" variant="outlined" label={`${t.minutes} min`} />
              <Typography variant="body2" color="text.secondary">{t.forWhom}</Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Alert severity="warning" variant="outlined" sx={{ mb: 2 }}>
              <AlertTitle sx={{ fontSize: "0.8rem" }}>the trap</AlertTitle>
              {t.trap}
            </Alert>
            <Stack spacing={2}>
              {t.steps.map((s) => (
                <Box key={s.title}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.title}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{s.body}</Typography>
                  {s.code ? <Code>{s.code}</Code> : null}
                </Box>
              ))}
            </Stack>
            {t.route ? (
              <Box sx={{ mt: 2 }}>
                <OpenLink route={t.route} label={`do it at ${t.route}`} />
              </Box>
            ) : null}
          </AccordionDetails>
        </Accordion>
      ))}
    </Stack>
  );
}

/* ════════════════════════════════════════════════════════════ cancelled ═══ */

function CancelledTab() {
  const dead = FEATURES.filter(
    (f) => f.status === "cancelled" || f.status === "removed" || f.status === "superseded"
  );
  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        <AlertTitle>Why this list is kept when everything else stale is deleted</AlertTitle>
        A cancelled decision that gets deleted gets re-proposed. Style packages were proposed,
        cancelled, revived and cancelled again <em>inside one day</em>; the module cap was misread as
        a cap of two; the no-MUI rule was written about one screen and then cited for years&rsquo;
        worth of unrelated work. Each entry below records what it was and the reason it ended, so the
        next reader argues with the reason rather than rediscovering the idea.
      </Alert>

      <Cards min={420}>
        {dead.map((f) => (
          <Paper
            key={f.id}
            variant="outlined"
            sx={{ p: 2 }}
            data-axf-area="docs.entry"
            data-axf-entry={f.id}
            data-axf-route={f.route ?? ""}
          >
            <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", alignItems: "center" }} useFlexGap>
              <StatusChip status={f.status} />
              <Chip size="small" variant="outlined" label={AREA_LABEL[f.area]} />
              <Typography variant="caption" color="text.secondary">{f.on}</Typography>
            </Stack>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{f.title}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>{f.what}</Typography>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" sx={{ textTransform: "uppercase", letterSpacing: 0.5, color: "error.main" }}>
              why
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.5 }}>{f.why}</Typography>
            {f.quote ? <Quote>{f.quote}</Quote> : null}
            {f.where.length ? (
              <Stack spacing={0.25} sx={{ mt: 1.5 }}>
                {f.where.map((w) => <Path key={w}>{w}</Path>)}
              </Stack>
            ) : null}
          </Paper>
        ))}
      </Cards>
    </Stack>
  );
}

/* ═════════════════════════════════════════════════════════════ timeline ═══ */

function TimelineTab() {
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Assembled by reading every session transcript that touched this project from 2026-08-05
        onward — the <Path>amberx-ai-studio</Path> set plus the AmberX-bound sessions in the{" "}
        <Path>GizmoX</Path> set, which is where the builds were driven from. Session counts are the
        transcripts on disk for that day, not the sessions a person would say they had.
      </Typography>
      {TIMELINE.map((d) => (
        <Paper key={d.date} variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", alignItems: "baseline" }} useFlexGap>
            <Typography variant="h6" sx={{ fontFamily: "var(--axf-font-mono, monospace)" }}>{d.date}</Typography>
            <Chip size="small" variant="outlined" label={`${d.sessions} sessions`} />
          </Stack>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mt: 0.5 }}>{d.headline}</Typography>
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {d.what.map((w, i) => (
              <Stack key={i} direction="row" spacing={1}>
                <Box sx={{ width: 12, height: 12, mt: "3px", flexShrink: 0, opacity: 0.6 }}>
                  <Glyph id="icon-bolt" />
                </Box>
                <Typography variant="body2" color="text.secondary">{w}</Typography>
              </Stack>
            ))}
          </Stack>
          {d.quote ? <Quote>{d.quote}</Quote> : null}
        </Paper>
      ))}
    </Stack>
  );
}

/* ════════════════════════════════════════════════════════════════ shell ═══ */

const TABS = [
  { label: "Overview", glyph: "icon-grid", render: () => <OverviewTab /> },
  { label: "Features", glyph: "icon-layers", render: () => <FeaturesTab /> },
  { label: "Chains", glyph: "icon-compare", render: () => <ChainsTab /> },
  { label: "Tutorials", glyph: "icon-book", render: () => <TutorialsTab /> },
  { label: "Cancelled", glyph: "icon-filter-off", render: () => <CancelledTab /> },
  { label: "Timeline", glyph: "icon-history", render: () => <TimelineTab /> }
] as const;

export default function DocsPlugin() {
  const [tab, setTab] = React.useState(0);

  return (
    <Box
      // The area the shell's ONE context-menu listener resolves against. Declared
      // in `docs.decl.ts` — a marker with no declaration is an invisible menu, and
      // the conformance gate fails in both directions for exactly that reason.
      data-axf-area="docs.surface"
      sx={{ p: { xs: 2, md: 3 }, maxWidth: 1440, mx: "auto" }}
    >
      <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: "wrap", alignItems: "flex-start" }} useFlexGap>
        <Box sx={{ width: 40, height: 40, flexShrink: 0 }}>
          <Glyph id="icon-book" />
        </Box>
        <Box sx={{ flex: 1, minWidth: 260 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            AmberX AI Studio — project documentation
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Generated by reading every session that touched this project, plus the planning state,
            the issue list, the nine build plans and the tree itself. Current as of{" "}
            <strong>2026-08-12</strong>.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
          <Link href="/theme-designer" underline="hover" variant="body2">theme designer</Link>
          <Link href="/settings" underline="hover" variant="body2">settings</Link>
          <Link href="/buildmgr" underline="hover" variant="body2">build manager</Link>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ mb: 2, overflowX: "auto" }}>
        <Tabs value={tab} onChange={(_e, v) => setTab(v)} variant="scrollable" scrollButtons="auto">
          {TABS.map((t) => (
            <Tab
              key={t.label}
              label={t.label}
              iconPosition="start"
              icon={<Box sx={{ width: 16, height: 16 }}><Glyph id={t.glyph} /></Box>}
              sx={{ textTransform: "none", minHeight: 48 }}
            />
          ))}
        </Tabs>
      </Paper>

      {TABS[tab].render()}

      <Divider sx={{ my: 3 }} />
      <Typography variant="caption" color="text.secondary">
        This page is authored data (<Path>src/plugins/docs/docs.data.ts</Path>), not a generated
        artefact. It is a stopgap for the documentation engine that is still unbuilt — when that
        ships, this is the content it should absorb, and the reason the engine is worth building is
        that keeping a page like this current is a manual duty and manual duties rot.
      </Typography>
    </Box>
  );
}

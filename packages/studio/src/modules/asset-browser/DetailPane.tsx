"use client";

/**
 * @file The detail pane — one asset, and the whole of how it is authored.
 *
 * The point of this pane is the four-part tuple P0 recorded per kind: schema,
 * source-of-truth, generator, renderer. A browser that showed only the asset's
 * own fields would be a JSON viewer; showing the ENGINE beside them is what
 * makes the anti-hand-write contract visible instead of merely enforced —
 * a person can read, on the screen, that changing this thing means editing that
 * file and re-running that command.
 *
 * ## Why the verbs are stated and not offered
 *
 * `AssetCard.verbs` says which of build / edit / rename / expand a kind
 * SUPPORTS. This phase is the shell; the engines behind those verbs are P6-P10.
 * So they are rendered as capability, with the engine that will perform each
 * one named — not as buttons. A button wired to a "coming soon" toast is a dead
 * button, and the module contract forbids those outright: every callback ends
 * in visible behaviour.
 */

import * as React from "react";

import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { CONTRACT_BY_KIND, ENGINES } from "../../asset-browser/contract";
import AssetPreview from "./AssetPreview";
import type { CatalogEntry } from "./catalog";
import { factsFor } from "./summary";

const MONO = "var(--axf-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ px: 1.75, py: 1.25 }}>
      <Typography
        sx={{
          fontSize: 10.5,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: token("dim"),
          mb: 0.75
        }}
      >
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** A `label / value` row, value monospaced because every one is a path or id. */
function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <>
      <Typography component="span" sx={{ fontSize: 11.5, color: token("dim"), pr: 1 }}>
        {label}
      </Typography>
      <Tooltip title={title ?? ""} enterDelay={600} disableHoverListener={!title}>
        <Typography
          component="span"
          sx={{ fontSize: 11.5, fontFamily: MONO, wordBreak: "break-all", lineHeight: 1.5 }}
        >
          {value}
        </Typography>
      </Tooltip>
    </>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 1, rowGap: 0.5 }}>
      {children}
    </Box>
  );
}

export interface DetailPaneProps {
  readonly entry: CatalogEntry | null;
  /** Append the underlying manifest or asset object. */
  readonly showRaw: boolean;
  /** Nothing selected, or a selection that no longer exists after a reload. */
  readonly emptyMessage: string;
}

export default function DetailPane({ entry, showRaw, emptyMessage }: DetailPaneProps) {
  if (!entry) {
    return (
      <Box
        data-axf-area="asset-browser.surface"
        sx={{ height: "100%", display: "grid", placeItems: "center", p: 3, color: token("dim") }}
      >
        <Typography sx={{ fontSize: 12.5, textAlign: "center", maxWidth: 300, lineHeight: 1.6 }}>
          {emptyMessage}
        </Typography>
      </Box>
    );
  }

  const { card, kind, disk, enabled, notes } = entry;
  const contract = CONTRACT_BY_KIND[card.kind];
  const facts = factsFor(card);

  return (
    <Box
      data-axf-area="asset-browser.asset"
      data-axf-asset={entry.key}
      data-axf-kind={card.kind}
      sx={{ height: "100%", overflowY: "auto", bgcolor: token("panel") }}
    >
      {/* ------------------------------------------------------------ head */}
      <Box sx={{ px: 1.75, pt: 1.5, pb: 1.25 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "flex-start" }}>
          <Box sx={{ color: token("accent"), mt: 0.25 }}>
            <Glyph id="icon-folder" size={18} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 15, fontWeight: 700, lineHeight: 1.25 }}>
              {card.name}
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: token("dim"), fontFamily: MONO }}>
              {card.kind} · {card.id}
              {card.version ? ` · ${card.version}` : " · unversioned"}
            </Typography>
          </Box>
        </Stack>
        <Typography sx={{ fontSize: 12, color: token("dim"), mt: 1, lineHeight: 1.55 }}>
          {card.description}
        </Typography>
        {!enabled && (
          <Alert severity="warning" sx={{ mt: 1, fontSize: 11.5, py: 0 }}>
            Disabled in the registry. That is a flag and nothing else — the files have not moved.
          </Alert>
        )}
      </Box>

      {/* ---------------------------------------------------- live preview */}
      {/* The bigger draw of the same thing the card shows, through the same
          renderer — a kit's whole logo set rather than the first five, a pack's
          whole contract rather than fourteen drawings. `Renderer` in the tuple
          below NAMES what drew this; here it actually draws. */}
      <Box sx={{ px: 1.75, pb: 0.25 }}>
        <AssetPreview entry={entry} size="detail" />
      </Box>
      <Divider />

      {/* --------------------------------------------------------- problems */}
      {notes.length > 0 && (
        <>
          <Section title="Problems">
            <Stack spacing={0.75}>
              {notes.map((n, i) => (
                <Alert
                  key={`${n.message}-${i}`}
                  severity={n.level === "error" ? "error" : "warning"}
                  sx={{ fontSize: 11.5, py: 0 }}
                >
                  {n.message}
                  {n.path ? (
                    <Typography component="span" sx={{ display: "block", fontFamily: MONO, fontSize: 11 }}>
                      {n.path}
                    </Typography>
                  ) : null}
                </Alert>
              ))}
            </Stack>
          </Section>
          <Divider />
        </>
      )}

      {/* ------------------------------------------------------------ facts */}
      {facts.length > 0 && (
        <>
          <Section title="What it holds">
            <Grid>
              {facts.map((f) => (
                <Row key={f.label} label={f.label} value={f.value} />
              ))}
            </Grid>
          </Section>
          <Divider />
        </>
      )}

      {/* ------------------------------------------------- the four-part tuple */}
      <Section title="How it is authored">
        <Grid>
          <Row label="Lifecycle" value={kind.lifecycle} />
          <Row label="Source" value={kind.source} title="Editing THIS is what changes the asset" />
          <Row label="Generator" value={kind.generator ?? "— authored in code"} />
          <Row label="Renderer" value={kind.renderer} />
          <Row label="Schema" value={kind.schema ?? "— the contract is TypeScript"} />
          <Row label="Chokepoint" value={kind.chokepoint ?? "—"} />
          <Row label="Registered in" value={kind.registry} />
          <Row label="Gate" value={kind.gate ?? "— none"} />
          {kind.overrides ? <Row label="Overrides" value={kind.overrides} /> : null}
        </Grid>
      </Section>
      <Divider />

      {/* ------------------------------------------------------------- disk */}
      {disk && (
        <>
          <Section title="On disk">
            <Grid>
              <Row label="Installed" value={disk.installed ?? "— not named"} />
              <Row
                label="Present"
                value={disk.installedPresent ? "yes" : "NO — the directory is missing"}
              />
              <Row label="Archive" value={disk.archive ?? "— never packaged"} />
              <Row
                label="Zip"
                value={
                  disk.archive === null
                    ? "—"
                    : disk.archivePresent
                      ? "on disk"
                      : "NO — the registry names a zip that is not there"
                }
              />
              {disk.authoredBy ? <Row label="Authored by" value={disk.authoredBy} /> : null}
              {disk.signature ? (
                <Row
                  label="Signature"
                  value={disk.signature}
                  title="The generator's sha256 over the manifest — recomputed by the kind's :check and by its conformance test"
                />
              ) : null}
              {disk.created ? <Row label="Created" value={disk.created} /> : null}
            </Grid>
          </Section>
          <Divider />
        </>
      )}

      {/* ------------------------------------------------------- references */}
      <Section title={`References (${card.references.length})`}>
        {card.references.length === 0 ? (
          <Typography sx={{ fontSize: 11.5, color: token("dim") }}>
            This asset names no other asset. An empty list is a real answer — a pack’s drawings
            are what everything else points AT.
          </Typography>
        ) : (
          <Stack spacing={0.5}>
            {card.references.map((r, i) => (
              <Stack
                key={`${r.path}-${r.id}-${i}`}
                direction="row"
                spacing={0.75}
                sx={{ alignItems: "center", flexWrap: "wrap" }}
              >
                <Chip
                  size="small"
                  variant="outlined"
                  color={r.resolved ? "default" : "error"}
                  label={r.target}
                  sx={{ height: 18, fontSize: 10 }}
                />
                <Typography sx={{ fontSize: 11.5, fontFamily: MONO, wordBreak: "break-all" }}>
                  {r.id}
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: token("dim") }}>{r.path}</Typography>
                {!r.resolved && (
                  <Typography sx={{ fontSize: 10.5, color: token("err") }}>
                    nothing resolves this
                  </Typography>
                )}
              </Stack>
            ))}
          </Stack>
        )}
      </Section>
      <Divider />

      {/* ------------------------------------------------------------ verbs */}
      <Section title="What may be changed">
        {card.verbs.length === 0 ? (
          <Typography sx={{ fontSize: 11.5, color: token("dim"), lineHeight: 1.55 }}>
            Read-only here. {kind.mutation.forbidden[0] ?? "This kind has no authoring seam in AmberX."}
          </Typography>
        ) : (
          <>
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5, mb: 1 }}>
              {card.verbs.map((verb) => {
                const binding = contract.mutations.find((m) => m.verb === verb);
                const engine = binding ? ENGINES[binding.engine] : null;
                return (
                  <Tooltip
                    key={verb}
                    title={engine ? `${engine.invoke}${engine.verify ? ` — verified by ${engine.verify}` : ""}` : ""}
                  >
                    <Chip size="small" variant="outlined" label={verb} sx={{ height: 19, fontSize: 10.5 }} />
                  </Tooltip>
                );
              })}
            </Stack>
            {contract.cap ? (
              <Typography sx={{ fontSize: 11, color: token("dim"), mb: 1, lineHeight: 1.5 }}>
                Growing it is bounded: {contract.cap.limit === "max"
                  ? `${contract.cap.field} caps at ${contract.cap.max}`
                  : `${contract.cap.field} must come from ${contract.cap.members}`}{" "}
                — enforced by {contract.cap.enforcedBy}.
              </Typography>
            ) : null}
            {/* The honest statement, and the reason there are no buttons here.
                It names the phase so a reader knows this is sequenced work
                rather than an omission. */}
            <Typography sx={{ fontSize: 11, color: token("dim"), lineHeight: 1.55 }}>
              The browser does not perform these yet — the engines behind them arrive with the
              build/edit/rename/expand phases. Every one of them will edit the SOURCE above and
              re-run the generator; none of them will write the installed manifest.
            </Typography>
          </>
        )}
      </Section>

      {/* ------------------------------------------------- editable fields */}
      {card.editable.length > 0 && (
        <>
          <Divider />
          <Section title={`Editable fields (${card.editable.length})`}>
            <Grid>
              {card.editable.map((f) => (
                <Row
                  key={f.path}
                  label={f.label}
                  value={`${f.path} · ${f.control} · ${f.engine}`}
                  title={f.note}
                />
              ))}
            </Grid>
          </Section>
        </>
      )}

      {/* ---------------------------------------------- structural refusals */}
      {contract.structural.length > 0 && (
        <>
          <Divider />
          <Section title="Never editable">
            <Stack spacing={0.5}>
              {contract.structural.map((s) => (
                <Box key={s.path}>
                  <Typography sx={{ fontSize: 11.5, fontFamily: MONO }}>{s.path}</Typography>
                  <Typography sx={{ fontSize: 11, color: token("dim"), lineHeight: 1.5 }}>
                    {s.why}
                  </Typography>
                </Box>
              ))}
            </Stack>
          </Section>
        </>
      )}

      {/* ------------------------------------------------------- pack notice */}
      {kind.lifecycle === "code-pack" && (
        <>
          <Divider />
          <Section title="Selection">
            <Typography sx={{ fontSize: 11.5, color: token("dim"), lineHeight: 1.55 }}>
              Branding is a fixed app setting, picked in exactly one place —{" "}
              <Link href="/settings" underline="hover">
                /settings
              </Link>
              . It is never rolled, never in a theme and never in a saved look, so this screen
              shows packs and does not select one: a second selector is how two surfaces come to
              disagree about which pack is live.
            </Typography>
          </Section>
        </>
      )}

      {/* --------------------------------------------------------------- raw */}
      {showRaw && (
        <>
          <Divider />
          <Accordion disableGutters elevation={0} sx={{ bgcolor: "transparent" }}>
            <AccordionSummary sx={{ px: 1.75, minHeight: 36, "& .MuiAccordionSummary-content": { my: 0.75 } }}>
              <Typography
                sx={{
                  fontSize: 10.5,
                  letterSpacing: "0.09em",
                  textTransform: "uppercase",
                  color: token("dim")
                }}
              >
                Raw asset
              </Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ px: 1.75, pt: 0 }}>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  fontSize: 10.5,
                  fontFamily: MONO,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  color: token("dim")
                }}
              >
                {stringify(disk?.manifest ?? card.raw)}
              </Box>
            </AccordionDetails>
          </Accordion>
        </>
      )}
    </Box>
  );
}

/**
 * JSON, or an honest line saying why not.
 *
 * A chrome asset is a live object with a `render` function on it (a dashboard
 * wrapper) or a brand symbol, and `JSON.stringify` throws on a circular graph.
 * The raw view is a diagnostic, so it degrades to a message rather than taking
 * the pane down with it.
 */
function stringify(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      value,
      (_k, v: unknown) => {
        if (typeof v === "function") return "[function]";
        if (typeof v === "object" && v !== null) {
          if (seen.has(v)) return "[circular]";
          seen.add(v);
        }
        return v;
      },
      2
    );
  } catch (e) {
    return `— this asset cannot be shown as JSON: ${e instanceof Error ? e.message : "unknown"}`;
  }
}

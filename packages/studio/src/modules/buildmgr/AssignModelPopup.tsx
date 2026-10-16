/**
 * @file The Assign-model popup — the acting half of the plan outline's
 * right-click "Assign model…" row.
 *
 * One MUI Dialog, mounted once by `BuildmgrModule`, driven entirely by
 * `assignModelUi` (see `assign-model.ts` for why a store and not a hook).
 * Selecting a model WRITES it: one edit through `/api/bmpx/plan`, which owns
 * every safety the popup would otherwise have to duplicate — the unknown-model
 * refusal, the done-step refusal, the run-lock 409, the `.planbak` backup and
 * the both-trees mirror. On success the popup closes itself and `onSaved`
 * refetches, because the `.bmpx` is the truth and the screen is a cache of it.
 *
 * Each row wears a CONTRACT glyph (`icon-*` from the 43-id template — pack
 * extras like `icon-user` fail `check:glyphs`), tinted with the model's `tone`
 * token from the catalog so the popup recolours with the theme. `opus-4-8`
 * renders disabled: `.claude/rules/model-selection.md` forbids assigning it to
 * new steps, and a greyed row saying why teaches more than a hidden one.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Dialog from "@mui/material/Dialog";
import Typography from "@mui/material/Typography";

import { Glyph, token } from "@axf/core";

import { assignModelUi } from "./assign-model";
import { MODEL_CATALOG, modelChangeImpact, resolveModel } from "./models";

/** Contract glyph per tier — ids verified against `REQUIRED_GLYPH_IDS`. */
const MODEL_GLYPH: Record<string, string> = {
  "haiku-4-5": "icon-line",
  "sonnet-5": "icon-layers",
  "opus-4-8": "icon-history",
  "fable-5": "icon-sparkle",
  "opus-5": "icon-bolt"
};

const M = {
  fontFamily: token("mono"),
  fontSize: 11,
  lineHeight: 1.3,
  letterSpacing: "normal"
} as const;

export default function AssignModelPopup({ onSaved }: { onSaved: () => void }) {
  const target = React.useSyncExternalStore(
    assignModelUi.subscribe,
    assignModelUi.getState,
    assignModelUi.getServerState
  );
  const [saving, setSaving] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // A fresh target is a fresh conversation — stale errors from the last step
  // would read as verdicts on this one.
  React.useEffect(() => {
    setError(null);
    setSaving(null);
  }, [target]);

  const pick = React.useCallback(
    async (slug: string) => {
      if (!target || saving) return;
      if (slug === target.model) {
        // "Select and close": re-picking the stored model is a no-op, not a write.
        assignModelUi.close();
        return;
      }
      setSaving(slug);
      setError(null);
      try {
        const r = await fetch("/api/bmpx/plan", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            file: target.file,
            edits: [{ phaseN: target.phaseN, stepIndex: target.stepIndex, model: slug }]
          })
        });
        const j = (await r.json()) as { ok?: boolean; error?: string };
        if (!r.ok || !j.ok) {
          setError(j.error ?? `save failed (${r.status})`);
          setSaving(null);
          return;
        }
        // Close on selection — the ask — then let the screen re-read the file.
        assignModelUi.close();
        onSaved();
      } catch (e) {
        setError(String(e));
        setSaving(null);
      }
    },
    [target, saving, onSaved]
  );

  if (!target) return null;
  const current = resolveModel(target.model);

  return (
    <Dialog
      open
      onClose={() => assignModelUi.close()}
      slotProps={{
        paper: {
          sx: {
            background: token("panel"),
            border: `1px solid ${token("edge")}`,
            minWidth: 340,
            maxWidth: 420
          }
        }
      }}
    >
      <Box sx={{ padding: "10px 12px 4px" }}>
        <Typography sx={{ ...M, fontSize: 12, color: token("ink") }}>
          Assign model — P{target.phaseN} step {target.stepIndex + 1}
        </Typography>
        <Typography sx={{ ...M, color: token("dim") }}>
          {target.file} · currently {current ? current.label : target.model || "builder default (sonnet-5)"}
        </Typography>
      </Box>

      <Box sx={{ padding: "6px 6px 10px", display: "flex", flexDirection: "column" }}>
        {target.done ? (
          <Typography sx={{ ...M, color: token("warn"), padding: "4px 8px" }}>
            This step is already done — its work is in the tree, so the plan refuses a
            re-point. Reset the flag first if a rebuild is really intended.
          </Typography>
        ) : (
          MODEL_CATALOG.map((m) => {
            const isCurrent = m.slug === target.model;
            // The standing rule: opus-4-8 is superseded at the same price and
            // may not be assigned to new steps. Shown greyed, saying why.
            const banned = m.slug === "opus-4-8" && !isCurrent;
            const impact =
              !isCurrent && target.model ? modelChangeImpact(target.model, m.slug) : null;
            return (
              <ButtonBase
                key={m.slug}
                disabled={banned || saving !== null}
                onClick={() => void pick(m.slug)}
                sx={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  justifyContent: "flex-start",
                  textAlign: "left",
                  padding: "6px 8px",
                  borderRadius: "4px",
                  opacity: banned ? 0.45 : 1,
                  background: isCurrent ? token("panel2") : "transparent",
                  "&:hover": { background: token("panel2") }
                }}
              >
                <Box
                  sx={{
                    width: 22,
                    height: 22,
                    flex: "none",
                    marginTop: "1px",
                    color: token(m.tone),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                >
                  <Glyph id={MODEL_GLYPH[m.slug] ?? "icon-gear"} size={18} />
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ ...M, color: token("ink") }}>
                    {m.label}
                    {isCurrent ? <Box component="span" sx={{ color: token("ok") }}> ✓ current</Box> : null}
                    <Box component="span" sx={{ color: token("dim") }}>
                      {"  "}${m.inPerMTok}/${m.outPerMTok} per MTok
                      {saving === m.slug ? " · saving…" : ""}
                    </Box>
                  </Typography>
                  <Typography sx={{ ...M, fontSize: 10, color: token("dim") }}>
                    {banned ? m.whyNot : m.fit}
                  </Typography>
                  {impact && !banned ? (
                    <Typography
                      sx={{
                        ...M,
                        fontSize: 10,
                        color: impact.costPct > 0 ? token("warn") : token("ok")
                      }}
                    >
                      {impact.costPct > 0 ? "+" : ""}
                      {impact.costPct}% cost vs {current?.label ?? target.model}
                    </Typography>
                  ) : null}
                </Box>
              </ButtonBase>
            );
          })
        )}
        {error ? (
          <Typography sx={{ ...M, color: token("err"), padding: "6px 8px 0" }}>{error}</Typography>
        ) : null}
      </Box>
    </Dialog>
  );
}

"use client";

/**
 * @file **The member's own credit surface** — the balance, what spends it, the
 * ledger behind it, and the buy flow's honest absence (P18).
 *
 * It lives on the settings stage rather than as a stage of its own, and that is
 * a deliberate downgrade: credits are a fact about the account, sitting beside
 * every other per-account preference, and a stage of their own would be a
 * standing invitation to spend money that this studio cannot currently take.
 *
 * ## Three things it will not do
 *
 * 1. **No card form. Ever.** With `AMBERXVID_PAYMENTS_URL` unset the pane says
 *    purchases are not enabled and renders **nothing clickable** — no "coming
 *    soon" button that opens a dialog apologising, no disabled Buy that looks
 *    like it might work next week. A UI that looks like it takes money and does
 *    not is the one that eventually receives a real card number.
 * 2. **It does not restate a price.** Every number in the meter table comes from
 *    the server's meter registry through `/api/amberxvid/credits`. A price
 *    written twice is a price that drifts, and this one is denominated in money.
 * 3. **It does not explain the refusal in its own words.** Whatever the server
 *    said — not permitted, no processor, out of range — is what is shown.
 *
 * ## What "checkout-shaped" means here
 *
 * With a processor configured the flow is a hand-off: pick an amount, the
 * server mints a reference and hands back a URL, and the browser goes there.
 * The credit lands on the RETURN leg, which is a server call
 * (`complete: true`), never on the way out — a member who opens the payment page
 * and closes it has bought nothing, and a pane that credited the intent would be
 * free credits for anyone who clicked.
 */

import * as React from "react";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { Glyph } from "@axf/core";

import { GX, gxa } from "./kit/gx";
import { GxCard, GxChip } from "./kit/ax";
import { useAmberXVidCredits } from "./lib/creditsClient";

/** What one credit movement reads as. Same vocabulary as the admin console's,
 *  on purpose — a member and an administrator looking at the same entry should
 *  not be reading two different words for it. */
const KIND_LABEL: Record<string, string> = {
  purchase: "bought",
  grant: "granted",
  spend: "spent",
  refund: "refunded",
};

export interface CreditsPaneProps {
  notify: (message: string) => void;
}

export default function CreditsPane({ notify }: CreditsPaneProps) {
  const credits = useAmberXVidCredits(true);
  const [amount, setAmount] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [buyError, setBuyError] = React.useState<string | null>(null);

  const purchase = credits.purchase;
  const canBuy = purchase?.available === true;

  const buy = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    setBusy(true);
    setBuyError(null);
    try {
      const res = await fetch("/api/amberxvid/credits/buy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credits: Math.round(n) }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string; url?: string }
        | null;
      if (!res.ok || !json?.ok || !json.url) {
        setBuyError(json?.error ?? `the checkout could not be started (${res.status})`);
        return;
      }
      // The hand-off. Nothing has been credited; the processor's return leg is
      // what calls back with the reference this URL carries.
      notify("Opening the payment page…");
      window.location.assign(json.url);
    } catch {
      setBuyError("the checkout could not be reached");
    } finally {
      setBusy(false);
    }
  };

  const statement = credits.statement;
  const metering = credits.status?.enabled === true;

  return (
    <GxCard
      title="AI credits"
      meta={
        <Stack direction="row" sx={{ gap: 0.75, alignItems: "center" }}>
          <GxChip label={metering ? "metering on" : "metering off"} kind={metering ? "ok" : "dim"} />
          {statement && <GxChip label={`${statement.balance}`} kind="ok" />}
        </Stack>
      }
    >
      <Typography sx={{ fontSize: 10.5, color: GX.dim, pb: 0.75 }}>
        Credits are yours across the whole platform — one balance, held on your account, spent by
        whatever charges for AI work. An administrator can grant them; what spends them is listed
        below.
      </Typography>

      {credits.loading && <CircularProgress size={18} />}

      {credits.error && (
        <Alert severity="warning" variant="outlined" sx={{ fontSize: 12, mb: 1 }}>
          {credits.error}
        </Alert>
      )}

      {!metering && credits.status?.why && (
        // Stated, not hidden. A credits pane that showed a balance and said
        // nothing about metering being off looks exactly like one where the
        // charging is broken.
        <Alert severity="info" variant="outlined" sx={{ fontSize: 12, mb: 1 }}>
          {credits.status.why}
        </Alert>
      )}

      {/* ── what spends them ─────────────────────────────────────────────── */}
      {credits.meters.length > 0 && (
        <Box sx={{ mb: 1.5 }}>
          <Typography sx={{ fontSize: 11, color: GX.dim, mb: 0.5 }}>What costs credits</Typography>
          <Stack sx={{ gap: 0.5 }}>
            {credits.meters.map((m) => (
              <Stack
                key={m.id}
                direction="row"
                sx={{
                  alignItems: "center",
                  gap: 1,
                  px: 1,
                  py: 0.5,
                  border: `1px solid ${gxa(GX.edge, "88")}`,
                  borderRadius: 1,
                }}
              >
                <Glyph id={m.glyph ?? "icon-bolt"} size={13} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{m.title}</Typography>
                  {m.hint && (
                    <Typography sx={{ fontSize: 10.5, color: GX.dim }}>{m.hint}</Typography>
                  )}
                </Box>
                <Typography
                  sx={{
                    fontFamily: GX.mono,
                    fontSize: 12,
                    fontVariantNumeric: "tabular-nums",
                    color: m.cost === 0 ? GX.dim : GX.ink,
                    flexShrink: 0,
                  }}
                >
                  {m.cost === 0 ? "free" : `${m.cost} / use`}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Box>
      )}

      <Divider sx={{ borderColor: gxa(GX.edge, "88"), my: 1 }} />

      {/* ── buying, or the honest absence of it ──────────────────────────── */}
      {purchase && !canBuy && (
        <Alert severity="info" variant="outlined" sx={{ fontSize: 12 }}>
          {purchase.available ? "" : purchase.why}
        </Alert>
      )}

      {canBuy && (
        <Stack sx={{ gap: 1 }}>
          <Stack direction="row" sx={{ gap: 1, alignItems: "flex-start" }}>
            <TextField
              label="Credits to buy"
              size="small"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              sx={{ width: 170 }}
              slotProps={{ htmlInput: { inputMode: "numeric" } }}
            />
            <Button
              variant="contained"
              size="small"
              disabled={busy || !(Number(amount) > 0)}
              onClick={() => void buy()}
              sx={{ textTransform: "none", mt: 0.25 }}
            >
              {busy ? <CircularProgress size={16} /> : "Continue to payment"}
            </Button>
          </Stack>
          <Typography sx={{ fontSize: 10.5, color: GX.dim }}>
            You will be handed to the payment provider. Nothing is credited until you come back
            from it.
          </Typography>
          {buyError && (
            <Alert severity="error" variant="outlined" sx={{ fontSize: 12 }}>
              {buyError}
            </Alert>
          )}
        </Stack>
      )}

      {/* ── the ledger ───────────────────────────────────────────────────── */}
      {statement && statement.entries.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Stack direction="row" sx={{ alignItems: "center", gap: 1, mb: 0.5 }}>
            <Typography sx={{ fontSize: 11, color: GX.dim, flex: 1 }}>
              {statement.entries.length} of {statement.total} movements, newest first
            </Typography>
            <Button
              size="small"
              onClick={credits.refresh}
              sx={{ fontSize: 11, textTransform: "none" }}
            >
              Refresh
            </Button>
          </Stack>
          <Box sx={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${gxa(GX.edge, "88")}` }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 10.5, color: GX.dim }}>When</TableCell>
                  <TableCell sx={{ fontSize: 10.5, color: GX.dim }}>What</TableCell>
                  <TableCell sx={{ fontSize: 10.5, color: GX.dim }} align="right">
                    Credits
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {statement.entries.map((e) => (
                  <TableRow key={e.id} hover>
                    <TableCell sx={{ fontSize: 11, color: GX.dim, whiteSpace: "nowrap" }}>
                      {new Date(e.at).toLocaleString()}
                    </TableCell>
                    <TableCell sx={{ fontSize: 11.5 }}>
                      {KIND_LABEL[e.kind] ?? e.kind} · {e.ref}
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{
                        fontFamily: GX.mono,
                        fontSize: 12,
                        fontVariantNumeric: "tabular-nums",
                        color: e.delta > 0 ? GX.ok : GX.ink,
                      }}
                    >
                      {e.delta > 0 ? `+${e.delta}` : e.delta}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        </Box>
      )}

      {statement && statement.total === 0 && !credits.loading && (
        <Typography sx={{ fontSize: 11.5, color: GX.dim, mt: 1 }}>
          No credit has moved on this account yet.
        </Typography>
      )}
    </GxCard>
  );
}

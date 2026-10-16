/**
 * @file /status — the kernel boot report (the previous `/` index, moved aside
 * at P7 when the dashboard became the landing; MASTER §4: "move the current
 * home aside").
 *
 * Lists what the kernel actually booted and what the registry actually holds.
 * While the core is being built, this is the screen that tells you whether it
 * came up.
 *
 * **It is a client component, deliberately.** It used to `await boot()` as a
 * server component, which booted the react-server layer — a runtime that
 * structurally cannot hold this subsystem (see `src/BootedHost.tsx`) and that
 * nothing else in the app ever renders from. So the one screen whose job is
 * reporting the truth was reporting a runtime nobody uses, and reporting it
 * `failed`. It reads the client kernel now: the one the app actually runs on.
 *
 * ── MUI (2026-08-10, P3) ─────────────────────────────────────────────────────
 *
 * Rebuilt with the other studio surfaces P3's ledger owned. The boot report is
 * a `Table` now rather than four flex rows pretending to be one: it IS tabular
 * data — state, id, layer, error — and a real table gives it column alignment
 * and a header a screen reader can associate rows with. Its own `<main>` went
 * for the reason `app/page.tsx` records: `NavShell` renders the one `main`, and
 * this page was shipping a second.
 */
"use client";

import { use } from "react";
import Link from "next/link";

import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { registry, token, AXF_CORE_VERSION } from "@axf/core";

import { boot } from "../../src/boot";

// Module scope, as everywhere else in the client graph.
void boot();

/** The section heading voice, matching `app/page.tsx`. */
const HEADING = {
  fontFamily: token("mono"),
  fontSize: 11,
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  color: token("dim")
} as const;

const CELL = {
  fontFamily: token("mono"),
  fontSize: 12.5,
  borderBottom: `1px solid ${token("edge")}`,
  padding: "6px 10px 6px 0"
} as const;

export default function StatusPage() {
  // `boot()` memoises its promise, so this is the same promise on every render
  // — which is what makes `use()` safe here.
  const statuses = use(boot());
  const modules = registry.modules();
  const failed = statuses.filter((s) => s.state !== "started");

  return (
    <Box sx={{ padding: "28px 32px", maxWidth: 900, display: "grid", gap: "22px" }}>
      <Box>
        <Typography component="h1" sx={{ fontSize: 22, fontWeight: 700 }}>
          AmberX AI Studio{" "}
          <Typography component="span" sx={{ color: token("dim"), fontSize: 13, fontWeight: 400 }}>
            core {AXF_CORE_VERSION}
          </Typography>
        </Typography>
        <Typography sx={{ color: token("dim"), marginTop: "8px", lineHeight: 1.55 }}>
          Studio is a{" "}
          <Box component="strong" sx={{ color: token("ink") }}>
            subsystem
          </Box>{" "}
          — framework-level infrastructure the core loads and supervises, not an application
          sitting on top of it. That is why it never appears in a peel closure.
        </Typography>
      </Box>

      <Paper
        component="section"
        elevation={0}
        sx={{
          background: token("panel"),
          backgroundImage: "none",
          border: `1px solid ${failed.length ? token("err") : token("edge")}`,
          borderRadius: token("radius"),
          padding: "14px 16px"
        }}
      >
        <Typography component="h2" sx={{ ...HEADING, marginBottom: "10px" }}>
          Kernel boot
        </Typography>
        <Table size="small" aria-label="kernel boot report">
          <TableHead>
            <TableRow>
              {["state", "subsystem", "layer", "error"].map((h) => (
                <TableCell key={h} sx={{ ...CELL, ...HEADING, fontSize: 9.5 }}>
                  {h}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {statuses.map((s) => (
              <TableRow key={s.id}>
                <TableCell sx={{ ...CELL, color: s.state === "started" ? token("ok") : token("err") }}>
                  {s.state}
                </TableCell>
                <TableCell sx={CELL}>{s.id}</TableCell>
                {/* The SSR pass and the browser each boot their own kernel, so
                    the measured duration legitimately differs between them.
                    Everything else on this row must still match, so the
                    suppression is on the timing cell alone rather than the row. */}
                {/* nowrap: the layer and the duration are one fact, and the
                    error column takes the remaining width — without this the
                    cell breaks after "sdk ·" and reads as two rows. */}
                <TableCell
                  sx={{ ...CELL, color: token("dim"), fontSize: 11, whiteSpace: "nowrap" }}
                  suppressHydrationWarning
                >
                  {s.layer}
                  {s.startedInMs !== undefined ? ` · ${s.startedInMs}ms` : ""}
                </TableCell>
                <TableCell sx={{ ...CELL, color: token("err"), width: "100%" }}>
                  {s.error ?? ""}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Stack component="section" sx={{ gap: "8px" }}>
        <Typography component="h2" sx={HEADING}>
          Registered modules
        </Typography>
        {modules.length === 0 ? (
          <Typography sx={{ color: token("err"), fontFamily: token("mono"), fontSize: 12.5 }}>
            none — a subsystem failed to register its assets
          </Typography>
        ) : (
          modules.map((m) => (
            <Card
              key={m.id}
              elevation={0}
              sx={{
                background: token("panel"),
                backgroundImage: "none",
                border: `1px solid ${token("edge")}`,
                borderRadius: token("radius")
              }}
            >
              <CardActionArea component={Link} href={m.route} sx={{ padding: "12px 15px" }}>
                <Typography sx={{ fontWeight: 600 }}>
                  {m.title}{" "}
                  <Typography
                    component="code"
                    sx={{ color: token("dim"), fontSize: 12, fontFamily: token("mono") }}
                  >
                    {m.route}
                  </Typography>
                </Typography>
                <Typography
                  sx={{ color: token("dim"), fontSize: 12.5, marginTop: "4px", lineHeight: 1.5 }}
                >
                  {m.summary}
                </Typography>
                <Typography
                  component="code"
                  sx={{
                    color: token("accent"),
                    fontSize: 11,
                    fontFamily: token("mono"),
                    display: "block",
                    marginTop: "6px"
                  }}
                >
                  {m.points.length} extension point{m.points.length === 1 ? "" : "s"}
                </Typography>
              </CardActionArea>
            </Card>
          ))
        )}
      </Stack>
    </Box>
  );
}

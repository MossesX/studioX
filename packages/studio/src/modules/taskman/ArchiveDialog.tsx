/**
 * @file The ARCHIVED LISTS dialog — where a deleted list can be found again.
 *
 * Owner, 2026-08-14: *"any and all deleted lists are not deleted they are
 * stored in archive in the users data location."*
 *
 * The storage half of that is `server/taskmanArchive.ts` and would have been a
 * complete implementation of the sentence. It would also have been a write-only
 * hole: an archive with no way to look at it is indistinguishable, from the
 * seat of the person using it, from having deleted the lists. So this exists,
 * small — a table, a Restore, a Delete for good, and an Empty archive.
 *
 * ── it reads on OPEN, every time ────────────────────────────────────────────
 *
 * No cache, no store, no subscription. The archive is a server document that a
 * second tab (or a second session as the same user) can also write, and the
 * dialog is open for seconds at a time — the cheapest correct thing is to ask
 * when it opens. Caching it would buy nothing and could show a list that was
 * restored elsewhere a minute ago.
 *
 * Mounted ONCE by `StudioShell` beside `NewItemDialog`, and renders `null`
 * until the event fires — the same overlay contract, so *Archived lists…* works
 * from a route that is not `/taskman`.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { ARCHIVE_DIALOG_EVENT } from "./archiveBridge";
import { listArchive, purgeArchived, restoreArchived, type ArchiveMeta } from "./archive";

/** Absolute, because "3 days ago" on a recovery screen invites the wrong guess. */
function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

export default function ArchiveDialog() {
  const [open, setOpen] = React.useState(false);
  const [entries, setEntries] = React.useState<ArchiveMeta[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setError(null);
    try {
      setEntries(await listArchive());
    } catch (e) {
      // `null` entries and a message, rather than an empty table: "your archive
      // is empty" and "the archive could not be read" are opposite facts and a
      // screen that renders them identically is the one that gets trusted wrongly.
      setEntries(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  React.useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      void refresh();
    };
    window.addEventListener(ARCHIVE_DIALOG_EVENT, onOpen);
    return () => window.removeEventListener(ARCHIVE_DIALOG_EVENT, onOpen);
  }, [refresh]);

  if (!open) return null;

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onClose={() => setOpen(false)} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 16 }}>Archived lists</DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ color: token("dim"), fontSize: 12, marginBottom: "10px" }}>
          Every list deleted in the Task Manager comes here first, in your own data — not the
          system&apos;s, and not another user&apos;s. Restore puts one back in the rail; deleting it
          here is the one step with no way back.
        </Typography>

        {error && (
          <Typography sx={{ color: token("err"), fontSize: 12.5, marginBottom: "10px" }}>
            {error}
          </Typography>
        )}

        {entries === null && !error && (
          <Typography sx={{ color: token("dim"), fontSize: 12.5 }}>Reading your archive…</Typography>
        )}

        {entries !== null && entries.length === 0 && (
          <Typography sx={{ color: token("dim"), fontSize: 12.5 }}>
            Nothing archived yet.
          </Typography>
        )}

        {entries !== null && entries.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontSize: 12 }}>List</TableCell>
                <TableCell sx={{ fontSize: 12 }}>Items</TableCell>
                <TableCell sx={{ fontSize: 12 }}>Deleted</TableCell>
                <TableCell sx={{ fontSize: 12 }}>By</TableCell>
                <TableCell align="right" sx={{ fontSize: 12 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} hover>
                  <TableCell sx={{ fontSize: 12.5 }}>{entry.name}</TableCell>
                  <TableCell sx={{ fontSize: 12.5, fontFamily: token("mono") }}>
                    {entry.itemCount}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12, color: token("dim") }}>
                    {stamp(entry.archivedAt)}
                  </TableCell>
                  <TableCell sx={{ fontSize: 12, color: token("dim") }}>{entry.reason}</TableCell>
                  <TableCell align="right">
                    <Stack direction="row" sx={{ gap: "4px", justifyContent: "flex-end" }}>
                      <Button
                        size="small"
                        disabled={busy !== null}
                        onClick={() => void act(entry.id, () => restoreArchived(entry.id))}
                        sx={{ fontSize: 12, textTransform: "none" }}
                      >
                        Restore
                      </Button>
                      <Button
                        size="small"
                        disabled={busy !== null}
                        onClick={() =>
                          void act(entry.id, async () => {
                            if (
                              !window.confirm(
                                `Delete "${entry.name}" for good? This is the one step with no ` +
                                  `way back — the list is not archived anywhere else.`
                              )
                            ) {
                              return;
                            }
                            await purgeArchived(entry.id);
                          })
                        }
                        sx={{ fontSize: 12, textTransform: "none", color: token("err") }}
                      >
                        Delete
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
      <DialogActions>
        <Button
          size="small"
          disabled={busy !== null || !entries?.length}
          onClick={() =>
            void act("all", async () => {
              if (
                !window.confirm(
                  `Empty the archive — ${entries?.length ?? 0} list(s), permanently? Nothing here ` +
                    `is stored anywhere else.`
                )
              ) {
                return;
              }
              await purgeArchived("all");
            })
          }
          sx={{ fontSize: 12.5, textTransform: "none", color: token("err") }}
        >
          Empty archive
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" onClick={() => void refresh()} sx={{ fontSize: 12.5, textTransform: "none" }}>
          Refresh
        </Button>
        <Button size="small" onClick={() => setOpen(false)} sx={{ fontSize: 12.5, textTransform: "none" }}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

"use client";

/**
 * @file A file-edit diff, drawn.
 *
 * The arithmetic is `diff.ts` — pure, bounded and testable. This file is only
 * the paint, and it has exactly three jobs the maths cannot do:
 *
 *  1. **Say which KIND of edit it was.** A `Write` has no before side (the
 *     transport never sends one) and renders as all-added; a `Write` drawn
 *     silently as a diff would imply the file was empty before, which is a
 *     claim nobody made. The header says "whole file" for that case.
 *  2. **Say when the diff was refused.** Past `MAX_DIFF_LINES` the pair is a
 *     replacement, not a diff, and a reader must not read an unrelated
 *     ±everything as a real comparison.
 *  3. **Say when `replace_all` was on.** "Change this one occurrence" and
 *     "change every occurrence in the file" produce identical hunks and are
 *     materially different acts.
 *
 * Colour comes from `ok`/`err`, tinted into the row background rather than
 * applied to the text: a whole line of coloured monospace is hard to read, and
 * a tint plus a `+`/`−` gutter is how every diff tool that people actually use
 * does it.
 */
import * as React from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { token } from "@axf/core";

import { MONO, Tag } from "./bits";
import { hunkHeader, toUnifiedPatch } from "./diff";
import type { DiffRow, FileDiff } from "./diff";
import { copyAndSay } from "./ui";

const ROW_STYLE: Record<DiffRow["kind"], { bg: string; mark: string; role: string }> = {
  add: { bg: token("ok"), mark: "+", role: "ok" },
  del: { bg: token("err"), mark: "-", role: "err" },
  context: { bg: "transparent", mark: " ", role: "ink" }
};

export default function DiffView({ diff }: { diff: FileDiff }) {
  const empty = !diff.hunks.length;
  return (
    <Box
      sx={{
        my: 1,
        border: `1px solid ${token("edge")}`,
        borderRadius: token("radius-tight"),
        overflow: "hidden",
        background: token("panel2")
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.8,
          px: 1,
          py: 0.4,
          background: token("panel"),
          borderBottom: `1px solid ${token("edge")}`
        }}
      >
        <Typography
          sx={{
            ...MONO,
            fontSize: 11.5,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            // The FILENAME is the identifying part and it is at the END of a
            // path, so the ellipsis goes on the left.
            direction: "rtl",
            textAlign: "left"
          }}
          title={diff.path ?? undefined}
        >
          {diff.path ?? "(no path)"}
        </Typography>
        {diff.mode === "write" && (
          <Tag tone="warn" title="A whole-file write. The transport does not send what the file held before, so there is no before side to compare — every line reads as added.">
            whole file
          </Tag>
        )}
        {diff.replaceAll && (
          <Tag tone="warn" title="replace_all was set: the edit applied at EVERY occurrence, not just the first.">
            every occurrence
          </Tag>
        )}
        {diff.truncated && (
          <Tag tone="warn" title="Too large to diff — shown as a replacement rather than a comparison.">
            not diffed
          </Tag>
        )}
        <Tag tone="ok">+{diff.added}</Tag>
        <Tag tone="err">−{diff.removed}</Tag>
        <Tooltip title="Copy as a unified patch — the format `git apply` reads.">
          <Button
            size="small"
            variant="outlined"
            onClick={() => void copyAndSay(toUnifiedPatch(diff), "the patch")}
            sx={{ fontSize: 11, py: 0, minWidth: 0, px: 1 }}
          >
            Patch
          </Button>
        </Tooltip>
      </Box>

      {empty ? (
        <Typography sx={{ fontSize: 11.5, color: token("dim"), px: 1, py: 0.6 }}>
          The two sides are identical — this edit changed nothing.
        </Typography>
      ) : (
        <Box sx={{ ...MONO, fontSize: 11.8, lineHeight: 1.5, overflowX: "auto" }}>
          {diff.hunks.map((hunk, index) => (
            <React.Fragment key={index}>
              {/* A hunk header is dropped for a whole-file write: "@@ -0,0 +1,40 @@"
                  is noise when there is only ever one hunk and no before side. */}
              {diff.mode !== "write" && (
                <Box sx={{ px: 1, color: token("dim"), background: token("panel"), opacity: 0.85 }}>
                  {hunkHeader(hunk)}
                </Box>
              )}
              {hunk.rows.map((row, rowIndex) => {
                const style = ROW_STYLE[row.kind];
                return (
                  <Box
                    key={rowIndex}
                    sx={{
                      display: "flex",
                      minWidth: "max-content",
                      // A tint, not a fill: `color-mix` keeps it legible against
                      // whatever surface the theme rolled, which a fixed alpha
                      // over a fixed hex would not.
                      background:
                        row.kind === "context"
                          ? "transparent"
                          : `color-mix(in srgb, ${style.bg} 14%, transparent)`
                    }}
                  >
                    <Box
                      component="span"
                      aria-hidden
                      sx={{
                        width: "4.5ch",
                        textAlign: "right",
                        pr: 0.6,
                        color: token("dim"),
                        opacity: 0.5,
                        userSelect: "none"
                      }}
                    >
                      {row.newLine ?? row.oldLine ?? ""}
                    </Box>
                    <Box
                      component="span"
                      aria-hidden
                      sx={{ width: "2ch", color: token(style.role), userSelect: "none" }}
                    >
                      {style.mark}
                    </Box>
                    <Box component="span" sx={{ whiteSpace: "pre", pr: 1 }}>
                      {row.text || " "}
                    </Box>
                  </Box>
                );
              })}
            </React.Fragment>
          ))}
        </Box>
      )}
    </Box>
  );
}

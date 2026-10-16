"use client";

/**
 * @file **Follow the streamer** — the module's own contribution to
 * `amberxvid.stream-tool` (P19, 2026-08-15).
 *
 * It used to be an inline `<Button>` in `StreamRoom.tsx`'s identity row. It
 * moved for two reasons, and only one of them is about extension points:
 *
 *  1. **It proves the point renders.** A declared point nobody has rendered
 *     through is a guess about a shape. This control is a toggle over live
 *     state that needs `following`, `setFollow`, `streamer` and `hosting` — so a
 *     `StreamToolHost` missing any of them fails here, on the first
 *     contribution, rather than on somebody's first plugin.
 *  2. **The identity row is the page's SUBJECT.** `StreamRoom.tsx`'s own header
 *     says so: it is the row that turns "a video is playing" into "a person is
 *     broadcasting". A control mixed into it read as part of the person. The
 *     follower COUNT is still there, because that is a fact about the host; the
 *     button is now in the control bar with the other things a viewer presses.
 *
 * `audience: "viewer"` on the contribution is what keeps it off the host's own
 * bar — a *Follow* button on your own broadcast is a control with no meaning,
 * and the old code expressed that as a `!hosting` ternary that also chose what
 * went in the button's place. Splitting the two made both halves simpler.
 *
 * Default-exported because a `load` thunk resolves `{ default }` — the payload
 * shape every panel-carrying point in this module uses.
 */

import * as React from "react";

import Button from "@mui/material/Button";

import { Star as FollowIcon } from "./kit/icons";
import type { StreamToolHost } from "./points";

export default function FollowTool({ host }: { host: StreamToolHost }) {
  const { following, setFollow, streamer } = host;
  return (
    <Button
      size="small"
      variant={following ? "outlined" : "contained"}
      color={following ? "inherit" : "primary"}
      startIcon={<FollowIcon sx={{ fontSize: 15 }} />}
      onClick={() => setFollow(!following)}
      aria-label={following ? `Unfollow ${streamer}` : `Follow ${streamer}`}
      data-el-id="amberxvid:stream-room:follow"
    >
      {following ? "Following" : "Follow"}
    </Button>
  );
}

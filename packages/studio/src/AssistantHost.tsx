/**
 * @file `AssistantHost` — the shell's mount for whatever contributed to
 * `studio.assistant`.
 *
 * Mounted once by `StudioShell`, beside `BmpxSync` and `NewItemDialog`, for
 * the standing reason: the assistant must exist on EVERY route (its whole
 * premise is "help with whatever is on screen"), and a per-module mount is a
 * mount a module can forget. It reads the registry rather than importing the
 * plugin, so the assistant is a contribution like any other — swappable,
 * peelable, and crash-isolated behind its own contribution-tier boundary
 * (a broken assistant must never take the shell down with it).
 */
"use client";

import * as React from "react";

import { Boundary, ContributionView, registry } from "@axf/core";
import type { Contribution } from "@axf/core";

import { boot } from "./boot";
import type { AssistantSurfacePayload } from "./plugins/module-assistant/plugin";

export default function AssistantHost() {
  // The registry fills during an ASYNC boot, and this component has no
  // subscription to it — so it must not read until boot resolves, or it
  // renders null once and stays null forever (found live: the command bar's
  // toggle flipped the store while no window existed to read it).
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    void boot().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  if (!ready) return null;

  const contributions = registry.contributionsTo<AssistantSurfacePayload>("studio.assistant");
  if (!contributions.length) return null;
  // Cardinality "one": the first registered assistant wins; a second is a
  // registry violation the inspector reports, not a second window.
  const first: Contribution<AssistantSurfacePayload> = contributions[0];
  return (
    <Boundary tier="contribution" source={`${first.from} → studio.assistant`} compact>
      <React.Suspense fallback={null}>
        <ContributionView
          render={(payload) => (payload as AssistantSurfacePayload).render()}
          payload={first.payload}
          from={first.from}
          point="studio.assistant"
        />
      </React.Suspense>
    </Boundary>
  );
}

/**
 * @file `<FloatableCard>` — the user dashboard's card, wrapped in P6's dock
 * engine and gated by P8's per-user switch.
 *
 * ## THE BOUNDARY THIS FILE EXISTS TO STATE
 *
 * **The admin dashboard is the platform's gauges. The user dashboard is the
 * user's own surface. The dock engine is the only thing they share.**
 *
 * They are two dashboards and they stay two. The admin canvas
 * (`modules/accounts/AdminDashboard.tsx`) reads the roster, the storage ledger,
 * the policy cascade, the audit trail and the process itself — facts about the
 * INSTALL, for the one person who administers it. This dashboard shows a person
 * their own studio: what they can launch, what theme they are wearing, what
 * time it is. Not one card, gauge or number crosses between them, and nothing
 * in this phase added an admin composition here.
 *
 * That is not tidiness. The moment a storage total or an audit tail appears on
 * the user dashboard, every member's landing page becomes a surface that has to
 * be gated, and the gate has to be right on every card forever. Keeping the two
 * apart means the user dashboard has no gate to get wrong.
 *
 * What they DO share is the engine — `<Floatable>`, `decide()`, the snap and the
 * flip — because "a panel you can pull out and put back" is a framework
 * capability and not a feature of either screen. Sharing the mechanism while
 * sharing no content is the whole shape of this arrangement.
 *
 * ## Off is today's dashboard, exactly
 *
 * With `floatablePanes` off — the default, and the state of every account that
 * never opts in — this component returns its children untouched. Not a wrapper
 * `div` with no styles: **nothing**. That is what makes "off = exactly today's
 * dashboard" checkable rather than hopeful, and it is the same guarantee
 * `<Floatable>` itself makes one level down.
 *
 * ## Why the grid placement moves onto the wrapper
 *
 * The card is a CSS grid item: its column and row spans are what put it where it
 * is. When the engine is live, `<Floatable>` inserts an element between the grid
 * and the card, and that element becomes the grid item — so the placement has to
 * travel with it or every card auto-flows into the first free cell the moment
 * somebody turns the switch on. Hence `place`: the same two values, applied to
 * whichever element is actually the grid's child. (The card keeps them too; a
 * grid property on a flex child is inert, and a card that carried them only
 * sometimes would be a second thing to keep in step.)
 *
 * `useDockMode()` answers OFF on the server and on the hydrating render, so SSR
 * and the first client paint are the plain grid and the wrappers arrive one
 * commit later as an ordinary repaint — the standing rule, and the reason the
 * switch is read through the hook rather than off the settings document here.
 */
"use client";

import * as React from "react";

import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";

import { Floatable, useDockMode } from "@axf/core";

export interface FloatableCardProps {
  /** The card's registry id. Namespaced into the panel id so a dashboard card
   *  and a toolbar of the same name cannot share an arrangement. */
  id: string;
  /** What the drag handle and the engine's announcements call this. */
  label: string;
  /** Grid placement — `gridColumn` / `gridRow`. See the docblock. */
  place: SxProps<Theme>;
  children: React.ReactNode;
}

/** The id space this screen's panels live in. */
const PANEL_PREFIX = "dashboard.card";

export default function FloatableCard({ id, label, place, children }: FloatableCardProps) {
  const { floatable } = useDockMode();

  // Off: exactly today's dashboard. No element, no wrapper, no arrangement.
  if (!floatable) return <>{children}</>;

  return (
    <Box sx={{ ...(place as object), display: "flex", minWidth: 0, minHeight: 0 }}>
      <Floatable
        id={`${PANEL_PREFIX}.${id}`}
        label={label}
        // A pane, not a bar: it is handed a share of the grid and is expected to
        // occupy all of it, so an intrinsic wrapper would collapse the card to
        // whatever height its content happened to want.
        fill
        // The per-user switch alone, never the admin `Edit UI` mode: a member's
        // own dashboard is theirs to arrange whether or not anybody is editing
        // the app's chrome, and an administrator turning edit mode on must not
        // silently make every member's cards draggable.
        requires="floatable"
        naturalZone="top"
      >
        {children}
      </Floatable>
    </Box>
  );
}

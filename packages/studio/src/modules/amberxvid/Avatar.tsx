"use client";

/**
 * @file The ONE avatar the whole module renders — a thin React wrapper over
 * the deterministic `avatarSvg()` engine (`./lib/avatar`).
 *
 * Every consumer (profile panel, profile viewer, member rows, buddy list,
 * chat, admin window) draws through THIS component, so the same spec is the
 * same pixels on every surface — the renderer is pure, and this wrapper adds
 * nothing but sizing, the circular crop and the no-avatar-yet fallback (the
 * house initial-letter disc the module has used since P1).
 */

import * as React from "react";
import Box from "@mui/material/Box";
import { GX, gxa } from "./kit/gx";
import { avatarSvg, isPortrait, normalizeAvatarValue } from "./lib/avatar";
import type { AvatarValue } from "./lib/types";

export interface AvatarViewProps {
  /** The designed spec, an AI portrait, or null → the initial-letter disc. */
  spec: AvatarValue;
  /** Fallback initial source (screenname, else username). */
  name: string;
  /** Rendered box size in px (square). Default 32. */
  size?: number;
  /** Crop to a circle (rows/chips). Off = full-height portrait card. */
  round?: boolean;
  /** Draw the spec's backdrop panel (portrait mode). Default true. */
  backdrop?: boolean;
}

/**
 * `round` crops the tall 200×220 art to a face-centered circle — right for
 * member rows and chat chips; portrait mode shows the whole figure.
 */
export default function AvatarView({ spec, name, size = 32, round = true, backdrop = true }: AvatarViewProps) {
  // The svg string is deterministic on the spec — memo keeps re-renders cheap
  // for long member lists.
  const svg = React.useMemo(() => {
    const value = normalizeAvatarValue(spec);
    if (!value) return null;
    if (isPortrait(value)) {
      // An AI portrait is already an SVG in the same 200×220 viewBox — it is
      // sized by the wrapper's CSS rather than re-rendered. It passed
      // `sanitizePortraitSvg` at the write door and `normalizeAvatarValue`
      // again on the way in here.
      return value.svg;
    }
    // Round crops zoom toward the face; the backdrop keeps the disc filled.
    return avatarSvg(value, { size: round ? size * 1.6 : size, backdrop });
  }, [spec, size, round, backdrop]);

  const portrait = isPortrait(normalizeAvatarValue(spec));

  if (!svg) {
    return (
      <Box
        aria-label={`${name} (no avatar yet)`}
        sx={{
          width: size,
          height: round ? size : size * 1.1,
          borderRadius: round ? "50%" : 1,
          display: "grid",
          placeItems: "center",
          bgcolor: gxa(GX.accent, "22"),
          color: GX.accent,
          fontSize: Math.max(10, size * 0.42),
          fontWeight: 700,
          flexShrink: 0,
          userSelect: "none"
        }}
      >
        {(name || "?").slice(0, 1).toUpperCase()}
      </Box>
    );
  }

  return (
    <Box
      aria-label={`${name}'s avatar`}
      sx={{
        width: size,
        height: round ? size : size * 1.1,
        borderRadius: round ? "50%" : 1,
        overflow: "hidden",
        flexShrink: 0,
        position: "relative",
        bgcolor: round ? gxa(GX.accent, "14") : "transparent",
        // Face-centered crop: the head sits in the top ~55% of the 200×220
        // frame, so the circle window pins to the art's upper middle.
        // An AI portrait shares that viewBox but scales via CSS (it has no
        // px width of its own), so it is zoomed and pinned here instead.
        "& svg": round
          ? portrait
            ? {
                position: "absolute",
                left: "50%",
                top: 0,
                width: size * 1.6,
                height: size * 1.76,
                transform: "translateX(-50%)",
                display: "block"
              }
            : {
                position: "absolute",
                left: "50%",
                top: 0,
                transform: "translateX(-50%)",
                display: "block"
              }
          : { display: "block", width: "100%", height: "100%" }
      }}
      // Two producers, both trusted by construction: our own pure renderer,
      // or an AI portrait that passed `sanitizePortraitSvg` (allowlisted tags
      // and attributes, our own root element) at the write door and
      // `normalizeAvatarValue`'s hostile-markup backstop on the way here.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

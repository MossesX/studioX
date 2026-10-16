"use client";

/**
 * @file The **catalog** — every graphical asset in the studio as one list of
 * `AssetCard`s, joined with what the filesystem says about the ones that have a
 * filesystem.
 *
 * ## Where each kind comes from, and why it is not all one read
 *
 * P0's `kinds.ts` found three lifecycles, and the read follows them rather than
 * flattening them:
 *
 *   · **`asset-registry`** (`logo_kit`, `x_landing`) — the SOURCE specs are
 *     client-side catalogs (`allLogoKits`, `allXLandings`), which is what the
 *     app actually renders from. `/api/asset-browser` adds the disk facts the
 *     client cannot know: the registry row, the zip, the signature.
 *   · **`code-pack`** (`branding-package`, `logo-package`) — core's in-memory
 *     `PackRegistry`, populated at boot by `PacksSeed`.
 *   · **`chrome-asset`** (`toolbar`, `nav-menu`, `dashboard`) — core's three
 *     surface registries, which hold the shipped assets AND the user-built ones
 *     seeded from the `chrome-assets` kv document.
 *
 * Asking a server about the last two would mean re-deriving in Node what those
 * registries already know — a second answer to a settled question, which is the
 * failure `kinds.ts` exists to prevent. The registries ARE the source of truth
 * for anything in memory, so the browser reads them directly.
 *
 * ## What this file does NOT do
 *
 * It composes; it does not author. Every card's `verbs` and `editable` come
 * from `contract.ts`, and no mutation happens here — P6 onwards adds those
 * behind the engines the contract names. It also draws nothing: the per-kind
 * live previews are P5's, and until they land a card shows its metadata and
 * says which renderer WILL draw it. An honest metadata card beats a fake tile.
 */

import * as React from "react";

import { dashboards, navs, packs, toolbars } from "@axf/core";
import type { NavMenuAsset, ToolbarAsset } from "@axf/core";

import { CONTRACT_BY_KIND, allowedVerbs } from "../../asset-browser/contract";
import type { AssetCard, AssetReference } from "../../asset-browser/contract";
import { GRAPHICAL_KINDS, KIND_BY_ID } from "../../asset-browser/kinds";
import type { GraphicalKind } from "../../asset-browser/kinds";
import { allLogoKits, resolveLogo } from "../../logo-kits/catalog";
import { MOTIONS, drawingFor, isMotionId } from "../../logo-kits/motions";
import { allXLandings } from "../../x-landing/catalog";

import type { DiskAsset, DiskNote, DiskReport } from "./wire";

/**
 * A card plus the browser's own presentation facts.
 *
 * `AssetCard` is P1's contract and is deliberately left exactly as declared —
 * it is what P6-P10's mutation surface reads. Whether a zip is present, whether
 * a manifest parsed, and where the thing lives are facts about the INSTALL, not
 * about the asset, so they ride alongside instead of being smuggled in.
 */
export interface CatalogEntry {
  /** `<kind>:<id>` — see `view.ts`'s `cardKey`. */
  readonly key: string;
  readonly card: AssetCard;
  readonly kind: GraphicalKind;
  /** Present only for the two kinds with a filesystem existence. */
  readonly disk: DiskAsset | null;
  /** A registry flag only — enable/disable never moves a file. */
  readonly enabled: boolean;
  /** Anything wrong with this asset, in the wording the report used. */
  readonly notes: readonly DiskNote[];
}

export interface Catalog {
  readonly entries: readonly CatalogEntry[];
  /** Per kind, in rail order — including kinds with nothing installed. */
  readonly counts: ReadonlyMap<string, number>;
  readonly notes: readonly DiskNote[];
  /** Null until the disk report has answered; `error` when it refused. */
  readonly disk: DiskReport | null;
  readonly diskError: string | null;
  readonly loading: boolean;
}

/* ============================================================ references */

/**
 * A logo kit's references: one per logo's motion, plus one more for the pack
 * drawing a `pack`-engine motion names.
 *
 * The second is not decoration. A `pack` motion's whole animation lives in the
 * branding pack's own SMIL, so a pack swap can leave the id naming nothing and
 * the logo renders as a blank tile — the exact failure a reference graph is for.
 */
function kitReferences(kit: { logos: readonly { motion: string }[] }): AssetReference[] {
  const out: AssetReference[] = [];
  const entries = new Set(
    packs
      .packs("branding-package")
      .flatMap((p) => (p.type === "branding-package" ? p.payload.entries.map((e) => e.id) : []))
  );
  for (const logo of kit.logos) {
    out.push({
      path: "logos[].motion",
      target: "motion",
      id: logo.motion,
      resolved: isMotionId(logo.motion)
    });
    const motion = MOTIONS[logo.motion];
    if (!motion) continue;
    const drawing = drawingFor(motion);
    if (drawing.drawing !== "pack" || !drawing.glyphId) continue;
    out.push({
      path: "logos[].motion→pack entry",
      target: "glyph",
      id: drawing.glyphId,
      resolved: entries.has(drawing.glyphId)
    });
  }
  return out;
}

/** Bar and menu items name pack glyphs, commands, routes and a surface. */
function chromeReferences(asset: ToolbarAsset | NavMenuAsset): AssetReference[] {
  const out: AssetReference[] = [];
  const entries = new Set(
    packs
      .packs("branding-package")
      .flatMap((p) => (p.type === "branding-package" ? p.payload.entries.map((e) => e.id) : []))
  );
  // The surface itself is a reference — a bar declaring one nothing mounts is
  // a bar nobody will ever see, and that is invisible from the asset alone.
  out.push({ path: "surface", target: "surface", id: asset.surface, resolved: true });
  for (const item of asset.items) {
    if ("glyph" in item && typeof item.glyph === "string") {
      out.push({
        path: "items[].glyph",
        target: "glyph",
        id: item.glyph,
        // An empty pack roster would mark every glyph unresolved and say
        // nothing true, so "no packs registered yet" resolves optimistically.
        resolved: entries.size === 0 || entries.has(item.glyph)
      });
    }
    if ("command" in item && typeof item.command === "string") {
      out.push({ path: "items[].command", target: "command", id: item.command, resolved: true });
    }
    if ("route" in item && typeof item.route === "string") {
      out.push({ path: "items[].route", target: "route", id: item.route, resolved: true });
    }
  }
  return out;
}

/* ================================================================= cards */

function card(
  kind: string,
  id: string,
  name: string,
  version: string | null,
  description: string,
  references: AssetReference[],
  raw: unknown,
  overridden = false
): AssetCard {
  const contract = CONTRACT_BY_KIND[kind];
  return {
    id,
    kind,
    name,
    version,
    description,
    preview: contract.preview,
    references,
    editable: contract.editable,
    verbs: allowedVerbs(kind),
    registration: contract.registration,
    overridden,
    raw
  };
}

/**
 * Compose every card from the live registries.
 *
 * Pure with respect to the registries — it reads them and returns; nothing here
 * subscribes. `useCatalog` owns the subscribing, so this stays callable from a
 * test with a seeded registry.
 */
export function composeCards(): AssetCard[] {
  const out: AssetCard[] = [];

  for (const kit of allLogoKits()) {
    out.push(card("logo_kit", kit.id, kit.name, kit.version, kit.description, kitReferences(kit), kit));
  }

  for (const landing of allXLandings()) {
    const logo = landing.assets.logo;
    out.push(
      card(
        "x_landing",
        landing.id,
        landing.name,
        landing.version,
        landing.description,
        [
          {
            path: "assets.logo",
            target: "logo",
            id: logo,
            resolved: resolveLogo(logo) !== null,
            ownerKind: "logo_kit",
            ownerId: logo.split("-")[0]
          },
          { path: "route", target: "route", id: landing.route, resolved: true }
        ],
        landing
      )
    );
  }

  for (const pack of packs.packs("branding-package")) {
    if (pack.type !== "branding-package") continue;
    out.push(
      card(
        "branding-package",
        pack.id,
        pack.name,
        pack.version,
        pack.description,
        // A pack's drawings are what everything else references; the pack
        // itself points at nothing. An empty list is a real answer.
        [],
        pack
      )
    );
  }

  for (const pack of packs.packs("logo-package")) {
    if (pack.type !== "logo-package") continue;
    out.push(card("logo-package", pack.id, pack.name, pack.version, pack.description, [], pack));
  }

  for (const bar of toolbars.snapshot().all) {
    // Chrome assets are not versioned — a bar in a kv document has no semver,
    // and defaulting it to "0.0.0" would read as a version somebody set.
    out.push(card("toolbar", bar.id, bar.title, null, bar.description, chromeReferences(bar), bar));
  }

  for (const menu of navs.snapshot().all) {
    out.push(card("nav-menu", menu.id, menu.title, null, menu.description, chromeReferences(menu), menu));
  }

  for (const wrapper of dashboards.snapshot().all) {
    out.push(card("dashboard", wrapper.id, wrapper.title, null, wrapper.description, [], wrapper));
  }

  return out;
}

/* ============================================================ the join */

/**
 * The whole catalog: the live registries, joined with the disk report, sorted
 * into rail order.
 *
 * Re-reads the registries on every registry notification and re-fetches the
 * disk report when `nonce` changes — the two halves move independently and a
 * single loading flag over both would make a pack registration wait on a fetch.
 */
export function useCatalog(nonce: number): Catalog {
  const [disk, setDisk] = React.useState<DiskReport | null>(null);
  const [diskError, setDiskError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tick, setTick] = React.useState(0);

  // One subscription per registry. `composeCards` reads all four, so any of
  // them changing means the card list is stale — a pack activated at
  // /settings, a bar saved in the theme designer.
  React.useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    const offs = [packs.subscribe(bump), toolbars.subscribe(bump), navs.subscribe(bump), dashboards.subscribe(bump)];
    return () => {
      for (const off of offs) off();
    };
  }, []);

  React.useEffect(() => {
    let live = true;
    setLoading(true);
    fetch("/api/asset-browser", { cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json()) as DiskReport & { error?: string };
        if (!live) return;
        if (!r.ok || body.error) {
          setDisk(null);
          setDiskError(body.error ?? `the catalog route answered ${r.status}`);
          return;
        }
        setDisk(body);
        setDiskError(null);
      })
      .catch((e: unknown) => {
        if (!live) return;
        setDisk(null);
        // A failed fetch is reported, never swallowed: a browser that silently
        // showed source-only cards would claim nothing is installed.
        setDiskError(e instanceof Error ? e.message : "the catalog route could not be reached");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [nonce]);

  return React.useMemo(() => {
    void tick;
    const byId = new Map<string, DiskAsset>();
    for (const a of disk?.assets ?? []) byId.set(`${a.kind}:${a.id}`, a);

    const order = new Map(GRAPHICAL_KINDS.map((k, i) => [k.id, i]));
    const entries: CatalogEntry[] = composeCards()
      .map((c) => {
        const key = `${c.kind}:${c.id}`;
        const d = byId.get(key) ?? null;
        return {
          key,
          card: c,
          kind: KIND_BY_ID[c.kind],
          disk: d,
          // Only a registry row carries an enable switch. Anything in memory is
          // registered by definition, so it is enabled — saying otherwise would
          // invent a switch that does not exist.
          enabled: d ? d.enabled : true,
          notes: d?.notes ?? []
        };
      })
      .sort((a, b) => {
        const ka = order.get(a.card.kind) ?? 99;
        const kb = order.get(b.card.kind) ?? 99;
        return ka === kb ? a.card.id.localeCompare(b.card.id) : ka - kb;
      });

    const counts = new Map<string, number>(GRAPHICAL_KINDS.map((k) => [k.id, 0]));
    for (const e of entries) counts.set(e.card.kind, (counts.get(e.card.kind) ?? 0) + 1);

    return {
      entries,
      counts,
      notes: disk?.notes ?? [],
      disk,
      diskError,
      loading
    };
  }, [disk, diskError, loading, tick]);
}

/** The free-text filter — id, name and description, case-insensitively. */
export function matches(entry: CatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const { id, name, description } = entry.card;
  return (
    id.toLowerCase().includes(q) ||
    name.toLowerCase().includes(q) ||
    description.toLowerCase().includes(q)
  );
}

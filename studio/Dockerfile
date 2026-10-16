# syntax=docker/dockerfile:1
#
# AmberX AI Studio — the studio.amberxai.com image.
#
# Built from the REPO ROOT, not from this directory:
#
#     docker build -f packages/studio/Dockerfile -t amberx-studio .
#
# because the app is one half of a two-package workspace (`@axf/core` ships
# SOURCE and is resolved through a symlink) and because `assets/` — the ledger
# every packaged asset is registered in — lives at the root. A build context of
# `packages/studio` cannot see either, and the failure would not be a build
# error: the image would start and report zero plugins and zero assets.
#
# INITIATION-PROMPT §2 is the authority for the two shapes here:
#   §2.1  the tracer only sees imports  → deploy/runtime-files.mjs declares the
#         rest, and the COPY lines below are generated from it
#         (`npm run deploy:copy-list`), never hand-maintained;
#   §2.2  the filesystem is ephemeral   → `data/` is NOT in this image. It is a
#         mounted volume. See .dockerignore, which refuses it.

# ---------------------------------------------------------------- 1. deps ---
# Its own stage so a source edit does not re-run `npm ci`. Both packages'
# manifests, because the workspace resolves across them.
FROM node:22-bookworm-slim AS deps
WORKDIR /build

COPY packages/core/package.json packages/core/package-lock.json* ./packages/core/
COPY packages/studio/package.json packages/studio/package-lock.json* ./packages/studio/

# `--ignore-scripts`, and each thing it skips accounted for. The stage copies
# manifests ONLY (that is what makes it cacheable), so studio's postinstall —
# `node scripts/link-kit.mjs && node scripts/sync-forge.mjs` — has no scripts/
# to run and fails the install with MODULE_NOT_FOUND. Copying scripts/ in here
# instead would tie this layer's cache to every script edit, which is the one
# property the stage exists for.
#
# What is skipped, and why that is safe:
#   · link-kit  — REQUIRED, and run explicitly in the build stage below, where
#                 the sources actually exist. Nothing is lost.
#   · sync-forge— mirrors forge/ into `.claude/` for the `claude` CLI. That is
#                 developer tooling, gitignored output, and no part of a server.
#   · mediasoup's worker build — the ONLY dependency here with a real install
#                 script. It is used by `src/modules/amberxvid/media-server/`,
#                 which runs as its own process (`npm run media`, :3215) and is
#                 NOT what this image starts. The Next server imports only
#                 `mediasoup/types`, which is erased at compile. Group calls
#                 therefore need that second service deployed separately —
#                 stated here rather than discovered when a call fails.
RUN --mount=type=cache,target=/root/.npm \
    cd packages/core && npm ci --no-audit --no-fund --ignore-scripts && \
    cd ../studio && npm ci --no-audit --no-fund --ignore-scripts

# --------------------------------------------------------------- 2. build ---
FROM node:22-bookworm-slim AS build
WORKDIR /build

COPY --from=deps /build/packages/core/node_modules ./packages/core/node_modules
COPY --from=deps /build/packages/studio/node_modules ./packages/studio/node_modules
COPY packages/core ./packages/core
COPY packages/studio ./packages/studio

# `link:kit` is not cosmetic — core declares @mui/material and @emotion as PEERS
# and carries its own copy so it can typecheck alone, so without the junctions
# the two packages resolve two MUI ThemeContexts and every component silently
# falls back to MUI's default theme. next.config.ts documents the whole failure.
#
# This is also where the deps stage's `--ignore-scripts` is repaid: the same
# script studio's postinstall would have run, run here where scripts/ exists.
# NOT `--if-present` — it is present, and a silent skip would reintroduce
# exactly the silent failure it was written to end.
RUN cd packages/studio && npm run link:kit

# Telemetry off before the build, not after: it phones home during `next build`.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
RUN cd packages/studio && npm run build

# ---------------------------------------------------------------- 3. run ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3200 \
    HOSTNAME=0.0.0.0

# The one persisted directory (§2.2). Declared here so the path exists and is
# owned correctly even before a volume is mounted over it — an unmounted
# container then runs on ephemeral storage rather than crashing on a missing
# directory, which is the difference between "misconfigured" and "broken".
ENV AXS_DATA_ROOT=/data
# The declared slices of the repo, which live outside the tracing root and so
# arrive by COPY rather than by trace. The plugin engine already honours this
# variable, so production needs no code path of its own.
ENV AXF_ASSETS_ROOT=/app/assets
# The app's own root, and NOT optional — this is the one that was measured.
#
# `engineRoots()` probes: a root with `packages/studio/` under it is the SDK
# tree, anything else is treated as a peeled app with `src/` directly beneath.
# The standalone bundle is the second shape (`/app/studio/src/plugins`), but
# `AXF_ROOT` defaults to `cwd/../..`, which from `/app/studio` is `/`. Left
# unset, the engine looks for plugins under `/` and finds none: `/api/plugins`
# returned 0 with all nine manifests sitting correctly in the image. Verified
# by running the standalone bundle locally — 0 plugins without this, 18 with it.
ENV AXF_ROOT=/app/studio

# ffmpeg, for the amberxvid recorder's transcode step.
#
# `recordings.ts › ffmpegPath()` prefers `node_modules/ffmpeg-static` and falls
# through to bare "ffmpeg" on PATH — and ffmpeg-static is not a dependency of
# this package, so PATH is the only route that exists. A slim base has no
# ffmpeg, so without this every recording fails with ENOENT at the moment
# somebody records, not at build time.
#
# It is the largest single thing in the image and that is a real cost, taken
# deliberately: a shipped feature that cannot work in production is worse than
# a larger image. `FFMPEG` overrides the path for a host that supplies its own.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# The Claude CLI, for `/claude`.
#
# `src/server/claudeBroker.ts` spawns the real binary — `spawn("claude", …,
# { shell: true })` — so the workspace route is a transport around the CLI, not
# an API client. Without it on PATH every turn dies with ENOENT the moment
# somebody opens the panel. Exactly the ffmpeg argument above: a shipped
# feature that cannot work in production is worse than a larger image.
#
# NOT PINNED, and that is a debt rather than a decision. An unpinned global
# install means two builds of the same commit can ship different CLIs. Pin it
# as soon as a version is known good here:
#   docker exec amberx-studio claude --version
# then change this to `@anthropic-ai/claude-code@<that version>`.
#
# The `--version` call is the build-time proof: it fails the build if the
# binary did not land on PATH, rather than deferring the discovery to the
# first person who opens the panel.
RUN npm install -g @anthropic-ai/claude-code && \
    claude --version

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs && \
    # `useradd --system` creates NO home directory, so `$HOME` was
    # /home/nextjs pointing at nothing — measured on the running container
    # 2026-08-16, `touch $HOME/.probe` → "No such file or directory". The CLI
    # writes its own state under `$HOME/.claude`, so without this it fails on
    # its first run in a way that reads as a Claude problem rather than a
    # missing directory.
    #
    # It stays ephemeral, and that is now a reason to look elsewhere for the
    # CREDENTIAL rather than a statement about it. This directory is not under
    # /data, so anything the CLI wrote here would be gone on the next
    # `up -d` — which is why `docker-compose.yml` sets
    # `CLAUDE_CONFIG_DIR=/data/claude-cli` (NOT `/data/claude`, which
    # `src/server/claudePaths.ts` already owns) and the sign-in lands in the
    # persisted volume instead. What remains here is scratch state, so it
    # still needs no entry in `runtime-files.mjs`.
    #
    # The sentence that used to end this comment — "authentication comes from
    # ANTHROPIC_API_KEY in the environment, not from a persisted login" — was
    # WRONG in both halves and is corrected rather than deleted, because it is
    # the belief that left production unable to answer a single turn.
    # `src/server/claudeBroker.ts` reads no `ANTHROPIC_API_KEY`; a persisted
    # login is exactly what this path uses.
    mkdir -p /home/nextjs && \
    chown nextjs:nodejs /home/nextjs

# The standalone server, plus `.next/static`, which Next's own docs say it does
# not copy for you.
#
# The bundle's internal layout is relative to `outputFileTracingRoot`
# (`packages/`), so the app lands at `studio/`, NOT `packages/studio/` — every
# path below and the CMD depend on that and were wrong until the bundle was
# actually listed. `public/` is deliberately absent from these lines, and the
# reason CHANGED on 2026-08-22 — it used to be "this package has no `public/`
# directory, and a COPY of a path that does not exist fails the build outright".
# It has one now (`sw.js`, `icon.svg` — the PWA/push half). No COPY line was
# added for it because it is DECLARED instead, as the `pwa-static` group in
# `deploy/runtime-files.mjs` with `trace: true`: `next build` then places it
# inside `.next/standalone` itself, at `studio/public/`, which is exactly where
# the first COPY below already brings it. A second copy path would be a second
# thing to keep in step.
COPY --from=build --chown=nextjs:nodejs /build/packages/studio/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /build/packages/studio/.next/static ./studio/.next/static

# The declared repo slices, copied from the BUILD CONTEXT rather than from the
# build stage: they are inputs to the running app, not to the compilation, so
# routing them through a stage that never reads them would only make the build
# cache churn on an asset edit.
# >>> BEGIN GENERATED COPY LIST — `npm run deploy:copy-list` (do not edit) <<<
# asset-ledger — The document of record for every packaged asset — which are installed and which are enabled.
COPY --chown=nextjs:nodejs assets/registry.json /app/assets/registry.json
# installed-assets — The asset payloads the ledger points at.
COPY --chown=nextjs:nodejs assets/installed /app/assets/installed
# retired-assets — Where a renamed id's installed dir and zip are archived (P9).
COPY --chown=nextjs:nodejs assets/retired /app/assets/retired
# >>> END GENERATED COPY LIST <<<

RUN mkdir -p /data && chown -R nextjs:nodejs /data /app
VOLUME ["/data"]

USER nextjs
EXPOSE 3200

# No HEALTHCHECK curl: the slim image has none, and adding curl to run one
# check is a package on the attack surface for a line Traefik already does
# better. `/api/health` is the endpoint; compose declares the check.

# `studio/`, not `packages/studio/` — see the COPY note above.
CMD ["node", "studio/server.js"]

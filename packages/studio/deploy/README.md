# studio.amberxai.com — the deployment

Everything the container needs, and the reasoning behind the parts that look
optional but are not. `INITIATION-PROMPT.md` §2 is the authority; this is how it
was actually built on 2026-08-15.

## The pieces

| File | What it is |
| --- | --- |
| `../Dockerfile` | Three stages: deps, build, runner. Built from the **repo root**. |
| `../../../.dockerignore` | Keeps `data/` and `.env` out of the build context. **Load-bearing** — see below. |
| `runtime-files.mjs` | The single declaration of runtime file dependencies and the one persisted root. |
| `docker-compose.yml` | Traefik routing, basic auth, the volume, the health check. No published ports. |
| `seed-data.sh` | One-shot seed of the volume from a dev `data/` tree. |
| `../scripts/deploy-copy-list.mjs` | Generates the Dockerfile's COPY block from the declaration. |
| `../scripts/check-runtime-files.mjs` | `npm run check:runtime-files` — the §2 gate. |

## The host, and how GizmoX stays untouched

`gizmox-vps` (31.97.13.252) runs Coolify. `amberxai.com` is **GizmoX** —
container `gizmox-web-green`, routed by Traefik's **file** provider from
`/data/coolify/proxy/dynamic/amberxai.yaml`. That file, that container and
`/opt/gizmox/gizmox-app` are none of this deployment's business: nothing here
reads or writes them, and GizmoX's own `deploy/redeploy.sh` (which `rm -rf`s its
app dir and flips the file provider) is never invoked.

This app arrives beside it and shares only the proxy network:

| | GizmoX | AmberX Studio |
| --- | --- | --- |
| host | `amberxai.com`, `www.` | `studio.amberxai.com` |
| container | `gizmox-web-green` | `amberx-studio` |
| routed by | Traefik **file** provider | Traefik **docker** provider (labels) |
| router names | `amberxai-*` | `amberx-studio*` |
| storage | image layer + `/app/.gizmox` | volume `amberx-studio-data` → `/data` |

Facts measured on the host 2026-08-16, because three of them contradicted the
upstream defaults this file was first written against:

- entrypoints are **`http`** and **`https`**, not `web`/`websecure`. A router on
  an entrypoint that does not exist is not an error — it simply never serves.
- the shared network is **`coolify`**, not `traefik`.
- cert resolver **`letsencrypt`** (correct as guessed).
- `--providers.docker=true --providers.docker.exposedbydefault=false`, so labels
  work and `traefik.enable=true` is the opt-in.

## First deploy

```bash
# on the host, beside a checkout of this repo
cp packages/studio/deploy/.env.example packages/studio/deploy/.env
# edit it: STUDIO_BASIC_AUTH, TRAEFIK_NETWORK, STUDIO_DATA_VOLUME
htpasswd -nbB <user> '<password>'     # then double every $ for compose

docker compose -f packages/studio/deploy/docker-compose.yml up -d --build
docker compose -f packages/studio/deploy/docker-compose.yml logs -f studio
```

Then seed the volume (the owner chose the full `data/` copy):

```bash
scp -r packages/studio/data <host>:/tmp/studio-seed
ssh <host> 'bash -s' < packages/studio/deploy/seed-data.sh /tmp/studio-seed
```

## Two things that will bite whoever changes this next

**1. `.dockerignore` is the only thing keeping `data/` and `.env` out of the
image.** `outputFileTracingExcludes` was the obvious mechanism and it does not
work for these: `proxy.ts` is middleware, middleware imports the accounts session
code, and Next applies route-keyed include/exclude lists to routes rather than to
the middleware trace. Measured, not assumed — `data/accounts` is listed in
`server/middleware.js.nft.json` after a build. The excludes are still there and
still do useful work (`test/`, `scripts/`, `captures/`), but the guarantee lives
in `.dockerignore`.

**2. The COPY block in the Dockerfile is generated.** Edit
`runtime-files.mjs`, then `npm run deploy:copy-list`. `npm run
check:runtime-files` fails when the two have drifted, and it is the same command
that catches a module reading a path nothing declares or writing outside the
persisted root.

## What does not work in the container, by design

The Build Manager (`/buildmgr`), the MCP roster and Agent Forge's repo scopes all
reach a tree that exists on one workstation. They find nothing and list nothing.
That is correct — see `REPO_ROOT_READERS` in `check-runtime-files.mjs`, which
names each one and why.

## `AXF_ROOT` is required, and here is how that was found

The standalone bundle's internal layout is relative to `outputFileTracingRoot`,
so the app lands at `studio/`, not `packages/studio/`. `AXF_ROOT` defaults to
`cwd/../..`, which from `/app/studio` is `/` — so `engineRoots()` looked for
plugins under `/`, found none, and `/api/plugins` returned **0 with all nine
manifests correctly present in the bundle**. Exactly the §2.1 shape of failure
(nothing errors, a screen just renders empty) arriving through root resolution
rather than through a missing file.

Running the bundle locally with `AXF_ROOT` set to it: **18 plugins**. The
Dockerfile and compose both set it now.

## Verified locally on 2026-08-15

- `npm run typecheck` clean.
- `npm run check:runtime-files` clean over 598 server files.
- `NEXT_DIST_DIR=.next-prod npm run build` produces
  `.next-prod/standalone/studio/server.js`, with `@axf/core` traced in, 9 plugin
  manifests and the 12-file forge roster present.
- That bundle **run as a real production server**: `/api/health` 200 with
  `storage.ok` true against an `AXS_DATA_ROOT` pointed at a scratch directory
  (so the env override and the write probe are both proven), `/api/plugins` 200
  with 18 plugins, `/settings` 200.

**Not verified:** the image build, the container run, the Traefik routing and the
seed script. There is no Docker on the development machine, so `Dockerfile`,
`docker-compose.yml` and `seed-data.sh` have never been executed. First run on
the host is their first run — expect to iterate on them there, and treat the
first `docker compose up --build` as part of the work rather than as a formality.

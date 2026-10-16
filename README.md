# studioX
amberx-studio project — the source behind the `amberx-studio` container at studio.amberxai.com.

Two-package workspace (`packages/core`, `packages/studio`) plus the `assets/` ledger.

Build the image from the repo root, not from `packages/studio`:

    docker build -f packages/studio/Dockerfile -t deploy-studio .
    docker compose -f packages/studio/deploy/docker-compose.yml up -d

Copy `packages/studio/deploy/.env.example` to `.env` beside it and fill it in. `.env`, `.auth-secret`, `data/`, `node_modules/` and `.next/` are gitignored and must stay out of the repo.

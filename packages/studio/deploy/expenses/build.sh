#!/usr/bin/env bash
# expenses.amberxai.com — peel, overlay, build, deploy. Run from anywhere.
#
#   packages/studio/deploy/expenses/build.sh            # everything
#   packages/studio/deploy/expenses/build.sh --no-up    # stop before compose up
#
# The peel needs Node >= 23 (native type stripping) and the host has 20, so it
# runs in a throwaway node:alpine container over a bind mount of the repo.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
OUT="$ROOT/peeled/expenses"
TAG="${TAG:-amberx-expenses:latest}"

echo "== 1. peel (expenses + accounts companion) =="
docker run --rm -v "$ROOT":/w -w /w/packages/studio node:alpine \
  node scripts/peel.mjs expenses --with accounts --port 3200 --yes --no-agent 2>&1 | grep -v -E 'WARNING|MODULE_TYPELESS|Reparsing|eliminate this warning|trace-warnings'

echo "== 2. overlay (session gate, /login, .dockerignore) =="
cp -R "$HERE/overlay/." "$OUT/"

echo "== 3. docker build $TAG =="
docker build -f "$HERE/Dockerfile" -t "$TAG" "$OUT"

if [ "${1:-}" = "--no-up" ]; then echo "built $TAG; skipping compose up"; exit 0; fi
echo "== 4. compose up =="
docker compose -f "$HERE/docker-compose.yml" up -d
docker compose -f "$HERE/docker-compose.yml" ps

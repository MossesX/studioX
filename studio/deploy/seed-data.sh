#!/usr/bin/env bash
# Seed the production volume from a dev `data/` tree — ONCE, deliberately.
#
#     scp -r packages/studio/data <host>:/tmp/studio-seed
#     ssh <host> 'bash -s' < packages/studio/deploy/seed-data.sh /tmp/studio-seed
#
# Why this is a script and not a COPY in the Dockerfile: §2.2. A `data/` baked
# into the image sits UNDER the volume mount, so it appears to work on the first
# boot of a fresh volume and is invisible for every write after — the mount wins,
# the baked copy is shadowed, and a redeploy looks like it ate the data. Seeding
# has to target the volume itself, which means it happens on the host, after the
# volume exists, exactly once.
#
# The owner asked for the FULL tree (2026-08-15): all 14 accounts, amberxvid
# vaults, expenses, Claude conversations, the taskman archive and the kv
# settings store. Two things travel differently and are worth knowing before you
# run this:
#
#   - `.auth-secret` is NOT copied (see EXCLUDES). It is the HMAC the session
#     cookies are signed with, it is gitignored, and it is per install. The
#     container generates its own on first use, so everyone signs in again.
#     Passwords still work — they are scrypt hashes inside accounts.json.
#   - Browser-side settings do not exist in this tree at all. The branding pack,
#     the theme and the layout live in localStorage plus the `axf_packs` cookie,
#     per browser profile. Production starts on the app defaults.
#
# Refuses to overwrite a volume that already holds accounts, because "seed"
# and "restore over the top of live data" are different operations and only one
# of them was asked for.

set -euo pipefail

SEED_SRC="${1:-}"
VOLUME="${STUDIO_DATA_VOLUME:-amberx-studio-data}"
CONTAINER="${STUDIO_CONTAINER:-amberx-studio}"

if [[ -z "$SEED_SRC" ]]; then
  echo "usage: seed-data.sh <path to a data/ tree on this host>" >&2
  exit 2
fi

if [[ ! -d "$SEED_SRC/accounts" ]]; then
  echo "seed: '$SEED_SRC' has no accounts/ — that is not a studio data tree." >&2
  exit 1
fi

# Never seed over a live store.
if docker run --rm -v "$VOLUME:/data" alpine test -f /data/accounts/accounts.json 2>/dev/null; then
  echo "seed: volume '$VOLUME' already holds accounts/accounts.json." >&2
  echo "      Seeding is a one-shot for an EMPTY volume. To replace a live store," >&2
  echo "      back it up and remove the volume deliberately:" >&2
  echo "        docker compose down && docker volume rm $VOLUME" >&2
  exit 1
fi

# Secrets and machine-local state never travel.
EXCLUDES=(
  --exclude ".auth-secret"     # per-install session HMAC; regenerated on use
  --exclude "locks"            # cross-process lock files from another machine
  --exclude "*.tmp"
  --exclude ".health-probe"
)

echo "seed: $SEED_SRC → volume $VOLUME"
docker run --rm \
  -v "$VOLUME:/data" \
  -v "$(cd "$SEED_SRC" && pwd):/seed:ro" \
  alpine sh -c "apk add --no-cache rsync >/dev/null && rsync -a ${EXCLUDES[*]} /seed/ /data/ && chown -R 1001:1001 /data"

echo "seed: done. Accounts on the volume:"
docker run --rm -v "$VOLUME:/data" alpine sh -c \
  "grep -o '\"username\":[^,]*' /data/accounts/accounts.json | sed 's/\"username\"://'"

echo
echo "seed: restart the app so every store re-reads its root:"
echo "  docker restart $CONTAINER"

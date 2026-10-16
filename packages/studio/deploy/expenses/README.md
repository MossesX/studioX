# expenses.amberxai.com

The Expense Tracker peeled out of the studio into its own app: banner, no
navigation menus, the `accounts` module riding along as the companion that owns
sign-in and per-user storage.

```
packages/studio/deploy/expenses/build.sh     # peel → overlay → build → compose up
```

- `build.sh` — runs `npm run peel expenses --with accounts` (in a node:alpine
  container, the peel needs Node ≥ 23), copies `overlay/` onto `peeled/expenses/`,
  builds `amberx-expenses:latest` and starts the `amberx-expenses` container.
- `overlay/` — the two files the generated app lacks for a public deployment:
  `proxy.ts` (session gate over every page) and `app/login/page.tsx`. Re-applied
  on every build because the peel wipes its output tree.
- `Dockerfile` — builds the peeled directory; `docker-compose.yml` — Traefik
  route for `expenses.amberxai.com`, no host port, shared `coolify` network.
- Data: the container mounts the studio's `amberx-studio-data` volume, so the
  ledger and the accounts are the same ones studio.amberxai.com uses (see the
  compose file for the reasoning and the way to split them).
- DNS: `expenses.amberxai.com` needs an A record to this host; Traefik issues
  the Let's Encrypt certificate on the first request once it resolves.

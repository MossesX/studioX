/**
 * @file Development auto-login — and above all, the proof it cannot reach
 * production.
 *
 * This feature deliberately removes the studio's front gate, so the test that
 * earns its keep is not "does it sign Brett in" but "is it impossible for a
 * production build to". The three conditions live in `lib/devAuth.ts`; each is
 * asserted here, including the one that only fails on a badly configured
 * production machine, which is exactly the case nobody exercises by hand.
 */

import assert from "node:assert/strict";
import test from "node:test";

/* A file URL, not the `@axs/*` alias: the cache-busting query below is part of
 * the specifier, and the alias hook resolves bare names only. */
const MODULE = new URL("../src/modules/accounts/lib/devAuth.ts", import.meta.url).href;

/**
 * Load a FRESH copy of the module with the environment set, and run `fn`
 * against it WHILE it is still set.
 *
 * The two conditions are read at different times, deliberately, and the helper
 * has to respect that or it tests nothing:
 *
 *   · `NODE_ENV` is snapshotted at MODULE SCOPE (`IS_PRODUCTION`) so no request
 *     can flip it — which is why each case needs a fresh module instance, hence
 *     the cache-busting query.
 *   · `AXF_DEV_USER` is read at CALL time, so a developer can change who they
 *     are signed in as without restarting.
 *
 * The first draft of this helper restored the environment in `finally` and then
 * returned the module, so every assertion ran against a `process.env` that no
 * longer had the variable. It reported `null` for cases that should have been
 * "Brett" — a green-looking test of nothing.
 */
async function withEnv<T>(
  env: { NODE_ENV?: string; AXF_DEV_USER?: string },
  nonce: number,
  fn: (m: {
    devAuthUser: () => string | null;
    isDevAuthActive: () => boolean;
    DEV_USER_ENV: string;
  }) => T
): Promise<T> {
  const prevNode = process.env.NODE_ENV;
  const prevUser = process.env.AXF_DEV_USER;
  if (env.NODE_ENV === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = env.NODE_ENV;
  if (env.AXF_DEV_USER === undefined) delete process.env.AXF_DEV_USER;
  else process.env.AXF_DEV_USER = env.AXF_DEV_USER;
  try {
    const m = (await import(`${MODULE}?dev-auth-case=${nonce}`)) as {
      devAuthUser: () => string | null;
      isDevAuthActive: () => boolean;
      DEV_USER_ENV: string;
    };
    return fn(m);
  } finally {
    if (prevNode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNode;
    if (prevUser === undefined) delete process.env.AXF_DEV_USER;
    else process.env.AXF_DEV_USER = prevUser;
  }
}

test("dev auth: PRODUCTION never auto-logs in, even when configured to", async () => {
  // The one that matters. A production build with the variable set — the exact
  // misconfiguration a copied .env or a leaked deploy script produces — must
  // still refuse, and refuse loudly.
  const errors: unknown[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => void errors.push(args.join(" "));
  try {
    await withEnv({ NODE_ENV: "production", AXF_DEV_USER: "Brett" }, 1, (m) => {
      assert.equal(m.devAuthUser(), null, "production must never auto-log in");
      assert.equal(m.isDevAuthActive(), false);
    });
    assert.ok(
      errors.some((e) => String(e).includes("IGNORED")),
      "a production build configured for auto-login must say so loudly, not ignore it silently"
    );
  } finally {
    console.error = realError;
  }
});

test("dev auth: development WITHOUT the env var behaves exactly as before", async () => {
  // Running `next dev` is not consent. A developer who has not opted in gets
  // the real gate, and so does CI.
  await withEnv({ NODE_ENV: "development" }, 2, (m) => {
    assert.equal(m.devAuthUser(), null);
    assert.equal(m.isDevAuthActive(), false);
  });
});

test("dev auth: development WITH the env var names the account", async () => {
  await withEnv({ NODE_ENV: "development", AXF_DEV_USER: "Brett" }, 3, (m) => {
    assert.equal(m.devAuthUser(), "Brett");
    assert.equal(m.isDevAuthActive(), true);
  });
});

test("dev auth: an empty or whitespace-only value is not an opt-in", async () => {
  for (const [i, value] of ["", "   "].entries()) {
    await withEnv({ NODE_ENV: "development", AXF_DEV_USER: value }, 10 + i, (m) => {
      assert.equal(m.devAuthUser(), null, `${JSON.stringify(value)} must not enable auto-login`);
    });
  }
});

test("dev auth: the value is trimmed, so a stray newline in .env still works", async () => {
  await withEnv({ NODE_ENV: "development", AXF_DEV_USER: "  Brett \n" }, 20, (m) => {
    assert.equal(m.devAuthUser(), "Brett");
  });
});

test("dev auth: the proxy looks the account up rather than trusting the name", async () => {
  /*
   * `devAuthUser()` returns a NAME, never an account or a role. That split is
   * the safety property: the gate has to resolve it against the real store, so
   * a typo or a deleted user signs nobody in, and the minted token carries the
   * account's true role instead of an invented one.
   */
  const proxySrc = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../proxy.ts", import.meta.url), "utf8")
  );
  assert.match(proxySrc, /devAuthUser\(\)/, "the proxy must ask devAuth, not read the env var itself");
  assert.match(proxySrc, /findAccount\(devUser\)/, "the proxy must look the dev user up in the real account store");
  assert.match(
    proxySrc,
    /issueAxsSession\(devAccount\)/,
    "the proxy must mint a real session from the real account, not fabricate a payload"
  );
});

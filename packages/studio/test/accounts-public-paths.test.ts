/**
 * @file The signed-out allow-list (`lib/publicPaths`), which is the one module
 * a lock-out can come from.
 *
 * `proxy.ts` and the accounts store both decide what to do about a missing
 * session by asking this file, and both of them answer with a redirect. So the
 * failure mode is not "a page renders when it should not" — it is a LOOP: get
 * `/login` wrong in either direction and the studio either bounces the login
 * screen to itself forever, or hands a freshly-authenticated visitor straight
 * back to the gate. Neither has a way out from inside the browser.
 *
 * These are therefore assertions about the two shapes that loop (`/login` must
 * be public, and no `next` may ever point at a public path) and the one that
 * leaks (an absolute or scheme-bearing `next` is an open redirect), rather
 * than a walk over the list's current contents.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LOGIN_PATH,
  PUBLIC_PATHS,
  isPublicPath,
  safeNext,
} from "@axs/modules/accounts/lib/publicPaths";

test("the login screen is public — the gate redirects to it", () => {
  assert.equal(isPublicPath(LOGIN_PATH), true);
  assert.equal(isPublicPath(`${LOGIN_PATH}/`), true, "a trailing slash is the same screen");
  assert.ok(PUBLIC_PATHS.includes(LOGIN_PATH));
});

test("the invitation landing is public, prefix and all — a stranger has no session", () => {
  assert.equal(isPublicPath("/amberxvid/invite"), true);
  assert.equal(isPublicPath("/amberxvid/invite/9f3a2b"), true);
  // The prefix must not leak sideways into the module it lives under.
  assert.equal(isPublicPath("/amberxvid"), false);
  assert.equal(isPublicPath("/amberxvid/invites"), false);
});

test("every other route is gated", () => {
  for (const path of ["/", "/buildmgr", "/accounts", "/taskman", "/login-ish"]) {
    assert.equal(isPublicPath(path), false, `${path} must not be public`);
  }
});

test("safeNext refuses anything that would leave this origin", () => {
  assert.equal(safeNext("//evil.example/steal"), "/");
  assert.equal(safeNext("https://evil.example"), "/");
  assert.equal(safeNext("evil.example"), "/");
  assert.equal(safeNext("/\\evil.example"), "/");
  assert.equal(safeNext(null), "/");
  assert.equal(safeNext(""), "/");
});

test("safeNext refuses a public path — that is the loop", () => {
  assert.equal(safeNext(LOGIN_PATH), "/");
  assert.equal(safeNext(`${LOGIN_PATH}?next=%2Flogin`), "/");
});

test("safeNext keeps a real destination, query and all", () => {
  assert.equal(safeNext("/buildmgr"), "/buildmgr");
  assert.equal(safeNext("/amberxvid?tab=library"), "/amberxvid?tab=library");
});

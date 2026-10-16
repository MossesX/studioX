import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import {
  AxfHydrationTheme,
  PACKS_COOKIE,
  THEME_COOKIE,
  defaultValues,
  packs,
  parseThemeCookie,
  resolveVariables,
  themeBootScript,
  valuesFrom,
  variablesStyleBlock
} from "@axf/core";

import StudioShell from "../src/StudioShell";
import PacksSeed from "../src/PacksSeed";
import { seedDefaultIdentity } from "../src/packs/default-identity";
import { readChromeAssets } from "../src/chrome/store";

/**
 * The cascade layer order, declared ONCE and before anything can use one.
 *
 * Declared here rather than in a stylesheet because there is no stylesheet yet
 * — this app has zero `.css` files today — and that is precisely the moment to
 * fix the order. An `@layer` statement establishes precedence by the order the
 * NAMES first appear, so whichever rule happens to be parsed first would
 * otherwise decide it, and later layers would have to be added around whatever
 * that turned out to be.
 *
 * Later layers win. So `axf` after `mui` means AmberX's own rules beat MUI's
 * without needing to out-specify them — no `!important`, no `&&` doubling, no
 * selector arms race.
 *
 * **The trap this does NOT close, stated so nobody rediscovers it:** an
 * UNLAYERED rule beats every layered rule, at any specificity. That is not a
 * quirk to work around, it is the spec. GizmoX paid for it — a `*` reset in an
 * unlayered `globals.css` collapsed every MUI TextField in the app, and no
 * amount of specificity in `@layer mui` could have stopped it. So the rule for
 * this codebase is: **every stylesheet AmberX adds goes inside `@layer axf`.**
 * `scripts/check-css-layers.mjs` enforces it on the first `.css` file that
 * exists, which is why it is being written now rather than after one does.
 */
const LAYER_ORDER = "@layer mui, axf;";

export const metadata = {
  title: "AmberX AI Studio",
  description: "The SDK subsystem — authoring infrastructure over @axf/core."
};

/**
 * Two writers in the head, in order, and the order is the whole point.
 *
 * 1. The DEFAULT theme as a real `:root` block. It is the FLOOR — every
 *    variable has a value before anything else runs, so a first-ever visitor,
 *    a private-mode browser and a corrupt cache all get a themed page rather
 *    than an unstyled one. Emitting a guess at the persisted theme here instead
 *    is not an option: the server cannot read `localStorage`, and a guess is a
 *    visible flip when it is wrong.
 *
 * 2. A blocking script that replays the variables the previous visit resolved,
 *    onto `documentElement`, before the browser paints. This is what removes
 *    the flash the owner reported — "a theme loads quick for 1 second before
 *    rendering the theme that sticks". Without it the page necessarily paints
 *    the default and corrects itself after hydration, because `AxfStyleRoot`
 *    publishes in a layout effect and there is nothing earlier than `<head>`.
 *    It applies only a cache it can prove was resolved from the theme that is
 *    stored right now; anything else and the default block above stands. See
 *    `theme/boot.ts`.
 *
 * `<AxfStyleRoot>` then takes over for the life of the page, diffing against
 * what is already on the element — so the handover writes nothing.
 */
/**
 * Parse the pack-selection cookie. Returns `undefined` when it is absent or
 * unreadable, which seeds nothing — a corrupt preference must never be the
 * reason a page fails to render.
 */
function readPacksCookie(jar: Awaited<ReturnType<typeof cookies>>): unknown {
  const raw = jar.get(PACKS_COOKIE)?.value;
  if (!raw) return undefined;
  try {
    return JSON.parse(decodeURIComponent(raw));
  } catch {
    return undefined;
  }
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  /**
   * Which packs THIS request chose, read from the cookie mirror.
   *
   * A pack's drawings are markup, so unlike the theme variables they cannot be
   * corrected by the pre-paint boot script — the server has to emit the right
   * ones or every glyph swaps after hydration. `localStorage` is invisible
   * here; the cookie is the only thing the server can see.
   *
   * It is handed DOWN as a prop rather than applied to `packs` here, because
   * this file is in the server module graph and the components that resolve a
   * pack are in the client one — two graphs, two singletons. `<PacksSeed>`
   * applies it on the other side; its docblock has the full account.
   *
   * A missing or unreadable cookie seeds nothing and both runtimes fall back to
   * the app defaults together — the old behaviour, which flashed but was never
   * wrong.
   */
  const jar = await cookies();
  const packsSelection = readPacksCookie(jar);

  /**
   * The applied THEME for this request, from its own cookie mirror.
   *
   * Same argument as the packs cookie one paragraph up, for the half that
   * argument did not cover. Custom properties are correctable before paint (the
   * boot script does it), so the theme needed no cookie while every themed
   * surface read `var(--axf-*)`. MUI does not: `mui.ts` refused `cssVariables`
   * mode because MUI runs `alpha()`/`darken()`/`getContrastRatio()` over real
   * palette values, so emotion serialises literal hex into the SSR'd CSS — which
   * the browser paints before React hydrates and nothing later can correct.
   *
   * That was the ~1s "different theme on load" the owner reported 2026-08-12.
   * `MuiBridge`'s layout effect already fixed the post-hydration half; this
   * fixes the half that happens before React exists on the page.
   *
   * Null on a first visit, and then everything behaves as it did before.
   */
  const appliedTheme = parseThemeCookie(jar.get(THEME_COOKIE)?.value);
  const initialValues = appliedTheme ? valuesFrom(appliedTheme) : null;

  /**
   * The head block, composed through the ONE resolver — theme AND pack.
   *
   * It used to be `themeStyleBlock(values)`, the theme alone, and that left a
   * real gap: a branding pack owns the identity roles (`accent`, `ok`, `warn`,
   * `err`), so the document painted the THEME's accent and every `token()`
   * surface shifted to the PACK's once `AxfStyleRoot` published after
   * hydration. Measured 2026-08-12 — server `#b53c09`, live `#ff7a1a`.
   *
   * ## Why `packs` is seeded HERE as well as in `<PacksSeed>`
   *
   * Not a duplicate. `PacksSeed`'s docblock is the authority: `layout.tsx` is a
   * SERVER component and `Glyph` is a CLIENT one, so Next compiles them into two
   * module graphs with **two `packs` singletons**. Seeding only the client one
   * leaves this file's registry on the app defaults — which is exactly the bug
   * that docblock records, in reverse. This call seeds the graph that builds the
   * STRING below; `PacksSeed` seeds the graph that renders the glyphs. Each is
   * the only way to reach its own instance.
   *
   * The process-global caveat `applyServerSelection` documents applies and is
   * unchanged: two concurrent requests with different cookies can race, which is
   * accepted for a local single-operator studio and is not acceptable for a
   * multi-user deployment. The fix when that day comes is request-scoping
   * (`cache()` / AsyncLocalStorage), not a lock.
   */
  // Identity first, then the selection — `applyServerSelection` drops the
  // memoised server snapshot, so seeding after it would leave that snapshot
  // holding the identity that was in force before the packs existed. Same call
  // and same order as `<PacksSeed>`; see `packs/default-identity.ts` for why it
  // has to happen in both graphs rather than once.
  seedDefaultIdentity();
  packs.applyServerSelection(packsSelection);
  const serverStyle = packs.serverResolved();
  const headVariables = resolveVariables(initialValues ?? defaultValues(), {
    variables: serverStyle.variables
  });

  /**
   * User-authored toolbars and nav menus, read from disk HERE (the only graph
   * with `node:fs`) and handed to `<PacksSeed>` to register inside the client
   * graph — where `Toolbar` and `NavShell` will resolve them, during SSR and
   * hydration alike. A theme naming a custom banner therefore server-renders
   * that banner; without this hand-off it would flash the default bar first.
   */
  const chromeAssets = await readChromeAssets();

  return (
    // The boot script sets `style` on this element before React hydrates it.
    // That is an attribute React did not render, which is what this suppresses
    // — one element deep, so a genuine mismatch anywhere below still reports.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* FIRST, and its own tag. An @layer statement fixes the order at the
            point the names are first seen, so it has to precede MUI's inserted
            styles — which arrive later in this same head via
            useServerInsertedHTML. Kept separate from the theme block below so
            that neither can be reordered without it being obvious. */}
        <style dangerouslySetInnerHTML={{ __html: LAYER_ORDER }} />
        {/* The APPLIED theme composed with the ACTIVE PACK, which together are
            what the app actually renders. The boot script below still runs and
            still wins where it has a cache — the two agree by construction,
            since both compose the same record through the same resolver — but
            the block is no longer a placeholder to be corrected. A visitor with
            cookies and no vars cache (a new device, a cleared cache) now gets
            the right first paint from this tag alone. */}
        <style dangerouslySetInnerHTML={{ __html: variablesStyleBlock(headVariables) }} />
        <script dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
      </head>
      <body
        style={{
          margin: 0,
          background: "var(--axf-page)",
          color: "var(--axf-ink)",
          fontFamily: "var(--axf-sans)",
          fontSize: "var(--axf-size-body)"
          // NO transition here, deliberately. `transition: background
          // var(--axf-motion) …` latched body's paint at the server-rendered
          // default palette: when AxfStyleRoot republished the restored theme
          // on <html> during hydration, the transition froze mid-flight and
          // body kept the old --axf-page for the life of the page while every
          // other element resolved the new value — so each screen appeared to
          // have its own theme depending on how much body showed through.
          // Verified live 2026-08-09: removing the transition snapped body
          // from #0e1013 to the active #080706 instantly.
        }}
      >
        {/* MUI's Emotion cache, for ONE reason: `enableCssLayer`.
         *
         * Not for the SSR flush — that was measured before this was added and
         * Emotion already streams its styles into this document unaided (the
         * SSR HTML carried 17 `data-emotion` tags with the real rules in them,
         * so there was no unstyled flash to fix). Adding this "because MUI's
         * Next guide says to" would have been cargo, and the note would have
         * claimed a benefit that was already there.
         *
         * What it genuinely supplies is the layer. MUI 9.3 does NOT ship inside
         * `@layer mui` by default — `enableCssLayer` is opt-in on the styled
         * engine, and the cache it needs can only come from a provider. Without
         * it every MUI rule is unlayered, which means the first AmberX
         * stylesheet would have to win by specificity, and `LAYER_ORDER` above
         * would be describing an order nothing had joined.
         *
         * It also gives the layered cache its own key (`mui`), which is what
         * stops an identically-hashed unlayered `.css-*` class colliding with a
         * layered one and quietly beating it. */}
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          {/* One shell for every route — banner, nav, style root and the MUI
              theme provider mount here, never per page. A page that mounts its
              own is the drift this arrangement exists to stop. */}
          {/* The server-read theme, handed to the client graph the same way the
              pack selection is. `AxfMuiRoot` builds its FIRST theme from this
              on both sides, so the SSR'd MUI palette and the hydrating render
              agree — on the applied theme rather than on the defaults. */}
          <AxfHydrationTheme values={initialValues}>
            <PacksSeed selection={packsSelection} chromeAssets={chromeAssets}>
              <StudioShell>{children}</StudioShell>
            </PacksSeed>
          </AxfHydrationTheme>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}

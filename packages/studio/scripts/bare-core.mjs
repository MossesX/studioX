/**
 * `npm run bare` — generate the BARE-CORE boot fixture
 * (INITIATION-PROMPT.md §5.1 tier 3, fixture 1).
 *
 * "An app with zero SDK assets installed boots, renders the shell and serves
 * its health route, in CI, with Studio's data directory deleted."
 *
 * This is the behavioural half of the isolation boundary — the one that
 * catches the leaks no import scan can see: core hardcoding a string-keyed
 * SDK id, a shared event bus where core listens for an SDK-named event,
 * core's store schema growing an SDK-shaped field. If any of those exist,
 * an app made of NOTHING BUT CORE either fails to boot, fails its health
 * checks, or fails to render — and this fixture is that app.
 *
 * What comes out, at `<pre-build>/bare-core/`, mirrors the peel skeleton
 * (vendored framework, generated Next app) minus the entire closure: no
 * module, no plugins, no pack, no nav — one generated subsystem, layer
 * "core", registering only the banner the chrome contract requires. The
 * vendored copy is deliberate even here: the fixture must prove CORE boots
 * alone, not that core-plus-whatever-the-dev-tree-resolves boots.
 *
 * Re-runnable exactly like the peel: everything except `node_modules/` and
 * `package-lock.json` is wiped and regenerated. `test/bare-core.test.ts` is
 * the consumer; scripts/lib/import-graph.mjs (`appScanSpec`) is the static
 * guard over what this generator may emit.
 *
 * Zero dependencies, Node ≥ 23. Framework tooling per INITIATION §0.1.
 */
import fs from "node:fs";
import path from "node:path";

import { readFrameworkVersion } from "./lib/closure.mjs";
import { peerDepsForGeneratedApp } from "./lib/core-peers.mjs";
import { notAMutation } from "./lib/mutation.mjs";

const STUDIO = path.resolve(import.meta.dirname, "..");
const PACKAGES = path.resolve(STUDIO, "..");
const CORE = path.join(PACKAGES, "core");
const PRE_BUILD = path.resolve(PACKAGES, "..");

const KEEP_ON_RERUN = new Set(["node_modules", "package-lock.json"]);
const BARE_FORMAT = "axf-bare-core/1";

function fail(message) {
  console.error(`\nbare-core: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flags = new Map();
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) flags.set(args[i].slice(2), args[i + 1] ?? ""), i++;
}
const port = Number(flags.get("port") ?? 3261) || 3261;
const OUT = path.resolve(flags.get("out") ?? path.join(PRE_BUILD, "bare-core"));

let frameworkVersion, corePkg;
try {
  ({ frameworkVersion, corePkg } = readFrameworkVersion(CORE));
} catch (err) {
  fail(String(err?.message ?? err));
}

// ---------------------------------------------------------------------------
// 1. Prepare the output directory (re-runnable: keep only the install)
// ---------------------------------------------------------------------------
fs.mkdirSync(OUT, { recursive: true });
for (const entry of fs.readdirSync(OUT)) {
  if (!KEEP_ON_RERUN.has(entry)) fs.rmSync(path.join(OUT, entry), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 2. Vendor the framework — the whole of packages/core, exactly as the peel
// ---------------------------------------------------------------------------
const vendorDir = path.join(OUT, "vendor", "axf-core");
fs.mkdirSync(vendorDir, { recursive: true });
for (const f of ["package.json", "tsconfig.json"]) {
  fs.copyFileSync(path.join(CORE, f), path.join(vendorDir, f));
}
// `notAMutation`: the live core/src is vendored while test files run
// concurrently, and a planted mutation removed mid-copy is an ENOENT that
// looks like a broken generator. A generated app must never ship one anyway.
fs.cpSync(path.join(CORE, "src"), path.join(vendorDir, "src"), {
  recursive: true,
  filter: notAMutation
});

// ---------------------------------------------------------------------------
// 3. Generate the app
// ---------------------------------------------------------------------------
const studioPkg = JSON.parse(fs.readFileSync(path.join(STUDIO, "package.json"), "utf8"));
const dep = (name, from) => {
  const version = from[name];
  if (!version) fail(`studio's package.json no longer declares "${name}" — bare-core template is stale`);
  return version;
};

const write = (rel, content) => {
  const abs = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

write(
  "package.json",
  JSON.stringify(
    {
      name: "axf-bare-core",
      private: true,
      version: `0.0.0-bare.${frameworkVersion}`,
      description: `Bare-core boot fixture — @axf/core ${frameworkVersion} with ZERO SDK assets. Regenerate with \`npm run bare\` in packages/studio.`,
      scripts: {
        dev: `next dev --port ${port}`,
        build: "next build",
        start: `next start --port ${port}`,
        typecheck: "tsc --noEmit"
      },
      dependencies: {
        "@axf/core": "file:vendor/axf-core",
        next: dep("next", studioPkg.dependencies),
        react: dep("react", studioPkg.dependencies),
        "react-dom": dep("react-dom", studioPkg.dependencies),
        // Core's OWN peers, read from core — never a literal here. A peel
        // inherits everything core needs, so its dependency list is a fact
        // about core. When this was a hardcoded trio, the day core gained
        // @mui/material every generated app stopped typechecking.
        ...peerDepsForGeneratedApp(CORE, studioPkg, fail)
      },
      devDependencies: {
        "@types/node": dep("@types/node", studioPkg.devDependencies),
        "@types/react": dep("@types/react", studioPkg.devDependencies),
        // Core renders portals (`toolbar/inline.tsx`), so the vendored sources
        // import react-dom and the generated app cannot typecheck without its
        // types. Added 2026-08-13 with the peer itself — the failure it fixes
        // is the same one @mui/material caused in 2026-08-09 and is caught by
        // the same test.
        "@types/react-dom": dep("@types/react-dom", studioPkg.devDependencies),
        typescript: dep("typescript", studioPkg.devDependencies)
      }
    },
    null,
    2
  ) + "\n"
);

write(
  "next.config.ts",
  `import path from "node:path";
import type { NextConfig } from "next";

/**
 * Generated by \`npm run bare\` — do not edit; regenerate instead.
 * Self-contained: \`@axf/core\` resolves to vendor/axf-core (framework ${frameworkVersion}).
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(import.meta.dirname)
  },
  transpilePackages: ["@axf/core"],
  typescript: {
    // Same posture as the dev tree: \`npm run typecheck\` is the real gate.
    ignoreBuildErrors: true
  }
};

export default nextConfig;
`
);

write(
  "tsconfig.json",
  JSON.stringify(
    {
      "//": [
        "Generated by `npm run bare` — do not edit; regenerate instead.",
        "No path aliases at all: @axf/core resolves as a real package through",
        "node_modules into vendor/axf-core, honouring core's exports map, so a",
        "deep import into framework internals fails here exactly as it does in",
        "the bundler."
      ],
      compilerOptions: {
        target: "ES2022",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        skipLibCheck: true,
        jsx: "react-jsx",
        plugins: [{ name: "next" }]
      },
      include: [
        "next-env.d.ts",
        "app/**/*.ts",
        "app/**/*.tsx",
        "src/**/*.ts",
        "src/**/*.tsx",
        ".next/types/**/*.ts",
        ".next/dev/types/**/*.ts"
      ],
      exclude: ["node_modules"]
    },
    null,
    2
  ) + "\n"
);

write(
  "next-env.d.ts",
  `/// <reference types="next" />
/// <reference types="next/image-types/global" />

// NOTE: This file should not be edited
// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.
`
);

write(".gitignore", "node_modules/\n.next/\n");

write(
  "src/boot.ts",
  `/**
 * Generated by \`npm run bare\` — do not edit; regenerate instead.
 *
 * The bare app's ONE subsystem: layer "core", registering nothing but the
 * banner the chrome contract requires. No module, no plugins, no packs, no
 * nav — "zero SDK assets" is the entire point of this fixture, and the
 * health route counts the registry to prove it stayed true.
 */
import { defineSubsystem, defineToolbar, kernel, toolbars } from "@axf/core";
import type { SubsystemStatus } from "@axf/core";

const BANNER = defineToolbar({
  id: "axf-bare-banner",
  title: "Bare-core banner",
  role: "banner",
  surface: "app.banner",
  description: "Generated banner for the bare-core fixture — brand, title, provenance.",
  items: [
    { kind: "brand", id: "brand", width: 120 },
    { kind: "label", id: "app", text: "Bare core", tone: "accent" },
    { kind: "label", id: "bare", text: "zero SDK assets · @axf/core ${frameworkVersion}", tone: "dim" },
    { kind: "spacer", id: "gap" },
    { kind: "slot", id: "context" }
  ]
});

const BARE = defineSubsystem({
  id: "axf-bare",
  title: "Bare core",
  summary: "Boots the framework with zero SDK assets installed.",
  layer: "core",
  start() {
    toolbars.register(BANNER);
  }
});

let started: Promise<SubsystemStatus[]> | null = null;

export function boot(): Promise<SubsystemStatus[]> {
  if (!started) {
    if (!kernel.booted) kernel.register(BARE);
    started = kernel.boot();
  }
  return started;
}
`
);

write(
  "src/Chrome.tsx",
  `/**
 * Generated by \`npm run bare\` — do not edit; regenerate instead.
 * Boots the CLIENT runtime, then mounts the framework's whole chrome.
 */
"use client";

import type { ReactNode } from "react";
import { AppShell } from "@axf/core";

import { boot } from "./boot";

// Module scope: runs once per bundle evaluation, before the first render.
void boot();

export default function Chrome({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
`
);

write(
  "app/layout.tsx",
  `/**
 * Generated by \`npm run bare\` — do not edit; regenerate instead.
 * The default theme is server-rendered into the head so the first paint is
 * themed; AxfStyleRoot (inside AppShell) takes over on the client.
 */
import type { ReactNode } from "react";
import { defaultValues, themeStyleBlock } from "@axf/core";

import Chrome from "../src/Chrome";

export const metadata = {
  title: "Bare core",
  description: "The framework with zero SDK assets installed."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeStyleBlock(defaultValues()) }} />
      </head>
      <body
        style={{
          margin: 0,
          background: "var(--axf-page)",
          color: "var(--axf-ink)",
          fontFamily: "var(--axf-sans)",
          fontSize: "var(--axf-size-body)"
        }}
      >
        <Chrome>{children}</Chrome>
      </body>
    </html>
  );
}
`
);

write(
  "app/page.tsx",
  `/**
 * Generated by \`npm run bare\` — do not edit; regenerate instead.
 * The whole page: proof text inside the full shell. There is deliberately
 * nothing to route to — an app with zero modules has no module routes.
 */
export default function Home() {
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: "var(--axf-size-title)" }}>Bare core is up</h1>
      <p>
        This app is @axf/core ${frameworkVersion} and NOTHING else: no modules, no plugins,
        no packs, no nav, no Studio data directory. If this page renders inside
        the shell and /api/health is green, the framework stands alone.
      </p>
    </main>
  );
}
`
);

write(
  "app/api/health/route.ts",
  `/**
 * Generated by \`npm run bare\` — do not edit; regenerate instead.
 *
 * The bare-core health route (INITIATION §5.1 tier 3, fixture 1). \`ok\` means:
 * every subsystem started AND is layer "core", the registry holds ZERO
 * modules and zero violations, the running framework is the vendored one,
 * and nothing named "studio" is anywhere in the kernel. The data-directory
 * report is how the CI test proves the boot did not need Studio's data:
 * it points AXF_ASSETS_ROOT at a deleted directory and requires
 * \`dataDir.exists === false\` alongside \`ok === true\`.
 */
import fs from "node:fs";
import { AXF_CORE_VERSION, kernel, registry } from "@axf/core";

import manifest from "../../../bare-core.manifest.json";
import { boot } from "../../../src/boot";

export const dynamic = "force-dynamic";

export async function GET() {
  await boot();
  const report = registry.report();
  const statuses = kernel.statuses();
  const dataDirEnv = process.env.AXF_ASSETS_ROOT ?? null;
  const ok =
    statuses.length > 0 &&
    statuses.every((s) => s.state === "started" && s.layer === "core") &&
    statuses.every((s) => !s.id.includes("studio")) &&
    registry.modules().length === 0 &&
    report.violations.length === 0 &&
    AXF_CORE_VERSION === manifest.framework.version;
  return Response.json(
    {
      ok,
      framework: {
        package: "@axf/core",
        running: AXF_CORE_VERSION,
        vendored: manifest.framework.version,
        match: AXF_CORE_VERSION === manifest.framework.version
      },
      modules: registry.modules().map((m) => m.id),
      registry: report,
      subsystems: statuses,
      dataDir: {
        env: dataDirEnv,
        exists: dataDirEnv ? fs.existsSync(dataDirEnv) : false
      },
      generatedAt: manifest.generatedAt
    },
    { status: ok ? 200 : 500 }
  );
}
`
);

// ---------------------------------------------------------------------------
// 4. The manifest — what was generated, from which framework, when
// ---------------------------------------------------------------------------
const countFiles = (dir) => {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  }
  return n;
};

const manifest = {
  format: BARE_FORMAT,
  generatedAt: new Date().toISOString(),
  generatedFrom: "packages/studio",
  framework: {
    package: "@axf/core",
    version: frameworkVersion,
    packageVersion: corePkg.version,
    vendoredTo: "vendor/axf-core",
    files: countFiles(vendorDir)
  },
  sdkAssets: [],
  port
};
write("bare-core.manifest.json", JSON.stringify(manifest, null, 2) + "\n");

// ---------------------------------------------------------------------------
// 5. Report
// ---------------------------------------------------------------------------
console.log(`bare-core fixture → ${OUT}`);
console.log(`  framework   @axf/core ${frameworkVersion} vendored (${manifest.framework.files} files)`);
console.log(`  sdk assets  ZERO — that is the fixture`);
console.log(`  health      /api/health  ·  port ${port}`);
console.log(`  next steps  cd ${path.relative(process.cwd(), OUT)} && npm install && npm run typecheck && npm run dev`);

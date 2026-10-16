/**
 * @file The SERVER-side plugin composition point — `axf-claude` P5.
 *
 * `studio.subsystem.ts` is the client's: its `start()` is where contributions
 * meet the registry, and the kernel runs it on whichever runtime booted. API
 * routes do not boot a kernel — `ClaudeService`'s own constructor says so, and
 * declares its points itself for exactly that reason (*"a route may run before
 * (or without) the studio kernel booting on this runtime"*). So a contribution
 * that must exist while a TURN runs needs a seam of its own, and this is it.
 *
 * Today that is one contribution: Agent Forge's `claude.context-provider`,
 * which reads `.claude/agents` off disk and therefore cannot be in a module the
 * browser bundle evaluates. Anything else server-side joins the list below.
 *
 * ── why this is not inside the subsystem ────────────────────────────────────
 *
 * Because the subsystem must not import its plugins. That is the property the
 * whole point mechanism exists to buy: `src/claude/` knows about
 * `claude.context-provider` and knows nothing about Agent Forge, so a closure
 * is computable and a plugin is removable. Routes are APPLICATION composition —
 * the same layer `studio.subsystem.ts` occupies — and composition is where an
 * asset is allowed to know both halves.
 *
 * ── and why it is not `instrumentation.ts` ──────────────────────────────────
 *
 * Next's `register()` hook looks like the obvious answer and is not: it is
 * bundled separately from route handlers, and core's `registry` is a plain
 * module-scope singleton. Two module graphs, two registries — the per-runtime
 * trap this codebase has already paid for twice. A call from the route that
 * needs it is in the same graph as the service by construction, which is what
 * makes it correct rather than probable.
 *
 * The hole this shape could have — a route that starts a turn and forgets to
 * call it — is closed by `test/registry-scoping.test.ts`, which DISCOVERS every
 * route reaching `claudeService()` for a turn and fails on one that does not.
 */
import { registerAgentForgeContext } from "../plugins/agent-forge/plugin.server";

/**
 * Register every server-side plugin contribution, idempotently.
 *
 * Cheap enough to call per request: each registrar guards itself on
 * `globalThis`, because the registry has no un-contribute and a dev-server
 * module re-evaluation would otherwise fold the same persona into a prompt
 * twice.
 */
export function registerServerPlugins(): void {
  registerAgentForgeContext();
}

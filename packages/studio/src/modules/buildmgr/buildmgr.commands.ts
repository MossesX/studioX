/**
 * @file The behaviour behind the Build Manager's context-menu rows.
 *
 * The menu itself is DATA on `buildmgr.decl.ts`; this is the acting half, and
 * the two meet only through a command name — the same indirection every other
 * module's commands file states in its docblock, kept for the same reason.
 *
 * How the command knows WHICH step was right-clicked: the plan outline marks
 * each step row `data-axf-area="buildmgr.step"` plus `data-axf-file`,
 * `data-axf-phase`, `data-axf-step`, `data-axf-model` and `data-axf-done`,
 * and the engine parks the harvested attributes in `activeContext().data`.
 * `phase` carries the phase's own `n` (never its array index — the fable-redo
 * switch moves indices between read and write; `n` holds still).
 *
 * Registration is idempotent behind a module-scope flag, and MUST run before
 * `registerModuleMenus` sees the decl — the menu map's gate refuses an item
 * naming an unregistered command. `studio.subsystem.ts` calls this in the same
 * block as the other `register*Commands()` calls, which precedes the loop.
 */
import { activeContext, commands, predicates } from "@axf/core";

import { assignModelUi } from "./assign-model";

/** The click's harvested data — `{}` when fired from a palette, which for
 *  these commands means "no step under the pointer" and a quiet no-op. */
function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

let registered = false;

/** Register every Build Manager command. Idempotent — see the file docblock. */
export function registerBuildmgrCommands(): void {
  if (registered) return;
  registered = true;

  commands.register({
    id: "buildmgr.step.assign-model",
    title: "Assign model…",
    run: () => {
      const d = ctxData();
      const file = d.file ?? "";
      const phaseN = Number(d.phase);
      const stepIndex = Number(d.step);
      if (!file || !Number.isFinite(phaseN) || !Number.isFinite(stepIndex)) return;
      assignModelUi.open({
        file,
        phaseN,
        stepIndex,
        model: d.model ?? "",
        done: d.done === "1"
      });
    }
  });

  // Availability, not presence: the row stays on a done step, greyed, saying
  // why — the same teaching posture as taskman's `hasLists`. The API refuses
  // a done step regardless; this makes the refusal legible before the click.
  if (!predicates.has("buildmgr.step.editable")) {
    predicates.register({
      id: "buildmgr.step.editable",
      title: "The step has not run yet",
      test: () =>
        ctxData().done === "1"
          ? "this step is done — its work is in the tree, so its model is a record now"
          : true
    });
  }
}

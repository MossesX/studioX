/** @file Tiny collision-safe id generator — the same shape taskman carries
 *  (`GizmoX src/lib/id.ts`), duplicated per module so the peel stays whole. */

let counter = 0;

/** Generate a short unique id, optionally namespaced: `uid("wf")` → `wf_lx3k9_a4f2`. */
export function uid(prefix = "id"): string {
  counter = (counter + 1) % 1296;
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${time}${counter.toString(36)}_${rand}`;
}

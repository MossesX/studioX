/**
 * @file The Task Manager — declaration composed with its component.
 *
 * The declaration lives in `taskman.decl.ts`, data-only, so the registry, the
 * peel and the suite resolver can read "what points does this module publish?"
 * without loading React. This file is the ONLY place the declaration and the
 * screen meet, and `defineModule` validates the result exactly as it always
 * did.
 */
import { defineModule } from "@axf/core";

import TaskmanModule from "./TaskmanModule";
import { TASKMAN_DECL } from "./taskman.decl";

export const TASKMAN_MODULE = defineModule({
  ...TASKMAN_DECL,
  component: TaskmanModule
});

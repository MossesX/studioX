/**
 * @file The assistant's commands, registered by NAME — what the universal
 * menu row, the command bar's action and any future hotkey resolve through.
 * Idempotent, inline literals, the same shape every other `*.commands.ts`
 * takes (the conformance scanner reads registration sites by source, so a
 * loop over a table would blind it).
 */
import { commands } from "@axf/core";

import { assistant } from "./store";

let registered = false;

export function registerAssistantCommands(): void {
  if (registered) return;
  registered = true;

  if (!commands.has("assistant.toggle")) {
    commands.register({
      id: "assistant.toggle",
      title: "Toggle the module assistant",
      icon: "icon-chat",
      run: () => assistant.toggle()
    });
  }

  if (!commands.has("assistant.open")) {
    commands.register({
      id: "assistant.open",
      title: "Open the module assistant",
      icon: "icon-chat",
      run: () => assistant.open()
    });
  }
}

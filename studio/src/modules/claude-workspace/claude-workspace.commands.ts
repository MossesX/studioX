/**
 * @file The behaviour behind the workspace's context-menu rows.
 *
 * The menus themselves are DATA on `claude-workspace.decl.ts`; the two meet
 * only through a command NAME. The engine parks the resolved click in
 * `activeContext()`, and `MenuContext.data` carries every `data-axf-*`
 * attribute harvested up the area chain — so the screens mark
 * `data-axf-conversation="<id>"`, `data-axf-message="<id>"` and
 * `data-axf-tool="<id>"`, and these handlers read `ctx.data.conversation`,
 * `ctx.data.message` and `ctx.data.tool`.
 *
 * Plain functions over the module's singleton stores: a command mutating them
 * lands on every mounted surface at once with nothing wired through props. What
 * a plain function CANNOT do is mount a dialog or move a scroller, which is
 * what `ui.ts` is for.
 *
 * Registration is idempotent and must run BEFORE
 * `registerModuleMenus(CLAUDE_WORKSPACE_DECL)` — the map's gate refuses an item
 * naming an unregistered command or predicate, which is what makes a typo in
 * the decl a loud boot failure rather than a dead row.
 * `test/ctx-conformance.test.ts` asserts that ordering by source index, and
 * scans for the inline `commands.register({ id: "…" })` literal shape below.
 *
 * ── the one thing worth reading twice ────────────────────────────────────────
 *
 * A command has to work when it is fired WITHOUT a click — from a palette, a
 * hotkey, or a future toolbar. So every "target" helper falls back to the
 * currently open conversation or the last relevant item rather than returning
 * null. A command that only works from a right-click is a command half the app
 * cannot use.
 */
import { activeContext, commands, predicates } from "@axf/core";

import { library } from "./library";
import { projects } from "./projects";
import { session } from "./session";
import { codeBlocksOf, parseMarkdown } from "./markdown";
import { toUnifiedPatch } from "./diff";
import { transcriptText, type ToolItem, type TranscriptItem } from "./transcript";
import { copyAndSay, workspaceUi } from "./ui";
import { prettyInput } from "./ToolCard";

/** The click's harvested data — `{}` when the command came from a palette. */
function ctxData(): Record<string, string> {
  return activeContext()?.data ?? {};
}

/** The right-clicked conversation, falling back to the open one. */
function targetConversation(): string | null {
  return ctxData().conversation ?? session.getState().id;
}

/**
 * The right-clicked project, falling back to the one the library is filtered
 * to, then to the open conversation's.
 *
 * Three fallbacks rather than one because of the rule at the top of this file:
 * a command must work when it is fired WITHOUT a click. Fired from a palette
 * while a project's conversation is open, "copy the working directory" has an
 * obvious subject and returning null would make it a command half the app
 * cannot use.
 */
function targetProject(): string | null {
  const clicked = ctxData().project;
  if (clicked) return clicked;
  const state = projects.getState();
  if (state.selectedId) return state.selectedId;
  return session.getState().record?.projectId ?? null;
}

/** Walk the transcript, including inside nested subagent runs. */
function findItem(predicate: (item: TranscriptItem) => boolean): TranscriptItem | null {
  const walk = (items: readonly TranscriptItem[]): TranscriptItem | null => {
    for (const item of items) {
      if (predicate(item)) return item;
      if (item.kind === "tool") {
        const found = walk(item.children);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(session.transcript().items);
}

function targetMessage(): Extract<TranscriptItem, { kind: "user" | "assistant" }> | null {
  const id = ctxData().message;
  if (!id) return null;
  const item = findItem((candidate) => candidate.id === id);
  return item && (item.kind === "user" || item.kind === "assistant") ? item : null;
}

function targetTool(): ToolItem | null {
  const id = ctxData().tool;
  if (!id) return null;
  const item = findItem((candidate) => candidate.kind === "tool" && candidate.id === id);
  return item && item.kind === "tool" ? item : null;
}

let registered = false;

/** Idempotent, HMR-tolerant — the taskman precedent. */
export function registerClaudeWorkspaceCommands(): void {
  if (registered) return;
  registered = true;

  /* ------------------------------- predicates ------------------------------ */

  if (!predicates.has("claude-workspace.streaming")) {
    predicates.register({
      id: "claude-workspace.streaming",
      title: "A turn is running",
      test: () =>
        session.transcript().streaming ? true : "nothing is running — there is no turn to stop"
    });
  }

  if (!predicates.has("claude-workspace.open")) {
    predicates.register({
      id: "claude-workspace.open",
      title: "A conversation is open",
      test: () => (session.getState().record ? true : "no conversation is open")
    });
  }

  if (!predicates.has("claude-workspace.project-filtered")) {
    predicates.register({
      id: "claude-workspace.project-filtered",
      title: "The library is filtered to a project",
      test: () =>
        projects.getState().selectedId ? true : "the library is already showing every conversation"
    });
  }

  /* -------------------------------- surface -------------------------------- */

  if (!commands.has("claude-workspace.new")) {
    commands.register({
      id: "claude-workspace.new",
      title: "Start a new conversation",
      run: () => {
        // Through the same store the header's button uses. A conversation needs
        // a model, a cwd and a permission mode, and inventing them here would
        // make the menu row start a DIFFERENT kind of conversation from the
        // button beside it.
        void session
          .start({})
          .then(() => library.refresh())
          .then(() => workspaceUi.say("Started a conversation with the catalog defaults"))
          .catch((err: unknown) =>
            workspaceUi.say(err instanceof Error ? err.message : String(err))
          );
      }
    });
  }

  if (!commands.has("claude-workspace.stop")) {
    commands.register({
      id: "claude-workspace.stop",
      title: "Stop the running turn",
      run: () => {
        void session.stop().then((stopped) => {
          workspaceUi.say(stopped ? "Stopped the CLI" : "Nothing was running");
        });
      }
    });
  }

  /* ------------------------------- transcript ------------------------------ */

  if (!commands.has("claude-workspace.transcript.copy")) {
    commands.register({
      id: "claude-workspace.transcript.copy",
      title: "Copy the whole transcript",
      run: () => void copyAndSay(transcriptText(session.transcript().items), "the transcript")
    });
  }

  if (!commands.has("claude-workspace.transcript.expand-tools")) {
    commands.register({
      id: "claude-workspace.transcript.expand-tools",
      title: "Expand every tool call",
      run: () => workspaceUi.expandTools()
    });
  }

  if (!commands.has("claude-workspace.transcript.collapse-tools")) {
    commands.register({
      id: "claude-workspace.transcript.collapse-tools",
      title: "Collapse every tool call",
      run: () => workspaceUi.collapseTools()
    });
  }

  if (!commands.has("claude-workspace.transcript.jump-latest")) {
    commands.register({
      id: "claude-workspace.transcript.jump-latest",
      title: "Scroll to the latest message",
      run: () => workspaceUi.jumpToLatest()
    });
  }

  /* --------------------------------- message ------------------------------- */

  if (!commands.has("claude-workspace.message.copy")) {
    commands.register({
      id: "claude-workspace.message.copy",
      title: "Copy a message",
      run: () => {
        const item = targetMessage();
        if (item) void copyAndSay(item.text, "the message");
      }
    });
  }

  if (!commands.has("claude-workspace.message.copy-code")) {
    commands.register({
      id: "claude-workspace.message.copy-code",
      title: "Copy a message's code blocks",
      run: () => {
        const item = targetMessage();
        if (!item) return;
        const blocks = codeBlocksOf(parseMarkdown(item.text));
        if (!blocks.length) {
          workspaceUi.say("That message has no code blocks");
          return;
        }
        // Joined with a blank line and no fences: the point of "copy the code"
        // is to paste something runnable, and a fence is markdown, not code.
        void copyAndSay(
          blocks.map((block) => block.code).join("\n\n"),
          `${blocks.length} code block${blocks.length === 1 ? "" : "s"}`
        );
      }
    });
  }

  if (!commands.has("claude-workspace.message.quote")) {
    commands.register({
      id: "claude-workspace.message.quote",
      title: "Quote a message into the composer",
      run: () => {
        const item = targetMessage();
        if (!item) return;
        const quoted = item.text
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n");
        workspaceUi.insertIntoComposer(`${quoted}\n\n`);
      }
    });
  }

  /* ---------------------------------- tool --------------------------------- */

  if (!commands.has("claude-workspace.tool.copy-input")) {
    commands.register({
      id: "claude-workspace.tool.copy-input",
      title: "Copy a tool call's input",
      run: () => {
        const tool = targetTool();
        if (!tool) return;
        if (tool.input === undefined) {
          workspaceUi.say("That call's arguments have not finished streaming");
          return;
        }
        void copyAndSay(prettyInput(tool.input), `the ${tool.name} input`);
      }
    });
  }

  if (!commands.has("claude-workspace.tool.copy-output")) {
    commands.register({
      id: "claude-workspace.tool.copy-output",
      title: "Copy a tool call's output",
      run: () => {
        const tool = targetTool();
        if (!tool) return;
        if (!tool.result) {
          workspaceUi.say("That call has not returned yet");
          return;
        }
        void copyAndSay(tool.result.text, `the ${tool.name} output`);
      }
    });
  }

  if (!commands.has("claude-workspace.tool.copy-patch")) {
    commands.register({
      id: "claude-workspace.tool.copy-patch",
      title: "Copy a file edit as a unified patch",
      run: () => {
        const tool = targetTool();
        if (!tool) return;
        if (!tool.diff) {
          workspaceUi.say("That call is not a file edit");
          return;
        }
        void copyAndSay(toUnifiedPatch(tool.diff), "the patch");
      }
    });
  }

  /* -------------------------------- composer ------------------------------- */

  if (!commands.has("claude-workspace.composer.clear")) {
    commands.register({
      id: "claude-workspace.composer.clear",
      title: "Clear the composer's draft",
      run: () => workspaceUi.clearDraft()
    });
  }

  if (!commands.has("claude-workspace.composer.history-prev")) {
    commands.register({
      id: "claude-workspace.composer.history-prev",
      title: "Step back through the composer's history",
      run: () => workspaceUi.historyPrev()
    });
  }

  /* --------------------------------- library ------------------------------- */

  if (!commands.has("claude-workspace.library.refresh")) {
    commands.register({
      id: "claude-workspace.library.refresh",
      title: "Reload the conversation library",
      run: () => void library.refresh()
    });
  }

  if (!commands.has("claude-workspace.library.clear-search")) {
    commands.register({
      id: "claude-workspace.library.clear-search",
      title: "Clear the library's search",
      run: () => library.setQuery("")
    });
  }

  /* --------------------------------- projects ------------------------------ */

  if (!commands.has("claude-workspace.projects.manage")) {
    commands.register({
      id: "claude-workspace.projects.manage",
      title: "Manage projects",
      // The manager owns creating one, so "New project" and "Manage projects…"
      // are the same command: a second one that opened the same dialog and then
      // asked it to clear its draft would be a second way to be in the wrong
      // state.
      run: () => workspaceUi.projects(true)
    });
  }

  if (!commands.has("claude-workspace.projects.refresh")) {
    commands.register({
      id: "claude-workspace.projects.refresh",
      title: "Reload the project list",
      run: () => void projects.refresh()
    });
  }

  if (!commands.has("claude-workspace.project.filter")) {
    commands.register({
      id: "claude-workspace.project.filter",
      title: "Show only one project's conversations",
      run: () => {
        const id = targetProject();
        if (!id) return;
        projects.select(id);
        workspaceUi.say(`Showing “${projects.byId(id)?.name ?? "project"}”`);
      }
    });
  }

  if (!commands.has("claude-workspace.project.clear-filter")) {
    commands.register({
      id: "claude-workspace.project.clear-filter",
      title: "Show every conversation",
      run: () => {
        projects.select(null);
        workspaceUi.say("Showing every conversation");
      }
    });
  }

  if (!commands.has("claude-workspace.project.new-conversation")) {
    commands.register({
      id: "claude-workspace.project.new-conversation",
      title: "Start a conversation in a project",
      run: () => {
        const id = targetProject();
        if (!id) return;
        // Only the project is passed: its bound directory, model, effort and
        // permission mode are what the service fills the rest from. Restating
        // any of them here would be this row starting a DIFFERENT kind of
        // conversation from the dialog beside it — the same argument
        // `claude-workspace.new` is built on.
        void session
          .start({ projectId: id })
          .then(() => library.refresh())
          .then(() => {
            // The filter follows, or the conversation just started is not in
            // the list the reader is looking at.
            projects.select(id);
            workspaceUi.say(`Started in “${projects.byId(id)?.name ?? "the project"}”`);
          })
          .catch((err: unknown) =>
            workspaceUi.say(err instanceof Error ? err.message : String(err))
          );
      }
    });
  }

  if (!commands.has("claude-workspace.project.copy-cwd")) {
    commands.register({
      id: "claude-workspace.project.copy-cwd",
      title: "Copy a project's working directory",
      run: () => {
        const project = projects.byId(targetProject());
        if (!project) return;
        void copyAndSay(project.cwd, "the working directory");
      }
    });
  }

  /* ------------------------------ conversation ----------------------------- */

  if (!commands.has("claude-workspace.conversation.open")) {
    commands.register({
      id: "claude-workspace.conversation.open",
      title: "Open a conversation",
      run: () => {
        const id = ctxData().conversation;
        if (id) void session.open(id);
      }
    });
  }

  if (!commands.has("claude-workspace.conversation.pin")) {
    commands.register({
      id: "claude-workspace.conversation.pin",
      title: "Pin or unpin a conversation",
      run: () => {
        const id = targetConversation();
        if (!id) return;
        // The row carries its own state, so the toggle does not need a lookup
        // that could disagree with what the reader is looking at.
        const pinned = ctxData().pinned === "1";
        void library
          .setPinned(id, !pinned)
          .then(() => workspaceUi.say(pinned ? "Unpinned" : "Pinned"))
          .catch((err: unknown) => workspaceUi.say(err instanceof Error ? err.message : String(err)));
      }
    });
  }

  if (!commands.has("claude-workspace.conversation.rename")) {
    commands.register({
      id: "claude-workspace.conversation.rename",
      title: "Rename a conversation",
      run: () => {
        const id = targetConversation();
        // A plain function cannot mount a dialog; `ui.ts` is the channel and
        // `ClaudeWorkspaceModule` owns the dialog itself.
        if (id) workspaceUi.rename(id);
      }
    });
  }

  if (!commands.has("claude-workspace.conversation.export-markdown")) {
    commands.register({
      id: "claude-workspace.conversation.export-markdown",
      title: "Export a conversation as markdown",
      run: () => {
        const id = targetConversation();
        if (!id) return;
        void library
          .export(id, "markdown")
          .then((filename) => workspaceUi.say(`Exported ${filename}`))
          .catch((err: unknown) => workspaceUi.say(err instanceof Error ? err.message : String(err)));
      }
    });
  }

  if (!commands.has("claude-workspace.conversation.export-json")) {
    commands.register({
      id: "claude-workspace.conversation.export-json",
      title: "Export a conversation as JSON",
      run: () => {
        const id = targetConversation();
        if (!id) return;
        void library
          .export(id, "json")
          .then((filename) => workspaceUi.say(`Exported ${filename}`))
          .catch((err: unknown) => workspaceUi.say(err instanceof Error ? err.message : String(err)));
      }
    });
  }

  if (!commands.has("claude-workspace.conversation.copy-id")) {
    commands.register({
      id: "claude-workspace.conversation.copy-id",
      title: "Copy a conversation's id",
      run: () => {
        const id = targetConversation();
        if (id) void copyAndSay(id, "the conversation id");
      }
    });
  }

  if (!commands.has("claude-workspace.conversation.delete")) {
    commands.register({
      id: "claude-workspace.conversation.delete",
      title: "Delete a conversation",
      run: () => {
        const id = targetConversation();
        if (!id) return;
        // Always confirmed, never behind a setting. The transcript is on disk
        // and there is no undo — `settings.ts` records why a switch to turn
        // this off was refused.
        const ok = window.confirm(
          "Delete this conversation? The transcript is removed from disk and there is no undo."
        );
        if (!ok) return;
        void library
          .remove(id)
          .then((deleted) => workspaceUi.say(deleted ? "Deleted" : "It was already gone"))
          .catch((err: unknown) => workspaceUi.say(err instanceof Error ? err.message : String(err)));
      }
    });
  }
}

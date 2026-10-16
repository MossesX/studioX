/**
 * @file The Claude workspace's DECLARATION — data only, importable by plain Node.
 *
 * The closure resolver (`scripts/lib/closure.mjs` — the peel outward, the suite
 * inward), `test/ctx-conformance.test.ts` and `scripts/suite.mjs` all import
 * this under native type stripping, with no JSX transform and no React, to
 * learn the module's id, route, declared areas and extension points. So the one
 * hard rule: **nothing but `import type`**.
 *
 * ── the two points, and why they are DECLARED before a consumer exists ───────
 *
 * `axf-claude.bmpx` P3, verbatim: *"Declares `claude-workspace.panel` and
 * `claude-workspace.composer-action` for the assets being absorbed."* P5 is
 * what absorbs them — Agent Forge, the diff browser, the owner's Build Manager
 * plugin — and the project's own reason for declaring first is stated in its
 * P1 step and holds here just as well: *"retrofitting a consumer API after the
 * first consumer arrives is how it ends up shaped for one caller."*
 *
 * These are the MODULE's points and they are UI. The subsystem's three
 * (`claude.tool`, `claude.context-provider`, `claude.session-observer`) are
 * about the transport and are declared in `src/claude/points.ts`; its docblock
 * says why the UI pair does not live there — *"a transport has no screen for a
 * panel to land on"*. A plugin that wants both contributes to both, which is
 * the honest shape: watching a session and drawing a panel are separate
 * capabilities and a plugin may want either alone.
 *
 * ── the menus ────────────────────────────────────────────────────────────────
 *
 * Declared as DATA per the AmberX contract. The screens mark
 * `data-axf-area="claude-workspace.<name>"` and stop thinking about menus;
 * behaviour lives in `claude-workspace.commands.ts` behind command NAMES, and
 * `studio.subsystem.ts` registers those BEFORE its `registerModuleMenus` loop —
 * the map's gate refuses an item naming an unregistered command, which is what
 * makes a typo here a loud boot failure rather than a dead row.
 */
import type { ModuleDecl } from "@axf/core";

export const CLAUDE_PANEL_POINT = "claude-workspace.panel";
export const CLAUDE_COMPOSER_ACTION_POINT = "claude-workspace.composer-action";

export const CLAUDE_WORKSPACE_DECL: ModuleDecl = {
  id: "claude-workspace",
  title: "Claude",
  summary:
    "The workspace over the Claude subsystem: a streaming transcript with syntax-highlighted " +
    "code, foldable thinking, expandable tool calls, nested subagent runs and file-edit diffs; " +
    "a multiline composer with history and slash completion; and a searchable conversation " +
    "library.",
  route: "/claude",
  glyph: "icon-chat",
  /** Settings as decl data (core 0.0.20) — three rows, moved verbatim from
   *  `settings.ts`, whose docblock keeps the considered-and-refused list. */
  settings: {
    ns: "claude-workspace-settings",
    rows: [
      {
        key: "showThinking",
        label: "Show extended thinking",
        hint: "Render the model's thinking blocks, folded. Off hides them entirely.",
        kind: "switch",
        defaultValue: true
      },
      {
        key: "autoExpandTools",
        label: "Expand tool calls by default",
        hint: "Open each tool card as it arrives instead of on click.",
        kind: "switch",
        defaultValue: false
      },
      {
        key: "sendOnEnter",
        label: "Enter sends the message",
        hint: "Off swaps the keys: Enter breaks the line and Ctrl+Enter sends.",
        kind: "switch",
        defaultValue: true
      }
    ]
  },
  points: [
    {
      id: CLAUDE_PANEL_POINT,
      title: "Workspace panel",
      description:
        "A pane in the workspace's side column: a title, an optional glyph and a component the " +
        "workspace mounts. The panel reads the open conversation from the module's own store " +
        "rather than being handed props, so a contribution is a component and not a protocol.",
      kind: "ui-surface",
      cardinality: "many",
      requires: ["title", "render"],
      ordering: "priority"
    },
    {
      id: CLAUDE_COMPOSER_ACTION_POINT,
      title: "Composer action",
      description:
        "A button beside the composer: a label, an optional glyph, and a run() that may return " +
        "text to insert at the caret. Returning text rather than writing to the composer is " +
        "what keeps a contribution from needing a handle on the editor.",
      kind: "command",
      cardinality: "many",
      requires: ["id", "label", "run"],
      ordering: "priority"
    }
  ],
  menus: {
    areas: [
      {
        id: "claude-workspace.surface",
        title: "Claude workspace",
        description: "Anywhere on the workspace, including empty space."
      },
      {
        id: "claude-workspace.transcript",
        title: "Transcript",
        description: "The conversation transcript as a whole."
      },
      {
        id: "claude-workspace.message",
        title: "Message",
        description: "One message — a question you asked or an answer that came back."
      },
      {
        id: "claude-workspace.tool",
        title: "Tool call",
        description: "One tool call card, including a file-edit diff or a nested subagent run."
      },
      {
        id: "claude-workspace.composer",
        title: "Composer",
        description: "The message editor at the foot of the transcript."
      },
      {
        id: "claude-workspace.library",
        title: "Conversation library",
        description: "The library pane itself, its search box, and its empty space."
      },
      {
        id: "claude-workspace.conversation",
        title: "Conversation",
        description: "One conversation in the library."
      },
      /*
       * The two PROJECT areas (P4). They are marked inside a dialog, which is a
       * MUI portal — the engine's listener is on the document and the walk is
       * over `parentElement`, so a portal is just another subtree and needs
       * nothing special. Worth stating once because the instinct is to assume
       * a dialog is out of reach of a document-level menu.
       */
      {
        id: "claude-workspace.projects",
        title: "Projects",
        description: "The project list in the manager, and its empty space."
      },
      {
        id: "claude-workspace.project",
        title: "Project",
        description: "One project — its bound working directory, instructions and knowledge files."
      }
    ],
    items: {
      "claude-workspace.surface": [
        { id: "new", label: "New conversation", command: "claude-workspace.new", order: 10 },
        /*
         * `enabledWhen` rather than `when`, so the row is always THERE and
         * greys with its reason when nothing is running. A row that appears and
         * disappears teaches nobody that the feature exists — the same argument
         * the Expense Tracker's delete-selected row is built on.
         */
        {
          id: "stop",
          label: "Stop the running turn",
          command: "claude-workspace.stop",
          enabledWhen: "claude-workspace.streaming",
          role: "danger",
          order: 20
        }
      ],
      "claude-workspace.transcript": [
        {
          id: "copy-transcript",
          label: "Copy the whole transcript",
          command: "claude-workspace.transcript.copy",
          enabledWhen: "claude-workspace.open",
          order: 10
        },
        { id: "sep-1", label: "", role: "separator", order: 20 },
        {
          id: "expand-tools",
          label: "Expand every tool call",
          command: "claude-workspace.transcript.expand-tools",
          order: 30
        },
        {
          id: "collapse-tools",
          label: "Collapse every tool call",
          command: "claude-workspace.transcript.collapse-tools",
          order: 40
        },
        {
          id: "jump-latest",
          label: "Jump to the latest message",
          command: "claude-workspace.transcript.jump-latest",
          order: 50
        }
      ],
      "claude-workspace.message": [
        { id: "copy", label: "Copy this message", command: "claude-workspace.message.copy", order: 10 },
        {
          id: "copy-code",
          label: "Copy its code blocks",
          command: "claude-workspace.message.copy-code",
          order: 20
        },
        { id: "sep-1", label: "", role: "separator", order: 30 },
        {
          id: "quote",
          label: "Quote it into the composer",
          command: "claude-workspace.message.quote",
          order: 40
        }
      ],
      "claude-workspace.tool": [
        {
          id: "copy-input",
          label: "Copy the call's input",
          command: "claude-workspace.tool.copy-input",
          order: 10
        },
        {
          id: "copy-output",
          label: "Copy the call's output",
          command: "claude-workspace.tool.copy-output",
          order: 20
        },
        {
          id: "copy-patch",
          label: "Copy the edit as a patch",
          command: "claude-workspace.tool.copy-patch",
          order: 30
        }
      ],
      "claude-workspace.composer": [
        {
          id: "clear",
          label: "Clear the draft",
          command: "claude-workspace.composer.clear",
          order: 10
        },
        {
          id: "history-prev",
          label: "Previous message from history",
          command: "claude-workspace.composer.history-prev",
          order: 20
        }
      ],
      "claude-workspace.library": [
        { id: "new", label: "New conversation", command: "claude-workspace.new", order: 10 },
        { id: "refresh", label: "Reload the library", command: "claude-workspace.library.refresh", order: 20 },
        {
          id: "clear-search",
          label: "Clear the search",
          command: "claude-workspace.library.clear-search",
          order: 30
        },
        { id: "sep-1", label: "", role: "separator", order: 40 },
        {
          id: "manage-projects",
          label: "Manage projects…",
          command: "claude-workspace.projects.manage",
          order: 50
        },
        {
          /*
           * `enabledWhen`, not `when` — the row is always there and greys with
           * its reason when nothing is filtered. The library's own filter is a
           * dropdown three lines above; a row that VANISHED when no filter was
           * set would teach nobody that the filter can be cleared from here,
           * which is the same argument the stop row is built on.
           */
          id: "clear-project",
          label: "Show every conversation",
          command: "claude-workspace.project.clear-filter",
          enabledWhen: "claude-workspace.project-filtered",
          order: 60
        }
      ],
      "claude-workspace.projects": [
        {
          id: "manage",
          label: "New project",
          command: "claude-workspace.projects.manage",
          order: 10
        },
        {
          id: "refresh",
          label: "Reload the project list",
          command: "claude-workspace.projects.refresh",
          order: 20
        }
      ],
      "claude-workspace.project": [
        {
          id: "new-conversation",
          label: "Start a conversation here",
          command: "claude-workspace.project.new-conversation",
          order: 10
        },
        {
          id: "filter",
          label: "Show only this project's conversations",
          command: "claude-workspace.project.filter",
          order: 20
        },
        { id: "sep-1", label: "", role: "separator", order: 30 },
        {
          id: "copy-cwd",
          label: "Copy the working directory",
          command: "claude-workspace.project.copy-cwd",
          order: 40
        }
      ],
      "claude-workspace.conversation": [
        { id: "open", label: "Open", command: "claude-workspace.conversation.open", order: 10 },
        { id: "pin", label: "Pin / unpin", command: "claude-workspace.conversation.pin", order: 20 },
        { id: "rename", label: "Rename…", command: "claude-workspace.conversation.rename", order: 30 },
        { id: "sep-1", label: "", role: "separator", order: 40 },
        {
          id: "export",
          label: "Export",
          role: "submenu",
          order: 50,
          items: [
            {
              id: "markdown",
              label: "As markdown",
              command: "claude-workspace.conversation.export-markdown"
            },
            { id: "json", label: "As JSON", command: "claude-workspace.conversation.export-json" }
          ]
        },
        { id: "copy-id", label: "Copy the conversation id", command: "claude-workspace.conversation.copy-id", order: 60 },
        { id: "sep-2", label: "", role: "separator", order: 70 },
        {
          id: "delete",
          label: "Delete conversation",
          command: "claude-workspace.conversation.delete",
          role: "danger",
          order: 80
        }
      ]
    }
  }
};

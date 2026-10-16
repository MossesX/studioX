"""The DESKTOP prompt for a module's agent — the middle tier of the three.

    python scripts/agent-prompt.py <draft.json> <result.json>

Exit codes are the contract `scripts/module-agent.mjs` reads:

    0   the owner accepted; the edited draft is written to <result.json>
    2   the owner cancelled; the build leaves any existing bundle alone
    1   Qt could not open (no display, no PyQt6) — the build falls through
        to the terminal form, which is an ABSENCE and not a refusal

## Why this exists

A module's agent is named when the module is built, and a build is a Node
script with no window. When the studio is running it borrows the app's own
dialog; when it is not — a fresh clone, a CI box with a desktop, a peel run
from a terminal — there is still a person sitting there, and asking them in a
real window beats asking them in a readline prompt.

This is the same fallback GizmoX kept for its capture hotkey, noted in
`src/modules/taskman/capture.ts` as deliberately left behind because AmberX had
no caller for it. The agent builder is that caller.

## What it edits

Everything the derivation filled in, pre-filled and editable: the name (with
the suggestions the derivation offered), the description, the persona body, the
skills — each one's text as well as whether it is kept — and both senses of
"tool": the CLI tools the agent is allowed, and the module tool definitions it
carries.

Nothing here derives anything. The draft arrives complete; this window is a
form over it, so the three prompt surfaces cannot disagree about content.

PyQt6 only, no other dependency.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from PyQt6.QtCore import Qt
    from PyQt6.QtGui import QFont
    from PyQt6.QtWidgets import (
        QApplication,
        QCheckBox,
        QComboBox,
        QDialog,
        QDialogButtonBox,
        QFormLayout,
        QHBoxLayout,
        QLabel,
        QLineEdit,
        QListWidget,
        QListWidgetItem,
        QPlainTextEdit,
        QScrollArea,
        QSplitter,
        QTabWidget,
        QVBoxLayout,
        QWidget,
    )
except Exception as exc:  # pragma: no cover - absence is a fall-through
    print(f"agent-prompt: PyQt6 unavailable ({exc})", file=sys.stderr)
    sys.exit(1)


MONO = "Cascadia Mono, Consolas, Menlo, monospace"

# Offered as tick boxes; the field underneath stays free text because the CLI
# grows tools faster than any list here can chase (the same posture the model
# field takes in the assistant's types.ts).
CLI_TOOLS = [
    ("Read", "Read a file the user names.", False),
    ("Grep", "Search file contents.", False),
    ("Glob", "Find files by pattern.", False),
    ("WebFetch", "Fetch a URL the user names.", False),
    ("WebSearch", "Search the web.", False),
    ("Edit", "Edit a file in place.", True),
    ("Write", "Create or overwrite a file.", True),
    ("Bash", "Run shell commands.", True),
    ("TodoWrite", "Keep a task list during a long answer.", False),
]


class AgentDialog(QDialog):
    """One form over one draft. `result` is the accepted draft, or None."""

    def __init__(self, draft: dict) -> None:
        super().__init__()
        self.draft = draft
        # Skills are edited in place, so the dialog owns a mutable copy — the
        # incoming draft is never mutated, which is what lets Cancel mean
        # cancel.
        self.skills = [dict(s) for s in draft.get("skills", [])]
        self.kept = {s["slug"]: True for s in self.skills}
        self.result: dict | None = None

        self.setWindowTitle(f"Name the agent for {draft.get('module', '?')}")
        self.resize(940, 720)

        layout = QVBoxLayout(self)
        layout.addWidget(self._header())
        tabs = QTabWidget()
        tabs.addTab(self._agent_tab(), "Agent")
        tabs.addTab(self._skills_tab(), f"Skills ({len(self.skills)})")
        tabs.addTab(self._tools_tab(), f"Tools ({len(draft.get('tools', []))})")
        layout.addWidget(tabs, 1)

        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel
        )
        buttons.button(QDialogButtonBox.StandardButton.Ok).setText("Build this agent")
        buttons.accepted.connect(self._accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    # ── header ────────────────────────────────────────────────────────────
    def _header(self) -> QWidget:
        box = QWidget()
        row = QVBoxLayout(box)
        row.setContentsMargins(0, 0, 0, 8)
        title = QLabel(
            f"<b>{self.draft.get('module')}</b> is being built. Every module ships with one agent — "
            f"this is it."
        )
        title.setWordWrap(True)
        hint = QLabel(
            "Everything below is derived from the module's declaration and is yours to change. "
            "Its id stays <code>{}</code> whatever you call it, so pinning it never breaks.".format(
                self.draft.get("id", "")
            )
        )
        hint.setWordWrap(True)
        hint.setStyleSheet("color: palette(mid);")
        row.addWidget(title)
        row.addWidget(hint)
        return box

    # ── agent tab ─────────────────────────────────────────────────────────
    def _agent_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        form = QFormLayout()

        self.name = QComboBox()
        self.name.setEditable(True)
        for option in self.draft.get("nameOptions") or []:
            self.name.addItem(option)
        self.name.setCurrentText(self.draft.get("name", ""))
        form.addRow("Name", self.name)

        self.description = QLineEdit(self.draft.get("description", ""))
        form.addRow("Description", self.description)

        self.model = QLineEdit(self.draft.get("model") or "")
        self.model.setPlaceholderText("blank — use whatever the assistant is configured for")
        form.addRow("Model", self.model)

        layout.addLayout(form)
        label = QLabel("Persona — this body IS the system prompt.")
        label.setStyleSheet("color: palette(mid);")
        layout.addWidget(label)
        self.persona = QPlainTextEdit(self.draft.get("persona", ""))
        self.persona.setFont(QFont(MONO.split(",")[0], 10))
        layout.addWidget(self.persona, 1)
        return page

    # ── skills tab ────────────────────────────────────────────────────────
    def _skills_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)
        note = QLabel(
            "One skill per function of the module, written from its real commands, settings and "
            "points. Untick to leave one out; edit the text to make it yours."
        )
        note.setWordWrap(True)
        note.setStyleSheet("color: palette(mid);")
        layout.addWidget(note)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        self.skill_list = QListWidget()
        for skill in self.skills:
            item = QListWidgetItem(f"{skill['slug']}")
            item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            item.setCheckState(Qt.CheckState.Checked)
            item.setToolTip(skill.get("description", ""))
            self.skill_list.addItem(item)
        self.skill_list.currentRowChanged.connect(self._show_skill)
        self.skill_list.itemChanged.connect(self._toggle_skill)
        splitter.addWidget(self.skill_list)

        right = QWidget()
        right_layout = QVBoxLayout(right)
        self.skill_name = QLineEdit()
        self.skill_name.textEdited.connect(self._skill_name_edited)
        right_layout.addWidget(self.skill_name)
        self.skill_body = QPlainTextEdit()
        self.skill_body.setFont(QFont(MONO.split(",")[0], 10))
        self.skill_body.textChanged.connect(self._skill_body_edited)
        right_layout.addWidget(self.skill_body, 1)
        splitter.addWidget(right)
        splitter.setSizes([240, 660])
        layout.addWidget(splitter, 1)
        if self.skills:
            self.skill_list.setCurrentRow(0)
        return page

    def _current_skill(self) -> dict | None:
        row = self.skill_list.currentRow()
        return self.skills[row] if 0 <= row < len(self.skills) else None

    def _show_skill(self, row: int) -> None:
        if not (0 <= row < len(self.skills)):
            return
        skill = self.skills[row]
        self.skill_name.setText(skill.get("name", ""))
        # Block the body's own signal: setPlainText fires textChanged, which
        # would write the outgoing skill's text onto the incoming one.
        self.skill_body.blockSignals(True)
        self.skill_body.setPlainText(skill.get("body", ""))
        self.skill_body.blockSignals(False)

    def _skill_name_edited(self, text: str) -> None:
        skill = self._current_skill()
        if skill is not None:
            skill["name"] = text

    def _skill_body_edited(self) -> None:
        skill = self._current_skill()
        if skill is not None:
            skill["body"] = self.skill_body.toPlainText()

    def _toggle_skill(self, item: QListWidgetItem) -> None:
        row = self.skill_list.row(item)
        if 0 <= row < len(self.skills):
            self.kept[self.skills[row]["slug"]] = item.checkState() == Qt.CheckState.Checked

    # ── tools tab ─────────────────────────────────────────────────────────
    def _tools_tab(self) -> QWidget:
        page = QWidget()
        layout = QVBoxLayout(page)

        heading = QLabel("<b>CLI tools</b> — what the agent may DO while answering.")
        layout.addWidget(heading)
        note = QLabel(
            "Honoured on the Claude subscription path, where they become the CLI's "
            "<code>--allowed-tools</code>. The write-capable ones are marked; a chat window that can "
            "edit files is a decision, so none of them are ticked for you."
        )
        note.setWordWrap(True)
        note.setStyleSheet("color: palette(mid);")
        layout.addWidget(note)

        chosen = set(self.draft.get("cliTools") or [])
        self.cli_boxes: list[tuple[QCheckBox, str]] = []
        grid = QWidget()
        grid_layout = QVBoxLayout(grid)
        grid_layout.setContentsMargins(8, 4, 8, 4)
        for name, hint, writes in CLI_TOOLS:
            row = QHBoxLayout()
            box = QCheckBox(name)
            box.setChecked(name in chosen)
            row.addWidget(box)
            label = QLabel(f"{hint}{'  ⚠ writes' if writes else ''}")
            label.setStyleSheet("color: palette(mid);")
            row.addWidget(label, 1)
            holder = QWidget()
            holder.setLayout(row)
            grid_layout.addWidget(holder)
            self.cli_boxes.append((box, name))
        layout.addWidget(grid)

        extra_row = QFormLayout()
        self.cli_extra = QLineEdit(", ".join(sorted(chosen - {n for n, _, _ in CLI_TOOLS})))
        self.cli_extra.setPlaceholderText("anything else, comma separated — e.g. Bash(git *)")
        extra_row.addRow("Also allow", self.cli_extra)
        layout.addLayout(extra_row)

        heading2 = QLabel("<b>Module tools</b> — the definitions this agent carries.")
        layout.addWidget(heading2)
        note2 = QLabel(
            "Derived from the module (its own commands and setting keys are the enums) plus the "
            "house set every agent gets. They are DATA — the authored feed for the tool bridge — "
            "so untick anything you do not want offered."
        )
        note2.setWordWrap(True)
        note2.setStyleSheet("color: palette(mid);")
        layout.addWidget(note2)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        inner = QWidget()
        inner_layout = QVBoxLayout(inner)
        self.tool_boxes: list[tuple[QCheckBox, dict]] = []
        for tool in self.draft.get("tools", []):
            box = QCheckBox(tool["name"])
            box.setChecked(True)
            box.setToolTip(tool.get("description", ""))
            inner_layout.addWidget(box)
            desc = QLabel(tool.get("description", ""))
            desc.setWordWrap(True)
            desc.setStyleSheet("color: palette(mid); margin-left: 22px;")
            inner_layout.addWidget(desc)
            self.tool_boxes.append((box, tool))
        scroll.setWidget(inner)
        layout.addWidget(scroll, 1)
        return page

    # ── accept ────────────────────────────────────────────────────────────
    def _accept(self) -> None:
        cli = [name for box, name in self.cli_boxes if box.isChecked()]
        cli += [t.strip() for t in self.cli_extra.text().split(",") if t.strip()]
        result = dict(self.draft)
        result["name"] = self.name.currentText().strip() or self.draft.get("name", "")
        result["description"] = self.description.text().strip()
        result["persona"] = self.persona.toPlainText()
        result["cliTools"] = cli
        result["skills"] = [s for s in self.skills if self.kept.get(s["slug"], True)]
        result["tools"] = [tool for box, tool in self.tool_boxes if box.isChecked()]
        model = self.model.text().strip()
        if model:
            result["model"] = model
        else:
            result.pop("model", None)
        self.result = result
        self.accept()


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print("usage: agent-prompt.py <draft.json> <result.json>", file=sys.stderr)
        return 1
    draft = json.loads(Path(argv[1]).read_text(encoding="utf8"))
    app = QApplication([])
    dialog = AgentDialog(draft)
    dialog.show()
    app.exec()
    if dialog.result is None:
        return 2
    Path(argv[2]).write_text(json.dumps(dialog.result, indent=2), encoding="utf8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

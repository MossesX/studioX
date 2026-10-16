"""The AmberX Vid system tray icon — painted, state-tinted, menu-driven.

Per the hotkeys-service pattern: the icon is PAINTED rather than shipped as a
.ico so its colour can follow the capture state live (idle grey, background-
armed amber, recording red, paused yellow), and the menu is built from a
declarative item table (`MENU_ITEMS`) rather than hand-wired actions — a row
is data (kind + label + enable rule), so reordering or adding one is a table
edit, never plumbing.

The glyph is a camera: rounded body, lens ring, and a REC dot that only
appears while a capture is running.
"""

from __future__ import annotations

from typing import Callable

from PyQt6.QtCore import Qt
from PyQt6.QtGui import QAction, QBrush, QColor, QIcon, QPainter, QPen, QPixmap
from PyQt6.QtWidgets import QMenu, QSystemTrayIcon

#: State → tint. Mirrors the module's status colours (GX.dim/accent/err/warn).
STATE_COLORS: dict[str, str] = {
    "idle": "#6B7280",
    "armed": "#FF7A1A",
    "recording": "#EF4444",
    "paused": "#F59E0B",
}

#: The declarative menu. ``enabled`` and ``checked`` are state predicates over
#: the service's status dict; ``action`` is the id handed to ``on_action``.
MENU_ITEMS: list[dict] = [
    {"kind": "status"},
    {"kind": "separator"},
    {"kind": "action", "action": "record-start", "label": "Start recording",
     "enabled": lambda s: s["state"] == "idle"},
    {"kind": "action", "action": "record-stop", "label": "Stop recording",
     "enabled": lambda s: s["state"] in ("recording", "paused")},
    {"kind": "action", "action": "record-pause", "label": "Pause",
     "enabled": lambda s: s["state"] == "recording"},
    {"kind": "action", "action": "record-resume", "label": "Resume",
     "enabled": lambda s: s["state"] == "paused"},
    {"kind": "separator"},
    {"kind": "check", "action": "background-toggle", "label": "Background mode",
     "checked": lambda s: bool(s["backgroundMode"])},
    {"kind": "separator"},
    {"kind": "action", "action": "open-amberxvid", "label": "Open AmberX Vid"},
    {"kind": "action", "action": "reload-devices", "label": "Reload devices"},
    {"kind": "separator"},
    {"kind": "action", "action": "quit", "label": "Quit"},
]


def make_icon(state: str) -> QIcon:
    """Paint the 32 px camera glyph tinted by the capture state."""
    color = QColor(STATE_COLORS.get(state, STATE_COLORS["idle"]))
    pix = QPixmap(32, 32)
    pix.fill(Qt.GlobalColor.transparent)
    p = QPainter(pix)
    p.setRenderHint(QPainter.RenderHint.Antialiasing)

    # camera body + top hump
    p.setPen(QPen(color.darker(150), 2))
    p.setBrush(QBrush(color))
    p.drawRoundedRect(3, 9, 26, 18, 5, 5)
    p.drawRoundedRect(10, 5, 12, 7, 3, 3)

    # lens ring + pupil, punched out of the tint
    p.setBrush(QBrush(QColor("#101014")))
    p.setPen(QPen(QColor("#101014"), 1))
    p.drawEllipse(10, 12, 12, 12)
    p.setBrush(QBrush(color.lighter(140)))
    p.setPen(Qt.PenStyle.NoPen)
    p.drawEllipse(13, 15, 6, 6)

    # REC dot — only while a capture is live
    if state in ("recording", "paused"):
        p.setBrush(QBrush(QColor("#FFFFFF")))
        p.drawEllipse(24, 11, 4, 4)

    p.end()
    return QIcon(pix)


class Tray:
    """The tray icon plus the menu rebuilt from ``MENU_ITEMS`` on every poll."""

    def __init__(self, base_url: str, on_action: Callable[[str], None]) -> None:
        self.base_url = base_url.rstrip("/")
        self.on_action = on_action
        self.icon = QSystemTrayIcon()
        self.icon.setToolTip("AmberX Vid — background recorder")
        self.icon.activated.connect(self._on_activated)
        self._menu = QMenu()
        self.icon.setContextMenu(self._menu)
        self._last_state_key: tuple | None = None

    def show(self) -> None:
        self.icon.show()

    def notify(self, title: str, body: str) -> None:
        if self.icon.isVisible():
            self.icon.showMessage(title, body, QSystemTrayIcon.MessageIcon.Information, 3000)

    def _on_activated(self, reason) -> None:
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            self.on_action("open-amberxvid")

    def rebuild(self, status: dict) -> None:
        """Re-tint the icon and rebuild the menu when the state changed."""
        state = str(status.get("state", "idle"))
        background = bool(status.get("backgroundMode", False))
        tint = state if state != "idle" else ("armed" if background else "idle")
        elapsed = float(status.get("elapsedS", 0.0))
        error = status.get("lastError")

        key = (state, background, int(elapsed), bool(error))
        if key == self._last_state_key:
            return
        self._last_state_key = key

        self.icon.setIcon(make_icon(tint))
        line = {
            "idle": "idle — background armed" if background else "idle",
            "recording": f"recording {_fmt_clock(elapsed)}",
            "paused": f"paused at {_fmt_clock(elapsed)}",
        }.get(state, state)
        tip = f"AmberX Vid — {line}"
        if error:
            tip += f"\nlast error: {str(error)[:120]}"
        self.icon.setToolTip(tip)

        self._menu.clear()
        view = {"state": state, "backgroundMode": background}
        for item in MENU_ITEMS:
            kind = item["kind"]
            if kind == "separator":
                self._menu.addSeparator()
            elif kind == "status":
                act = QAction(line[0].upper() + line[1:], self._menu)
                act.setEnabled(False)
                self._menu.addAction(act)
            elif kind == "check":
                act = QAction(item["label"], self._menu)
                act.setCheckable(True)
                act.setChecked(item["checked"](view))
                act.triggered.connect(lambda _=False, a=item["action"]: self.on_action(a))
                self._menu.addAction(act)
            else:
                act = QAction(item["label"], self._menu)
                enabled = item.get("enabled")
                if enabled is not None:
                    act.setEnabled(enabled(view))
                act.triggered.connect(lambda _=False, a=item["action"]: self.on_action(a))
                self._menu.addAction(act)


def _fmt_clock(seconds: float) -> str:
    total = int(seconds)
    h, m, s = total // 3600, (total % 3600) // 60, total % 60
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"

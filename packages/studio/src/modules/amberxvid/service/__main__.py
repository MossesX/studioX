"""AmberX Vid tray service — background webcam recording with the browser closed.

    .venv\\Scripts\\pythonw.exe src\\modules\\amberxvid\\service\\__main__.py \\
        --base-url http://localhost:80

The Windows-local half of the recording suite (prod users record in-browser by
design). It records the webcam through ffmpeg dshow (`capture.py`) straight
into the library store — the same `data/amberxvid/recordings/` tree, the same
v1 manifest, `engine: "tray"` — so a finished background capture simply
appears in the library at the next login.

Sync with the web app is the two-file channel under `<root>/tray/` (see the
tray-sync section of `src/lib/amberxvid/types.ts`):

  * it WRITES `status.json` — heartbeat, capture state, elapsed/size readouts,
    the tray-menu background request, the last finalized capture;
  * it READS `commands.json` — record/background commands queued by the web
    toolbar via `/api/amberxvid/tray`, plus the module's heartbeat context
    (capture owner, live recorder settings, and the browser-engine flag that
    is the double-capture guard: the tray refuses to open the device while a
    FRESH context says the browser engine is recording, and the web refuses
    the reverse — one device, one owner, never both).

On boot the command cursor starts past the file's max seq, so commands queued
against a dead service are never replayed. Started/stopped from the web
through `/api/amberxvid/tray` (`start-service`/`stop-service`) or by hand.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
import webbrowser
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

from capture import TrayRecorder, data_root, list_dshow_devices, utc_now, write_json_atomic

SERVICE_VERSION = "1.0.0"

#: Context older than this is ignored — mirror of TRAY_FRESH_MS in types.ts.
FRESH_S = 12.0


def log_line(root: str, line: str) -> None:
    try:
        path = os.path.join(root, "tray", "service.log")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf8") as fh:
            fh.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {line}\n")
    except OSError:
        pass


def parse_iso_age_s(stamp: str | None) -> float:
    """Seconds since an ISO timestamp, or +inf when unreadable."""
    if not stamp:
        return float("inf")
    try:
        then = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        return max(0.0, datetime.now(then.tzinfo).timestamp() - then.timestamp())
    except ValueError:
        return float("inf")


class Service:
    """The poll loop's state: recorder, devices, background mode, sync cursor."""

    def __init__(self, root: str, base_url: str) -> None:
        self.root = root
        self.base_url = base_url.rstrip("/")
        self.recorder = TrayRecorder(root)
        self.devices_video: list[str] = []
        self.devices_audio: list[str] = []
        self.background = False
        self.bg_local_at: float = 0.0  # monotonic stamp of the last TRAY-side toggle
        self.bg_request: dict | None = None
        self.last_seq = 0
        self.last_owner = "GizmoX"
        self.tray = None  # set by main() in tray mode

    # -- files -------------------------------------------------------------- #

    def status_file(self) -> str:
        return os.path.join(self.root, "tray", "status.json")

    def commands_file(self) -> str:
        return os.path.join(self.root, "tray", "commands.json")

    def read_commands(self) -> dict:
        try:
            with open(self.commands_file(), encoding="utf8") as fh:
                data = json.load(fh)
            return data if isinstance(data, dict) and data.get("version") == 1 else {}
        except (OSError, json.JSONDecodeError):
            return {}

    # -- boot --------------------------------------------------------------- #

    def boot(self) -> None:
        cmds = self.read_commands()
        # Never replay commands queued while the service was down.
        self.last_seq = int(cmds.get("seq") or 0)
        ctx = cmds.get("context") or {}
        if isinstance(ctx.get("owner"), str) and ctx["owner"]:
            self.last_owner = ctx["owner"]
        self.background = bool(ctx.get("backgroundArmed", False))
        # A finished capture the web has not journaled yet must survive a restart.
        try:
            with open(self.status_file(), encoding="utf8") as fh:
                prev = json.load(fh)
            if isinstance(prev, dict) and isinstance(prev.get("lastFinalized"), dict):
                self.recorder.last_finalized = prev["lastFinalized"]
        except (OSError, json.JSONDecodeError):
            pass
        self.refresh_devices()

    def refresh_devices(self) -> None:
        self.devices_video, self.devices_audio = list_dshow_devices()

    # -- context ------------------------------------------------------------ #

    def fresh_context(self) -> dict | None:
        ctx = self.read_commands().get("context") or None
        if ctx and parse_iso_age_s(ctx.get("updatedAt")) <= FRESH_S:
            return ctx
        return None

    def settings(self) -> dict:
        ctx = self.read_commands().get("context") or {}
        raw = ctx.get("settings") or {}
        return {
            "resolution": raw.get("resolution", "1280x720"),
            "quality": raw.get("quality", "high"),
            "micOn": raw.get("micOn", True) is not False,
        }

    def owner(self) -> str:
        ctx = self.read_commands().get("context") or {}
        owner = ctx.get("owner")
        if isinstance(owner, str) and owner:
            self.last_owner = owner
        return self.last_owner

    # -- commands ----------------------------------------------------------- #

    def notify(self, title: str, body: str) -> None:
        if self.tray is not None:
            self.tray.notify(title, body)
        log_line(self.root, f"{title}: {body}")

    def cmd_record_start(self) -> None:
        if self.recorder.state != "idle":
            return
        ctx = self.fresh_context()
        if ctx and ctx.get("browserRecording") is True:
            # The double-capture guard: one device, one owner.
            self.notify("AmberX Vid", "The browser engine owns the camera right now — stop that capture first.")
            return
        if not self.devices_video:
            self.refresh_devices()
        if not self.devices_video:
            self.recorder.last_error = "no DirectShow camera was found"
            self.notify("AmberX Vid", "No camera found — is one connected?")
            return
        settings = self.settings()
        audio = self.devices_audio[0] if self.devices_audio else None
        rec_id = self.recorder.start(self.owner(), settings, self.devices_video[0], audio)
        if rec_id:
            self.notify("AmberX Vid", f"Background recording started ({settings['resolution']}, {settings['quality']}).")
        else:
            self.notify("AmberX Vid", self.recorder.last_error or "The capture could not start.")

    def cmd_record_stop(self) -> None:
        fin = self.recorder.stop()
        if fin:
            mb = fin["sizeBytes"] / 1024 / 1024
            self.notify("AmberX Vid", f"Capture saved to the library — {fin['durationS']}s, {mb:.1f} MB.")
        elif self.recorder.last_error:
            self.notify("AmberX Vid", self.recorder.last_error)

    def set_background(self, value: bool, from_tray: bool) -> None:
        if value == self.background and not from_tray:
            return
        self.background = value
        if from_tray:
            # The web setting stays the source of truth — the tray only requests.
            self.bg_local_at = time.monotonic()
            self.bg_request = {"value": value, "at": utc_now()}
            self.notify("AmberX Vid", f"Background mode {'armed' if value else 'off'} — syncing to the app.")
        else:
            self.bg_local_at = 0.0
            self.bg_request = None

    def handle(self, cmd: str, app=None, text: str = "") -> None:
        if cmd == "alert":
            # P13: a ring arrived while the browser tab was backgrounded. The
            # only command that carries text and the only one that touches
            # nothing on the recorder — the tray is the module's one
            # always-running surface, so it is where a ring goes when the tab
            # cannot show it. Empty text is dropped rather than shown as a
            # blank balloon.
            if text:
                self.notify("AmberX Vid", text)
        elif cmd == "record-start":
            self.cmd_record_start()
        elif cmd == "record-stop":
            self.cmd_record_stop()
        elif cmd == "record-pause":
            if self.recorder.pause():
                self.notify("AmberX Vid", "Recording paused.")
        elif cmd == "record-resume":
            if self.recorder.resume():
                self.notify("AmberX Vid", "Recording resumed.")
        elif cmd == "background-on":
            self.set_background(True, from_tray=False)
        elif cmd == "background-off":
            self.set_background(False, from_tray=False)
        elif cmd == "background-toggle":
            self.set_background(not self.background, from_tray=True)
        elif cmd == "reload" or cmd == "reload-devices":
            self.refresh_devices()
            self.notify("AmberX Vid", f"Devices reloaded — {len(self.devices_video)} camera(s), {len(self.devices_audio)} mic(s).")
        elif cmd == "open-amberxvid":
            webbrowser.open(f"{self.base_url}/amberxvid")
        elif cmd == "quit":
            log_line(self.root, "quit command")
            self.shutdown()
            if app is not None:
                app.quit()

    def tick(self, app=None) -> None:
        """One poll: detect ffmpeg death, run new commands, adopt the web's
        background truth, write the heartbeat, retint the tray."""
        self.recorder.tick()

        cmds = self.read_commands()
        for command in cmds.get("commands") or []:
            try:
                seq = int(command.get("seq") or 0)
            except (TypeError, ValueError):
                continue
            if seq > self.last_seq:
                self.last_seq = seq
                self.handle(str(command.get("cmd") or ""), app, str(command.get("text") or ""))

        # Background truth: the web setting wins as soon as its context is
        # newer than the last tray-side toggle (which it acks by adopting).
        ctx = cmds.get("context") or {}
        ctx_age = parse_iso_age_s(ctx.get("updatedAt"))
        if ctx and ctx_age != float("inf"):
            local_age = (time.monotonic() - self.bg_local_at) if self.bg_local_at else float("inf")
            if ctx_age < local_age:
                web_value = bool(ctx.get("backgroundArmed", False))
                if web_value == self.background and self.bg_request is not None:
                    self.bg_request = None  # adopted — stop requesting
                elif self.bg_request is None:
                    self.background = web_value

        self.write_status()
        if self.tray is not None:
            self.tray.rebuild(self.status_view())

    # -- status ------------------------------------------------------------- #

    def status_view(self) -> dict:
        return {
            "state": self.recorder.state,
            "backgroundMode": self.background,
            "elapsedS": self.recorder.elapsed_s(),
            "lastError": self.recorder.last_error,
        }

    def write_status(self, alive: bool = True) -> None:
        """Heartbeat. ``alive=False`` reports a clean shutdown (pid null)."""
        status = {
            "version": 1,
            "pid": os.getpid() if alive else None,
            "serviceVersion": SERVICE_VERSION,
            "heartbeatAt": utc_now(),
            "state": self.recorder.state,
            "backgroundMode": self.background,
            "backgroundRequest": self.bg_request,
            "recordingId": self.recorder.recording_id,
            "recordingOwner": self.recorder.owner,
            "startedAt": self.recorder.started_at,
            "elapsedS": self.recorder.elapsed_s(),
            "sizeBytes": self.recorder.size_bytes(),
            "lastFinalized": self.recorder.last_finalized,
            "lastError": self.recorder.last_error,
            "devices": {"video": self.devices_video, "audio": self.devices_audio},
        }
        try:
            write_json_atomic(self.status_file(), status)
        except OSError:
            pass

    def shutdown(self) -> None:
        """Finalize any running capture, then report a clean exit (pid null)."""
        self.recorder.shutdown()
        self.write_status(alive=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="AmberX Vid background recording tray service")
    parser.add_argument("--base-url", default="http://localhost:3200", help="the running AmberX studio app")
    parser.add_argument("--data-dir", default=None, help="store root override (else AMBERXVID_DATA_DIR / repo default)")
    parser.add_argument("--poll", type=float, default=1.0, help="command/heartbeat poll seconds")
    parser.add_argument("--once", action="store_true", help="probe devices, write one status, print JSON, exit")
    args = parser.parse_args()

    root = data_root(args.data_dir)
    svc = Service(root, args.base_url)
    svc.boot()

    if args.once:
        svc.write_status(alive=False)
        print(json.dumps({
            "ok": True,
            "root": root,
            "devices": {"video": svc.devices_video, "audio": svc.devices_audio},
            "statusFile": svc.status_file(),
        }, indent=2))
        return 0

    from PyQt6.QtCore import QTimer
    from PyQt6.QtWidgets import QApplication

    from tray import Tray

    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)  # a tray app has no windows

    svc.tray = Tray(args.base_url, lambda action: svc.handle(action, app))
    svc.tray.rebuild(svc.status_view())
    svc.tray.show()
    svc.write_status()
    log_line(root, f"started pid={os.getpid()} base={svc.base_url} cameras={len(svc.devices_video)}")

    timer = QTimer()
    timer.timeout.connect(lambda: svc.tick(app))
    timer.start(max(250, int(args.poll * 1000)))

    code = app.exec()
    svc.shutdown()
    log_line(root, f"stopped with code {code}")
    return code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        try:
            log_line(data_root(), "fatal:\n" + traceback.format_exc())
        finally:
            raise

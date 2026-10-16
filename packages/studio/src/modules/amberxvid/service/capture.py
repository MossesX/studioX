"""AmberX Vid background capture engine — ffmpeg dshow into the library store.

This is the engine that makes "keeps recording with the browser closed" real:
a plain ffmpeg process capturing the webcam through DirectShow, writing into
the SAME store the browser engine uses (`data/amberxvid/recordings/<id>/`, or
`AMBERXVID_DATA_DIR` when set — the identical env override the web reads), as
the SAME versioned v1 manifest with ``engine: "tray"``. The library (P5) and
the recent-captures strip discover a finished background capture from disk
with zero extra plumbing.

Pause is real, not cosmetic: ffmpeg cannot suspend a dshow graph on Windows,
so the recorder captures **segments** — pause gracefully quits the current
ffmpeg (``q`` on stdin), resume starts the next segment, and finalize stitches
them losslessly with the concat demuxer (same codec settings throughout, so it
is a pure remux). One segment skips the concat entirely.

Honesty posture matches the web store: a capture that produced no media is
discarded, a mid-capture ffmpeg death finalizes whatever real footage exists
(with the error preserved in the manifest notes), and the thumbnail failing
leaves ``thumbnail: null`` rather than failing the save.
"""

from __future__ import annotations

import json
import os
import re
import secrets
import subprocess
import time
from datetime import datetime, timezone

# app root = .../src/modules/amberxvid/service -> up four. In the AmberX
# studio monorepo this resolves to packages/studio — the Next app's cwd — so
# the default store lands beside the web store (packages/studio/data/amberxvid).
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))

# Windows: no console window per spawned ffmpeg (the service runs under pythonw).
CREATE_NO_WINDOW = 0x08000000 if os.name == "nt" else 0

#: Mirror of ``QUALITY_BITRATES`` in ``src/modules/amberxvid/Recorder.tsx`` —
#: the same preset must mean the same bitrate in both engines.
QUALITY_BITRATES: dict[str, tuple[int, int]] = {
    "low": (1_200_000, 64_000),
    "medium": (2_500_000, 96_000),
    "high": (5_000_000, 128_000),
    "max": (12_000_000, 192_000),
}

#: A segment must survive this long before its death counts as "mid-capture"
#: rather than "the device rejected the configuration" (→ constraint fallback).
EARLY_DEATH_S = 4.0


def data_root(override: str | None = None) -> str:
    """The store root — the same resolution order as ``@/lib/amberxvid/paths``."""
    env = (override or os.environ.get("AMBERXVID_DATA_DIR") or "").strip()
    return os.path.abspath(env) if env else os.path.join(REPO_ROOT, "data", "amberxvid")


def ffmpeg_path() -> str:
    """The in-tree ffmpeg-static binary, else whatever is on PATH."""
    exe = os.path.join(REPO_ROOT, "node_modules", "ffmpeg-static", "ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    return exe if os.path.exists(exe) else "ffmpeg"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def new_recording_id() -> str:
    """Same shape the web store enforces: ``rec-YYYYMMDD-HHMMSS-<6 hex>``."""
    return f"rec-{time.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}"


def write_json_atomic(file: str, value: dict) -> None:
    os.makedirs(os.path.dirname(file), exist_ok=True)
    tmp = f"{file}.{os.getpid()}.{int(time.time() * 1000)}.tmp"
    with open(tmp, "w", encoding="utf8") as fh:
        json.dump(value, fh, indent=2)
        fh.write("\n")
    os.replace(tmp, file)


# --------------------------------------------------------------------------- #
# device discovery
# --------------------------------------------------------------------------- #

def list_dshow_devices(timeout_s: float = 12.0) -> tuple[list[str], list[str]]:
    """Enumerate DirectShow capture devices via ffmpeg.

    ``-list_devices`` prints to stderr and "fails" by design. Handles both
    stderr formats: the modern ``"Name" (video)`` suffix lines and the older
    section-headed listing (``DirectShow video devices`` → quoted names).
    """
    try:
        proc = subprocess.run(
            [ffmpeg_path(), "-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"],
            capture_output=True,
            text=True,
            encoding="utf-8",  # ffmpeg prints device names as UTF-8, not the ANSI code page
            errors="replace",
            timeout=timeout_s,
            creationflags=CREATE_NO_WINDOW,
        )
    except (OSError, subprocess.TimeoutExpired):
        return [], []

    video: list[str] = []
    audio: list[str] = []
    section: str | None = None
    for line in (proc.stderr or "").splitlines():
        if "DirectShow video devices" in line:
            section = "video"
            continue
        if "DirectShow audio devices" in line:
            section = "audio"
            continue
        m = re.search(r'"([^"]+)"\s*\((video|audio)\)', line)
        if m:
            (video if m.group(2) == "video" else audio).append(m.group(1))
            continue
        m = re.search(r'"([^"]+)"\s*$', line)
        if m and section and "Alternative name" not in line:
            (video if section == "video" else audio).append(m.group(1))
    # De-dupe preserving order — some builds print a device in both formats.
    return list(dict.fromkeys(video)), list(dict.fromkeys(audio))


# --------------------------------------------------------------------------- #
# the recorder
# --------------------------------------------------------------------------- #

class TrayRecorder:
    """Segment-based dshow capture with the v1 library manifest lifecycle."""

    def __init__(self, root: str) -> None:
        self.root = root
        self.state: str = "idle"  # idle | recording | paused
        self.recording_id: str | None = None
        self.owner: str | None = None
        self.started_at: str | None = None
        self.last_error: str | None = None
        self.last_finalized: dict | None = None
        self._proc: subprocess.Popen | None = None
        self._segments: list[str] = []
        self._seg_started_mono: float = 0.0
        self._accum_s: float = 0.0
        self._fallback_tried = False
        self._settings: dict = {}
        self._audio_device: str | None = None
        self._video_device: str | None = None

    # -- paths -------------------------------------------------------------- #

    def _dir(self) -> str:
        assert self.recording_id is not None
        return os.path.join(self.root, "recordings", self.recording_id)

    def _manifest_file(self) -> str:
        return os.path.join(self._dir(), "manifest.json")

    # -- readouts ----------------------------------------------------------- #

    def elapsed_s(self) -> float:
        run = (time.monotonic() - self._seg_started_mono) if self.state == "recording" else 0.0
        return round(self._accum_s + run, 1)

    def size_bytes(self) -> int:
        if self.recording_id is None:
            return 0
        total = 0
        for seg in self._segments:
            try:
                total += os.path.getsize(os.path.join(self._dir(), seg))
            except OSError:
                pass
        return total

    # -- lifecycle ---------------------------------------------------------- #

    def start(self, owner: str, settings: dict, video_device: str, audio_device: str | None) -> str | None:
        """Begin a capture: write the open manifest, spawn segment 0.

        Returns the new recording id, or None with ``last_error`` set.
        """
        if self.state != "idle":
            self.last_error = "a capture is already running"
            return None
        self.last_error = None
        self.recording_id = new_recording_id()
        self.owner = owner
        self.started_at = utc_now()
        self._segments = []
        self._accum_s = 0.0
        self._fallback_tried = False
        self._settings = dict(settings)
        self._video_device = video_device
        self._audio_device = audio_device if settings.get("micOn", True) else None

        w, h = self._resolution()
        manifest = {
            "version": 1,
            "id": self.recording_id,
            "owner": owner,
            "title": f"Background capture {self.started_at[:16].replace('T', ' ')}",
            "engine": "tray",
            "file": "media.mkv",
            "mimeType": "video/x-matroska",
            "startedAt": self.started_at,
            "endedAt": None,
            "durationS": 0,
            "sizeBytes": 0,
            "width": w,
            "height": h,
            "micEnabled": self._audio_device is not None,
            "quality": self._quality(),
            "thumbnail": None,
            "notes": "",
            "tags": [],
            "edits": [],
        }
        try:
            write_json_atomic(self._manifest_file(), manifest)
            self._spawn_segment()
        except OSError as err:
            self.last_error = f"could not start the capture: {err}"
            self._cleanup_open()
            return None
        self.state = "recording"
        return self.recording_id

    def pause(self) -> bool:
        if self.state != "recording":
            return False
        self._accum_s += time.monotonic() - self._seg_started_mono
        self._stop_segment()
        self.state = "paused"
        return True

    def resume(self) -> bool:
        if self.state != "paused":
            return False
        try:
            self._spawn_segment()
        except OSError as err:
            self.last_error = f"could not resume: {err}"
            return False
        self.state = "recording"
        return True

    def stop(self) -> dict | None:
        """End the capture and finalize it into the library. None = discarded."""
        if self.state == "idle":
            return None
        if self.state == "recording":
            self._accum_s += time.monotonic() - self._seg_started_mono
            self._stop_segment()
        return self._finalize()

    def tick(self) -> None:
        """Detect a mid-capture ffmpeg death — called from the service poll."""
        if self.state != "recording" or self._proc is None:
            return
        code = self._proc.poll()
        if code is None:
            return
        alive_s = time.monotonic() - self._seg_started_mono
        self._proc = None
        if alive_s < EARLY_DEATH_S and not self._fallback_tried and len(self._segments) == 1:
            # The device likely rejected the exact size — retry unconstrained.
            self._fallback_tried = True
            self._drop_current_segment()
            try:
                self._spawn_segment(constrain=False)
                return
            except OSError as err:
                self.last_error = f"ffmpeg could not open the device: {err}"
        else:
            self.last_error = f"ffmpeg exited mid-capture (code {code}) — {self._stderr_tail()}"
        self._accum_s += alive_s
        self._finalize(error_note=self.last_error)

    # -- ffmpeg plumbing ---------------------------------------------------- #

    def _quality(self) -> str:
        q = str(self._settings.get("quality", "high"))
        return q if q in QUALITY_BITRATES else "high"

    def _resolution(self) -> tuple[int, int]:
        m = re.fullmatch(r"(\d+)x(\d+)", str(self._settings.get("resolution", "1280x720")))
        return (int(m.group(1)), int(m.group(2))) if m else (1280, 720)

    def _seg_log(self) -> str:
        return os.path.join(self._dir(), "capture.log")

    def _stderr_tail(self, lines: int = 3) -> str:
        try:
            with open(self._seg_log(), encoding="utf8", errors="replace") as fh:
                tail = [ln.strip() for ln in fh.readlines() if ln.strip()][-lines:]
            return " | ".join(tail)[:400] or "no ffmpeg output captured"
        except OSError:
            return "no ffmpeg output captured"

    def _spawn_segment(self, constrain: bool = True) -> None:
        seg = f"seg-{len(self._segments):03d}.mkv"
        vbit, abit = QUALITY_BITRATES[self._quality()]
        w, h = self._resolution()

        source = f"video={self._video_device}"
        if self._audio_device:
            source += f":audio={self._audio_device}"
        args = [ffmpeg_path(), "-hide_banner", "-y", "-f", "dshow", "-rtbufsize", "100M"]
        if constrain:
            args += ["-video_size", f"{w}x{h}"]
        args += ["-i", source]
        args += ["-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-b:v", str(vbit)]
        if self._audio_device:
            args += ["-c:a", "aac", "-b:a", str(abit)]
        args.append(os.path.join(self._dir(), seg))

        log = open(self._seg_log(), "ab")  # noqa: SIM115 — handed to the child process
        try:
            self._proc = subprocess.Popen(
                args,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=log,
                creationflags=CREATE_NO_WINDOW,
            )
        finally:
            log.close()
        self._segments.append(seg)
        self._seg_started_mono = time.monotonic()

    def _stop_segment(self) -> None:
        """Graceful quit (``q`` on stdin) so the container index gets written."""
        proc, self._proc = self._proc, None
        if proc is None or proc.poll() is not None:
            return
        try:
            assert proc.stdin is not None
            proc.stdin.write(b"q")
            proc.stdin.flush()
            proc.wait(timeout=8)
        except (OSError, ValueError, subprocess.TimeoutExpired, AssertionError):
            proc.terminate()
            try:
                proc.wait(timeout=4)
            except subprocess.TimeoutExpired:
                proc.kill()
        finally:
            try:
                if proc.stdin:
                    proc.stdin.close()
            except OSError:
                pass

    def _drop_current_segment(self) -> None:
        if not self._segments:
            return
        seg = self._segments.pop()
        try:
            os.remove(os.path.join(self._dir(), seg))
        except OSError:
            pass

    # -- finalize ----------------------------------------------------------- #

    def _to_playable(self, media: str, rec_dir: str) -> tuple[str, str]:
        """Remux the finished Matroska into mp4 so a browser can play it back.

        Capture writes .mkv on purpose — Matroska tolerates a killed process,
        which a background recorder has to assume — but Chrome and Edge refuse
        ``video/x-matroska`` in a <video> element, so every tray capture played
        back blank until this step existed (found 2026-08-03). The streams are
        already h264+aac, so this is a stream copy: lossless and quick, with
        ``+faststart`` moving the moov atom to the front for instant seeking.

        Degrade, never crash: any failure keeps the .mkv exactly as captured
        and reports it as Matroska — an awkward playback beats a lost capture.
        """
        if not media.lower().endswith(".mkv"):
            return media, "video/mp4" if media.lower().endswith(".mp4") else "video/x-matroska"
        out = os.path.join(rec_dir, "media.mp4")
        try:
            proc = subprocess.run(
                [ffmpeg_path(), "-hide_banner", "-y", "-i", media,
                 "-c", "copy", "-movflags", "+faststart", out],
                capture_output=True,
                timeout=180,
                creationflags=CREATE_NO_WINDOW,
            )
        except (OSError, subprocess.TimeoutExpired) as err:
            self.last_error = f"playback remux failed, keeping the mkv: {err}"
            return media, "video/x-matroska"
        if proc.returncode != 0 or not os.path.exists(out) or os.path.getsize(out) == 0:
            try:
                os.remove(out)
            except OSError:
                pass
            return media, "video/x-matroska"
        try:
            os.remove(media)
        except OSError:
            pass
        return out, "video/mp4"

    def _finalize(self, error_note: str | None = None) -> dict | None:
        rec_dir = self._dir()
        rec_id = self.recording_id
        segments = [
            s for s in self._segments
            if os.path.exists(os.path.join(rec_dir, s)) and os.path.getsize(os.path.join(rec_dir, s)) > 0
        ]
        duration = round(self._accum_s, 1)

        if not segments:
            # Nothing real was captured — discard, exactly like the web store.
            self._cleanup_open()
            if error_note is None:
                self.last_error = "no media was captured — recording discarded"
            return None

        media = os.path.join(rec_dir, "media.mkv")
        try:
            if len(segments) == 1:
                os.replace(os.path.join(rec_dir, segments[0]), media)
            else:
                list_file = os.path.join(rec_dir, "concat.txt")
                with open(list_file, "w", encoding="utf8") as fh:
                    for seg in segments:
                        fh.write(f"file '{os.path.join(rec_dir, seg).replace(os.sep, '/')}'\n")
                proc = subprocess.run(
                    [ffmpeg_path(), "-hide_banner", "-y", "-f", "concat", "-safe", "0",
                     "-i", list_file, "-c", "copy", media],
                    capture_output=True,
                    timeout=120,
                    creationflags=CREATE_NO_WINDOW,
                )
                os.remove(list_file)
                if proc.returncode != 0 or not os.path.exists(media):
                    # Remux failed — keep the longest real segment rather than lose all.
                    biggest = max(segments, key=lambda s: os.path.getsize(os.path.join(rec_dir, s)))
                    os.replace(os.path.join(rec_dir, biggest), media)
                for seg in segments:
                    try:
                        os.remove(os.path.join(rec_dir, seg))
                    except OSError:
                        pass
        except (OSError, subprocess.TimeoutExpired) as err:
            self.last_error = f"could not assemble the capture: {err}"
            self._reset()
            return None

        media, mime = self._to_playable(media, rec_dir)
        size = os.path.getsize(media)
        thumb = self._thumbnail(media, rec_dir)

        try:
            with open(self._manifest_file(), encoding="utf8") as fh:
                manifest = json.load(fh)
        except (OSError, json.JSONDecodeError):
            manifest = {}
        notes = "Captured in the background by the tray service."
        if error_note:
            notes += f" Capture ended early: {error_note}"
        manifest.update(
            endedAt=utc_now(),
            durationS=duration,
            sizeBytes=size,
            thumbnail=thumb,
            notes=notes,
            file=os.path.basename(media),
            mimeType=mime,
        )
        write_json_atomic(self._manifest_file(), manifest)

        self.last_finalized = {"id": rec_id, "at": manifest["endedAt"], "durationS": duration, "sizeBytes": size}
        self._reset()
        return self.last_finalized

    def _thumbnail(self, media: str, rec_dir: str) -> str | None:
        """One 320 px poster frame — the web store's exact recipe."""
        thumb = os.path.join(rec_dir, "thumb.jpg")
        for ss in ("0.5", "0"):
            try:
                subprocess.run(
                    [ffmpeg_path(), "-hide_banner", "-y", "-i", media, "-ss", ss,
                     "-frames:v", "1", "-vf", "scale=320:-2", thumb],
                    capture_output=True,
                    timeout=30,
                    creationflags=CREATE_NO_WINDOW,
                )
            except (OSError, subprocess.TimeoutExpired):
                continue
            if os.path.exists(thumb) and os.path.getsize(thumb) > 0:
                return "thumb.jpg"
        return None

    # -- teardown ----------------------------------------------------------- #

    def _cleanup_open(self) -> None:
        """Remove an open capture that produced nothing (never a finished one)."""
        if self.recording_id is not None:
            import shutil

            shutil.rmtree(self._dir(), ignore_errors=True)
        self._reset()

    def _reset(self) -> None:
        self.state = "idle"
        self.recording_id = None
        self.owner = None
        self.started_at = None
        self._proc = None
        self._segments = []
        self._accum_s = 0.0

    def shutdown(self) -> None:
        """Service exit: a running capture is finalized, never orphaned."""
        if self.state != "idle":
            self.stop()

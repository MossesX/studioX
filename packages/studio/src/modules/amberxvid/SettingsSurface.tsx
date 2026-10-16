"use client";

/**
 * @file **THE SETTINGS TREE** (P16) — the suite's `?view=settings` stage: every
 * preference a member of AmberX Vid has, in six groups, all of them per accounts
 * user.
 *
 * Named `SettingsSurface.tsx` rather than `Settings.tsx` because `settings.ts`
 * — the store adapter it reads — already sits beside it, and on a
 * case-insensitive filesystem TypeScript refuses a program containing both
 * (`TS1149`). The same collision `markdown.ts`/`Markdown.tsx` produced in the
 * Claude workspace; the fix is a name that differs by more than case.
 *
 * ---------------------------------------------------------------------------
 * SIX GROUPS, THREE STORES, AND WHY THAT IS NOT A MESS
 * ---------------------------------------------------------------------------
 * A settings screen usually has one store. This one has three, and the rule
 * that picks between them is simple and is the reason the tree can be trusted:
 * **a row is edited where the code that ENFORCES it reads.**
 *
 *  - **kv** (`lib/prefs.ts`, the decl's rows, `data/axf/kv/<user>/amberxvid-settings.json`)
 *    — NOTIFICATIONS, PRIVACY DEFAULTS, DEVICES, PLAYBACK, and the messenger's
 *    enter-to-send. These are the accounts settings spine: core's settings
 *    store writes them and the studio host scopes the document to the verified
 *    `axs_session` user, so nothing here implements per-user persistence.
 *  - **the availability document** (`/api/amberxvid/availability`) — DND. The
 *    ring path reads it on every invite through `lib/dnd.ts`. A kv mirror would
 *    be a switch that edits a copy the server never looks at.
 *  - **the messenger document** (`/api/amberxvid/messenger`) — the chime, the
 *    timestamps and the popup. `mayInterrupt` reads the chime field to decide
 *    whether a broadcast alert may fire, so the same rule applies.
 *
 * The shell's gear (*Module settings* on the universal band) opens the FRAMEWORK
 * dialog over the kv half. That is not a competing surface — it is the same
 * store, rendered without the chrome this screen adds: a live camera preview, a
 * microphone level meter, and the two document groups the dialog structurally
 * cannot host.
 *
 * ---------------------------------------------------------------------------
 * THE GENERIC ROWS ARE GENERATED, DELIBERATELY
 * ---------------------------------------------------------------------------
 * Every kv row except the two device pickers is rendered FROM the decl — its
 * label, its hint, its control kind and its options. So a row added to
 * `amberxvid.decl.ts` appears here with no edit, and a row whose hint is
 * rewritten there cannot say something different here. `PREF_GROUPS` in
 * `lib/prefs.ts` decides which group it lands in, and a key in no group is
 * reported on screen rather than silently dropped — an absence you can see is
 * the only kind that gets fixed.
 *
 * ---------------------------------------------------------------------------
 * THE DEVICE PREVIEW OWNS A REAL CAMERA, SO IT HAS TO GIVE IT BACK
 * ---------------------------------------------------------------------------
 * The preview holds an actual `MediaStream`. Every path that leaves it — a
 * device change, the group collapsing, the stage changing, the component
 * unmounting — stops every track, and the stream is held in a ref rather than
 * in state so a cleanup can never close over a stale one. A settings screen
 * that leaves the camera light on is the most alarming bug this file could
 * ship, so the teardown is the part written first.
 *
 * It also refuses to open the camera while a CALL is live: `getUserMedia` on a
 * device already in use fails on some drivers and steals it on others, and
 * neither is something a member should discover by visiting their settings.
 */

import * as React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { GX, gxa } from "./kit/gx";
import { GxCard, GxChip } from "./kit/ax";
// No `CreditsPane` import any more (P19): the card reaches this stage through
// `amberxvid.settings-section`, and the registry is the only link.
import { SettingsSections } from "./PointSlots";
import { GizmoXMark } from "./gizmox-kit";
import { Settings as SettingsIcon } from "./kit/icons";
import { DarkMode as DndIcon } from "./kit/icons";
import { Schedule as ScheduleIcon } from "./kit/icons";
import { Videocam as CameraIcon } from "./kit/icons";
import { RecordVoiceOver as MicIcon } from "./kit/icons";
import { Chat as ChatIcon } from "./kit/icons";
import { Refresh as RefreshIcon } from "./kit/icons";
import { AMBERXVID_DECL } from "./amberxvid.decl";
import { PREF_GROUPS, QUARTER_MINUTES, DAY_LABELS, clockHHMM } from "./lib/prefs";
import type { AmberxvidPrefs, PrefGroup, PrefKey } from "./lib/prefs";
import { amberxvidPrefs, useAmberxvidPrefs } from "./settings";
import type { AvailabilityDoc, MessengerSettings } from "./lib/types";

/* ================================ plumbing =================================== */

type SettingValue = boolean | number | string;

interface DeclRow {
  key: string;
  label: string;
  hint: string;
  kind: "switch" | "number" | "text" | "select";
  defaultValue: SettingValue;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly { value: string; label: string }[];
}

/** The decl's rows, by key. Read once — the decl is a module-scope constant. */
const ROWS: Record<string, DeclRow> = Object.fromEntries(
  (AMBERXVID_DECL.settings?.rows ?? []).map((r) => [r.key, r as DeclRow]),
);

interface AvailabilityReply {
  ok?: boolean;
  availability?: AvailabilityDoc;
  summary?: string;
}

interface MessengerReply {
  ok?: boolean;
  settings?: MessengerSettings;
}

/* ============================== the row shell ================================ */

/**
 * One row: label, its one-sentence hint, and its control on the right. Every
 * group uses it — including the document groups — so a member cannot tell which
 * store answered, which is the point. They are settings; where they live is the
 * app's problem.
 */
function Row({
  label,
  hint,
  control,
  icon,
  indent = false,
}: {
  label: string;
  hint: string;
  control: React.ReactNode;
  icon?: React.ReactNode;
  indent?: boolean;
}) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        py: 0.85,
        pl: indent ? 3.5 : 0,
        borderBottom: `1px solid ${gxa(GX.edge, "44")}`,
        "&:last-of-type": { borderBottom: "none" },
      }}
    >
      {icon}
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>{label}</Typography>
        <Typography sx={{ fontSize: 10.5, color: GX.dim }}>{hint}</Typography>
      </Box>
      {control}
    </Box>
  );
}

/**
 * A kv row rendered straight from its declaration. The control kind, the
 * bounds and the options are the decl's, never restated — see the file header.
 */
function DeclaredRow({
  rowKey,
  prefs,
  onSet,
}: {
  rowKey: PrefKey;
  prefs: AmberxvidPrefs;
  onSet: (key: PrefKey, value: SettingValue) => void;
}) {
  const row = ROWS[rowKey];
  if (!row) {
    // A group naming a key the decl does not declare. Said out loud rather than
    // rendered as nothing — see the header.
    return (
      <Row
        label={rowKey}
        hint="This setting is listed in a group but is not declared in the module — nothing can change it."
        control={<GxChip label="undeclared" kind="err" />}
      />
    );
  }
  const value = prefs[rowKey] as SettingValue;
  const el = `amberxvid:settings:${rowKey}`;

  let control: React.ReactNode;
  switch (row.kind) {
    case "switch":
      control = (
        <Switch
          size="small"
          checked={value === true}
          onChange={(e) => onSet(rowKey, e.target.checked)}
          data-el-id={el}
          slotProps={{ input: { "aria-label": row.label } }}
        />
      );
      break;
    case "number":
      control = (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, width: 210 }}>
          <Slider
            size="small"
            min={row.min ?? 0}
            max={row.max ?? 100}
            step={row.step ?? 1}
            value={typeof value === "number" ? value : 0}
            // Committed rather than live: the store PUTs on every change, and a
            // slider drag would otherwise be one request per pixel.
            onChangeCommitted={(_, v) => onSet(rowKey, Array.isArray(v) ? v[0] : v)}
            data-el-id={el}
            aria-label={row.label}
            sx={{ flex: 1 }}
          />
          <Typography sx={{ fontSize: 11, color: GX.dim, fontFamily: GX.mono, minWidth: 42, textAlign: "right" }}>
            {String(value)}
          </Typography>
        </Box>
      );
      break;
    case "select":
      control = (
        <TextField
          select
          size="small"
          value={String(value)}
          onChange={(e) => onSet(rowKey, e.target.value)}
          data-el-id={el}
          sx={{ minWidth: 170 }}
        >
          {(row.options ?? []).map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      );
      break;
    default:
      control = (
        <TextField
          size="small"
          value={String(value)}
          onChange={(e) => onSet(rowKey, e.target.value)}
          data-el-id={el}
          sx={{ minWidth: 200 }}
        />
      );
  }

  return <Row label={row.label} hint={row.hint} control={control} />;
}

/* =============================== the devices ================================= */

/**
 * The DEVICES group: the two pickers, the live preview and the level meter.
 *
 * The preview is the reason this group is not generated. A `deviceId` picked
 * from a list you cannot see the output of is a guess, and "Camera 2" is not a
 * label anybody recognises — the preview is what turns the choice into an
 * observation.
 */
function DevicesGroup({
  prefs,
  onSet,
  callActive,
  notify,
}: {
  prefs: AmberxvidPrefs;
  onSet: (key: PrefKey, value: SettingValue) => void;
  callActive: boolean;
  notify: (m: string) => void;
}) {
  const [devices, setDevices] = React.useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({
    cams: [],
    mics: [],
  });
  const [previewOn, setPreviewOn] = React.useState(false);
  const [level, setLevel] = React.useState(0);
  const [why, setWhy] = React.useState<string | null>(null);

  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const audioCtxRef = React.useRef<AudioContext | null>(null);
  const rafRef = React.useRef<number | null>(null);

  /** Give the hardware back. Idempotent, and every exit calls it. */
  const teardown = React.useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx) void ctx.close().catch(() => {});
    const stream = streamRef.current;
    streamRef.current = null;
    for (const track of stream?.getTracks() ?? []) track.stop();
    if (videoRef.current) videoRef.current.srcObject = null;
    setLevel(0);
  }, []);

  // The unmount guarantee. Listed on its own rather than folded into the effect
  // below so that it survives any future change to that effect's deps.
  React.useEffect(() => teardown, [teardown]);

  /** Device labels are empty until a permission has been granted once, so the
   *  enumeration runs after a preview as well as on mount. */
  const enumerate = React.useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        cams: all.filter((d) => d.kind === "videoinput"),
        mics: all.filter((d) => d.kind === "audioinput"),
      });
    } catch {
      /* the "system default" options still work */
    }
  }, []);

  React.useEffect(() => {
    void enumerate();
  }, [enumerate]);

  const startPreview = React.useCallback(async () => {
    if (callActive) {
      notify("Finish the call before previewing — the camera is in use");
      return;
    }
    teardown();
    setWhy(null);
    const video: MediaTrackConstraints = {};
    const audio: MediaTrackConstraints = {};
    // `ideal`, never `exact` — a deviceId saved on another machine must cost a
    // default camera, not a refusal (see the decl's note on per-user devices).
    if (prefs.cameraId !== "default") video.deviceId = { ideal: prefs.cameraId };
    if (prefs.micId !== "default") audio.deviceId = { ideal: prefs.micId };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio });
      streamRef.current = stream;
      setPreviewOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => {});
      }
      void enumerate();

      // The meter. A plain time-domain peak rather than a frequency analysis:
      // the question is "is my voice reaching the machine", and a peak answers
      // it in one number a person can read at a glance.
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor && stream.getAudioTracks().length > 0) {
        const ctx = new Ctor();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
          // 128 is full scale for this encoding; the ×140 keeps a normal
          // speaking voice in the middle of the bar rather than at 8%.
          setLevel(Math.min(100, Math.round((peak / 128) * 140)));
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      }
    } catch (e) {
      teardown();
      setPreviewOn(false);
      setWhy(e instanceof Error ? e.message : "the browser refused the devices");
    }
  }, [callActive, enumerate, notify, prefs.cameraId, prefs.micId, teardown]);

  const stopPreview = React.useCallback(() => {
    teardown();
    setPreviewOn(false);
  }, [teardown]);

  /** Changing a device while previewing re-opens it, so the preview always
   *  shows the device the setting now names. */
  const pick = React.useCallback(
    (key: PrefKey, value: string) => {
      onSet(key, value);
      if (previewOn) {
        // The state the restart reads is the OLD one for this render, so the
        // restart is deferred a tick rather than reading `prefs` here.
        window.setTimeout(() => void startPreview(), 0);
      }
    },
    [onSet, previewOn, startPreview],
  );

  const label = (d: MediaDeviceInfo, i: number, kind: string) => d.label || `${kind} ${i + 1}`;

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Row
        label="Camera"
        hint="Which camera joins a call, a room or a broadcast."
        icon={<CameraIcon sx={{ fontSize: 18, color: GX.dim }} />}
        control={
          <TextField
            select
            size="small"
            value={prefs.cameraId}
            onChange={(e) => pick("cameraId", e.target.value)}
            data-el-id="amberxvid:settings:camera"
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="default">System default</MenuItem>
            {devices.cams.map((d, i) => (
              <MenuItem key={d.deviceId} value={d.deviceId}>
                {label(d, i, "Camera")}
              </MenuItem>
            ))}
          </TextField>
        }
      />
      <Row
        label="Microphone"
        hint="Which microphone joins a call — the meter below is how you check it is the right one."
        icon={<MicIcon sx={{ fontSize: 18, color: GX.dim }} />}
        control={
          <TextField
            select
            size="small"
            value={prefs.micId}
            onChange={(e) => pick("micId", e.target.value)}
            data-el-id="amberxvid:settings:mic"
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="default">System default</MenuItem>
            {devices.mics.map((d, i) => (
              <MenuItem key={d.deviceId} value={d.deviceId}>
                {label(d, i, "Mic")}
              </MenuItem>
            ))}
          </TextField>
        }
      />

      {/* the preview + meter */}
      <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start", py: 1.25 }}>
        <Box
          sx={{
            width: 208,
            height: 117,
            flexShrink: 0,
            position: "relative",
            bgcolor: GX.bg,
            border: `1px solid ${GX.edge}`,
            borderRadius: 1,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          data-el-id="amberxvid:settings:preview"
        >
          <video
            ref={videoRef}
            muted
            playsInline
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: previewOn ? "block" : "none",
              // Mirrored, like every other self-view in the suite — an
              // unmirrored preview reads as somebody else's camera.
              transform: "scaleX(-1)",
            }}
          />
          {!previewOn && <GizmoXMark size={44} glow={false} />}
        </Box>

        <Box sx={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>Preview</Typography>
          <Typography sx={{ fontSize: 10.5, color: GX.dim }}>
            Opens the two devices above so you can see and hear what a call would send. Nothing is
            recorded and nothing leaves this machine.
          </Typography>
          <LinearProgress
            variant="determinate"
            value={previewOn ? level : 0}
            aria-label="Microphone level"
            data-el-id="amberxvid:settings:meter"
            sx={{
              height: 7,
              borderRadius: 4,
              bgcolor: gxa(GX.edge, "66"),
              "& .MuiLinearProgress-bar": {
                bgcolor: level > 88 ? GX.err : level > 6 ? GX.ok : GX.dim,
                transition: "none",
              },
            }}
          />
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Button
              size="small"
              variant={previewOn ? "outlined" : "contained"}
              onClick={() => (previewOn ? stopPreview() : void startPreview())}
              startIcon={<RefreshIcon sx={{ fontSize: 15 }} />}
              data-el-id="amberxvid:settings:preview-toggle"
            >
              {previewOn ? "Stop preview" : "Test devices"}
            </Button>
            {previewOn && level <= 6 && (
              <GxChip label="no signal" kind="warn" />
            )}
            {callActive && <GxChip label="in a call" kind="warn" />}
          </Box>
          {why && (
            <Typography sx={{ fontSize: 10.5, color: GX.err }} data-el-id="amberxvid:settings:preview-why">
              The devices did not open — {why}
            </Typography>
          )}
        </Box>
      </Box>

      <DeclaredRow rowKey="callResolution" prefs={prefs} onSet={onSet} />
      <DeclaredRow rowKey="uplinkCapKbps" prefs={prefs} onSet={onSet} />
    </Box>
  );
}

/* ================================== DND ====================================== */

/**
 * The DND group, over `/api/amberxvid/availability` — the document the ring
 * path actually reads. The server answers every patch with the WHOLE document,
 * so nothing here has to guess what it merged.
 */
function DndGroup({ notify }: { notify: (m: string) => void }) {
  const [doc, setDoc] = React.useState<AvailabilityDoc | null>(null);
  const [summary, setSummary] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/amberxvid/availability");
      const json = (await res.json().catch(() => null)) as AvailabilityReply | null;
      if (json?.ok && json.availability) {
        setDoc(json.availability);
        setSummary(json.summary ?? "");
        setFailed(false);
        return;
      }
      setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const patch = React.useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      try {
        const res = await fetch("/api/amberxvid/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as AvailabilityReply | null;
        if (!res.ok || !json?.ok || !json.availability) {
          notify("That didn't save");
          return;
        }
        setDoc(json.availability);
        setSummary(json.summary ?? "");
      } catch {
        notify("The availability service did not answer");
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  if (failed) {
    return (
      <Typography sx={{ fontSize: 11.5, color: GX.err }}>
        Your availability could not be loaded, so these are not shown — a blank switch here would
        read as "do not disturb is off", which may not be true.
      </Typography>
    );
  }

  const q = doc?.quietHours;
  const disabled = busy || doc === null;

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <Row
        label="Do not disturb"
        hint="Refuse every ring while it is on. Callers are told you are unavailable, never which switch silenced you."
        icon={<DndIcon sx={{ fontSize: 18, color: doc?.dnd ? GX.warn : GX.dim }} />}
        control={
          <Switch
            size="small"
            disabled={disabled}
            checked={doc?.dnd === true}
            onChange={(e) => void patch({ dnd: e.target.checked })}
            data-el-id="amberxvid:settings:dnd"
          />
        }
      />
      <Row
        label="Quiet hours"
        hint="A weekly window that silences rings on its own, without touching the switch above."
        icon={<ScheduleIcon sx={{ fontSize: 18, color: q?.enabled ? GX.accent : GX.dim }} />}
        control={
          <Switch
            size="small"
            disabled={disabled}
            checked={q?.enabled === true}
            onChange={(e) => void patch({ quietHours: { enabled: e.target.checked } })}
            data-el-id="amberxvid:settings:quiet"
          />
        }
      />
      {q?.enabled && (
        <>
          <Row
            indent
            label="Window"
            hint="From, to. A window that ends before it starts runs through midnight, and belongs to the day it started."
            control={
              <Box sx={{ display: "flex", gap: 1 }}>
                <TextField
                  select
                  size="small"
                  label="From"
                  disabled={disabled}
                  value={String(q.startMinute)}
                  onChange={(e) => void patch({ quietHours: { startMinute: Number(e.target.value) } })}
                  data-el-id="amberxvid:settings:quiet-from"
                  sx={{ width: 108 }}
                >
                  {QUARTER_MINUTES.map((m) => (
                    <MenuItem key={m} value={String(m)}>
                      {clockHHMM(m)}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="To"
                  disabled={disabled}
                  value={String(q.endMinute)}
                  onChange={(e) => void patch({ quietHours: { endMinute: Number(e.target.value) } })}
                  data-el-id="amberxvid:settings:quiet-to"
                  sx={{ width: 108 }}
                >
                  {QUARTER_MINUTES.map((m) => (
                    <MenuItem key={m} value={String(m)}>
                      {clockHHMM(m)}
                    </MenuItem>
                  ))}
                </TextField>
              </Box>
            }
          />
          <Row
            indent
            label="Days"
            hint="No day picked means every day."
            control={
              <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {DAY_LABELS.map((name, day) => {
                  const on = q.days.includes(day);
                  return (
                    <Button
                      key={name}
                      size="small"
                      disabled={disabled}
                      variant={on ? "contained" : "outlined"}
                      onClick={() =>
                        void patch({
                          quietHours: {
                            days: on ? q.days.filter((d) => d !== day) : [...q.days, day],
                          },
                        })
                      }
                      data-el-id={`amberxvid:settings:quiet-day-${day}`}
                      sx={{ minWidth: 0, px: 1, fontSize: 10.5 }}
                    >
                      {name}
                    </Button>
                  );
                })}
              </Box>
            }
          />
        </>
      )}
      {summary && (
        <Typography sx={{ fontSize: 10.5, color: GX.dim, pt: 1 }} data-el-id="amberxvid:settings:dnd-summary">
          {summary}
        </Typography>
      )}
    </Box>
  );
}

/* ================================ messenger ================================== */

/**
 * The MESSENGER group — the document's fields, plus the one kv row that is
 * genuinely a client behaviour.
 *
 * The chime lives here rather than in NOTIFICATIONS' generated rows because it
 * is the messenger document's `sound` field and this is the group that talks to
 * that document; NOTIFICATIONS says so and points here. One value, one control,
 * as the settings adapter's refusal list requires.
 *
 * Theme, font size and the away message are NOT here on purpose: they restyle
 * the messenger while you are looking at it, so they belong to its drawer gear
 * by explicit build directive. The link is the whole of this group's answer to
 * them.
 */
function MessengerGroup({
  prefs,
  onSet,
  notify,
  onOpenMessenger,
}: {
  prefs: AmberxvidPrefs;
  onSet: (key: PrefKey, value: SettingValue) => void;
  notify: (m: string) => void;
  onOpenMessenger?: () => void;
}) {
  const [doc, setDoc] = React.useState<MessengerSettings | null>(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/amberxvid/messenger");
        const json = (await res.json().catch(() => null)) as MessengerReply | null;
        if (cancelled) return;
        if (json?.ok && json.settings) setDoc(json.settings);
        else setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = React.useCallback(
    async (body: Record<string, unknown>) => {
      try {
        const res = await fetch("/api/amberxvid/messenger", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as MessengerReply | null;
        if (!res.ok || !json?.ok || !json.settings) {
          notify("That didn't save");
          return;
        }
        setDoc(json.settings);
      } catch {
        notify("The messenger service did not answer");
      }
    },
    [notify],
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      {failed ? (
        <Typography sx={{ fontSize: 11.5, color: GX.err }}>
          Your messenger settings could not be loaded, so they are not shown.
        </Typography>
      ) : (
        <>
          <Row
            label="Chime on message"
            hint="Play a sound when a message arrives. This is also the switch that decides whether the app may interrupt you with a broadcast alert."
            icon={<ChatIcon sx={{ fontSize: 18, color: GX.dim }} />}
            control={
              <Switch
                size="small"
                disabled={doc === null}
                checked={doc?.sound === true}
                onChange={(e) => void patch({ sound: e.target.checked })}
                data-el-id="amberxvid:settings:msg-sound"
              />
            }
          />
          <Row
            label="Pop the window open"
            hint="Bring the messenger to the front on a new message instead of only badging it."
            control={
              <Switch
                size="small"
                disabled={doc === null}
                checked={doc?.popupOnMessage === true}
                onChange={(e) => void patch({ popupOnMessage: e.target.checked })}
                data-el-id="amberxvid:settings:msg-popup"
              />
            }
          />
          <Row
            label="Timestamps"
            hint="Show the time beside every message."
            control={
              <Switch
                size="small"
                disabled={doc === null}
                checked={doc?.showTimestamps === true}
                onChange={(e) => void patch({ showTimestamps: e.target.checked })}
                data-el-id="amberxvid:settings:msg-stamps"
              />
            }
          />
        </>
      )}
      <DeclaredRow rowKey="messengerEnterToSend" prefs={prefs} onSet={onSet} />
      <Row
        label="Theme, text size and away message"
        hint="They restyle the messenger while you look at it, so they live in its own gear."
        control={
          <Button
            size="small"
            variant="outlined"
            disabled={!onOpenMessenger}
            onClick={() => onOpenMessenger?.()}
            data-el-id="amberxvid:settings:open-messenger"
          >
            Open messenger
          </Button>
        }
      />
    </Box>
  );
}

/* ================================ the screen ================================= */

export interface SettingsSurfaceProps {
  /** The signed-in member — shown in the header so a shared machine cannot
   *  leave somebody editing the wrong person's preferences. */
  meDisplay: string;
  notify: (message: string) => void;
  /** True while a call or room is live — the device preview refuses to open the
   *  camera underneath it. */
  callActive?: boolean;
  /** Open the messenger drawer, for the group that points at its gear. */
  onOpenMessenger?: () => void;
}

export default function SettingsSurface({
  meDisplay,
  notify,
  callActive = false,
  onOpenMessenger,
}: SettingsSurfaceProps) {
  const prefs = useAmberxvidPrefs();

  const onSet = React.useCallback((key: PrefKey, value: SettingValue) => {
    // The store is optimistic and saves instantly — no confirm step anywhere in
    // AmberX, and this screen is not the exception.
    amberxvidPrefs.set(key, value as never);
  }, []);

  const body = (group: PrefGroup): React.ReactNode => {
    switch (group.id) {
      case "dnd":
        return <DndGroup notify={notify} />;
      case "devices":
        return <DevicesGroup prefs={prefs} onSet={onSet} callActive={callActive} notify={notify} />;
      case "messenger":
        return (
          <MessengerGroup
            prefs={prefs}
            onSet={onSet}
            notify={notify}
            onOpenMessenger={onOpenMessenger}
          />
        );
      default:
        return (
          <Box sx={{ display: "flex", flexDirection: "column" }}>
            {group.keys.map((key) => (
              <DeclaredRow key={key} rowKey={key} prefs={prefs} onSet={onSet} />
            ))}
          </Box>
        );
    }
  };

  return (
    <Box sx={{ position: "relative", display: "flex", flexDirection: "column", gap: 1.5, pb: 4 }}>
      <Box
        sx={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}
      >
        <GizmoXMark size={340} glow={false} />
      </Box>

      <Box sx={{ position: "relative", display: "flex", alignItems: "center", gap: 1 }}>
        <SettingsIcon sx={{ fontSize: 20, color: GX.accent }} />
        <Typography sx={{ fontSize: 19, fontWeight: 700 }}>Settings</Typography>
        <GxChip label={meDisplay} kind="ok" />
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 10.5, color: GX.dim, textAlign: "right", maxWidth: 380 }}>
          Yours alone, on this account, on every machine you sign in from. Saved the moment you
          change one — there is no confirm step.
        </Typography>
      </Box>

      <Divider sx={{ borderColor: gxa(GX.edge, "88") }} />

      <Box sx={{ position: "relative", display: "flex", flexDirection: "column", gap: 1.5 }}>
        {PREF_GROUPS.map((group) => (
          <GxCard
            key={group.id}
            title={group.title}
            meta={
              <GxChip
                label={
                  group.source === "kv"
                    ? "account"
                    : group.source === "availability"
                      ? "availability"
                      : "messenger"
                }
                kind="dim"
              />
            }
          >
            <Typography sx={{ fontSize: 10.5, color: GX.dim, pb: 0.75 }}>{group.blurb}</Typography>
            {body(group)}
          </GxCard>
        ))}

        {/**
         * P19 — contributed sections (`amberxvid.settings-section`).
         *
         * The AI credits card (P18) used to be a hard-coded `<CreditsPane />`
         * right here, with a comment explaining that it is deliberately NOT a
         * `PREF_GROUP`: those are keys in one of the three settings stores, and
         * a balance is a fact about the account rather than a preference, read
         * from the ledger and changed only by a grant or a purchase.
         *
         * That comment was the description of an extension point, so it became
         * one. The card now arrives through the registry like anything else and
         * still renders last, after every preference group — it is the one card
         * on this stage read far more often than it is changed.
         */}
        <SettingsSections notify={notify} />
      </Box>
    </Box>
  );
}

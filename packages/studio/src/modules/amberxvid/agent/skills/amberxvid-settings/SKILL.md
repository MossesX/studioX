---
name: AmberX Vid — settings
description: Every setting AmberX Vid persists: Ring out loud, Ring volume, Tray alerts, Alert me when somebody I follow goes live, Default post visibility, Default album visibility. Use when asked what a setting does, where it is, or what it defaults to.
---
# AmberX Vid settings

Stored under the kv namespace `amberxvid-settings`. The user reaches them through the
gear on the module header, or the "Module settings" row on any right-click.

| Setting | Key | Kind | Default | What it does |
| --- | --- | --- | --- | --- |
| Ring out loud | `ringAlerts` | switch | `true` | Play the ring chime when a call or a room invite arrives. |
| Ring volume | `ringVolume` | number | `70` | How loud that ring is, 0–100 — separate from the switch so silencing one evening does not forget the level. |
| Tray alerts | `trayAlerts` | switch | `true` | Raise a Windows tray balloon for a ring that arrives while this tab is in the background. |
| Alert me when somebody I follow goes live | `followedLiveAlerts` | switch | `true` | Fan the go-live alert to me; off, streams still appear in the hub, they just do not interrupt. |
| Default post visibility | `defaultPostVisibility` | select (public \| buddies \| private) | `public` | What a new wall post is set to before you change it. |
| Default album visibility | `defaultAlbumVisibility` | select (public \| buddies \| private) | `public` | What a new photo album is set to before you change it. |
| Who may call me | `whoMayCall` | select (everyone \| buddies) | `everyone` | Refuse rings from anybody who is not a buddy — enforced at the ring door, not in the UI. |
| Who may invite me | `whoMayInvite` | select (everyone \| buddies) | `everyone` | Refuse room and stream invitations from anybody who is not a buddy. |
| Camera | `cameraId` | text | `default` | Which camera joins a call — pick it in the Settings stage, where the preview is. |
| Microphone | `micId` | text | `default` | Which microphone joins a call — pick it in the Settings stage, where the level meter is. |
| Call resolution | `callResolution` | select (640x480 \| 1280x720 \| 1920x1080) | `1280x720` | Capture size requested from the camera when a call starts. |
| Uplink cap | `uplinkCapKbps` | number | `0` | Ceiling in kbps on the video you send, across every simulcast layer — 0 is uncapped, and anything else is kindness to a slow connection. |
| Enter sends the message | `messengerEnterToSend` | switch | `true` | On, Enter sends and Shift+Enter breaks the line; off, the reverse. |
| Autoplay stream previews | `autoplayPreviews` | switch | `false` | Start each live tile's 15-second preview on arrival instead of on hover — off by default, because a busy hub would open one media leg per tile. |
| Viewer recording format | `viewerRecordFormat` | select (auto \| video/webm \| video/mp4) | `auto` | Container a stream you record as a viewer is written in — Automatic picks the best one this browser supports. |
| Recorder resolution | `recorderResolution` | select (640x480 \| 1280x720 \| 1920x1080) | `1280x720` | What a fresh capture starts as. The toolbar quick actions cycle this live. |
| Recorder quality | `recorderQuality` | select (low \| medium \| high \| max) | `high` | Bitrate tier for new captures — higher is bigger files. |
| Animation intensity | `animationIntensity` | select (off \| subtle \| full \| maximum) | `full` | One knob, module-wide — splash, toolbar, messenger and call animations all scale to it. Reduced-motion always wins. |
| Arm background recording | `backgroundArmed` | switch | `false` | On, the record quick action hands the capture to the Windows tray service instead of the browser engine. |

Quote the hint when the user asks what a row means — it is the text they can see beside
it, so an answer that agrees with it is an answer they can check.

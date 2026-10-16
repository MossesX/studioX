/**
 * @file AmberX Vid build-plan contract constants — copied verbatim from the
 * captured build prompt
 * (`documentation/build-prompts/2026-08-03_07-17_amberx-vid-recording-suite/prompt.mdx`),
 * which exports the same values for tooling. `test/amberxvid-spine.test.ts`
 * asserts these stay identical to the capture, so the running module and the
 * plan cannot drift apart.
 *
 * Only the constants the shipped code actually consumes live here; the rest of
 * the capture's exports (toolbar/avatar/themes/ICE) join as the phases that
 * read them land.
 *
 * **One deliberate divergence, and it is recorded rather than quiet:**
 * `LOADING_SEQUENCE.lines` was re-written by P14 of `axf-amberxvid-social`
 * (2026-08-15) for the platform — see the comment on the constant. The capture
 * described a recording suite, and this is no longer one. Its lock,
 * `test/amberxvid-spine.test.ts`, did not come across to AmberX with the
 * module, so nothing goes red; that is why the divergence is written down here
 * instead of being left for a reader to discover by diffing the prompt.
 */

/**
 * The seeded administrator. The hash was computed at capture time; the
 * plaintext the user supplied is stored in NO file, prompt, log or build
 * artifact. Verification is async `crypto.scrypt` with the embedded
 * salt/params and a timing-safe compare — see `./passwords`.
 */
export const ADMIN_SEED = {
  username: "GizmoX",
  role: "administrator",
  passwordHash:
    "scrypt$n=16384,r=8,p=1$dIirgVSctJ+M3qD9owR9Nw==$948utCY/kx4sywSr2xVycVIrZjVHNAqrpONqhm7ZX4w=",
} as const;

/**
 * The dockable toolbar's placement contract — the four docks, the autohide
 * geometry, the icon sizes and the two label modes. All of it is sui-set
 * (`amberxvid.toolbar.*`); the toolbar engine reads THESE numbers rather than
 * hardcoding its own, so the plan and the running bar cannot disagree.
 */
export const TOOLBAR_PLACEMENT = {
  positions: ["top", "left", "right", "bottom"],
  autohide: { default: false, revealPx: 8, hideDelayMs: 1200 },
  iconSizes: [20, 26, 32, 40],
  labels: ["icons-only", "icons+text"],
} as const;

/**
 * The toolbar's quick actions, in display order. `adminOnly` gates the admin
 * window button to the administrator role; `cycle` actions step through their
 * `values` and persist the result to the recorder settings so the sui shows
 * the same truth the toolbar does.
 */
export const TOOLBAR_QUICK_ACTIONS = [
  { id: "record", label: "Record / Stop", kind: "toggle", note: "arms the active engine (browser or background)" },
  { id: "mic", label: "Mic on/off", kind: "toggle" },
  { id: "quality", label: "Quality", kind: "cycle", values: ["low", "medium", "high", "max"] },
  { id: "resolution", label: "Resolution", kind: "cycle", values: ["640x480", "1280x720", "1920x1080"] },
  { id: "background", label: "Background mode", kind: "toggle", note: "hands recording to the tray service" },
  { id: "mailbox", label: "Mailbox", kind: "panel", note: "unread badge + alert pulse" },
  { id: "messenger", label: "Messenger", kind: "panel" },
  { id: "admin", label: "Admin", kind: "window", adminOnly: true },
] as const;

/** One toolbar quick action, as the capture declares it. */
export type ToolbarQuickAction = (typeof TOOLBAR_QUICK_ACTIONS)[number];

/**
 * Every dial of the avatar designer (P6). Catalog and swatch axes carry the
 * exact entry counts the capture declares — `src/lib/amberxvid/avatar.ts`
 * sizes its catalogs/palettes against THESE numbers (asserted in the tests),
 * so the designer, the renderer and the plan cannot disagree.
 */
export const AVATAR_AXES = [
  { id: "skinTone", label: "Skin tone", kind: "swatch", count: 12 },
  { id: "hairStyle", label: "Hair style", kind: "catalog", count: 24 },
  { id: "hairColor", label: "Hair color", kind: "swatch", count: 16 },
  { id: "eyeColor", label: "Eye color", kind: "swatch", count: 10 },
  { id: "eyeShape", label: "Eye shape", kind: "catalog", count: 8 },
  { id: "brows", label: "Eyebrows", kind: "catalog", count: 8 },
  { id: "nose", label: "Nose", kind: "catalog", count: 8 },
  { id: "mouth", label: "Mouth", kind: "catalog", count: 10 },
  { id: "facialHair", label: "Facial hair", kind: "catalog", count: 10 },
  { id: "height", label: "Height", kind: "slider", range: [140, 210], unit: "cm" },
  { id: "build", label: "Weight / build", kind: "slider", range: [1, 10] },
  { id: "glasses", label: "Glasses", kind: "catalog", count: 8 },
  { id: "accessories", label: "Accessories", kind: "catalog", count: 12 },
  { id: "outfit", label: "Outfit", kind: "catalog", count: 12 },
  { id: "outfitColor", label: "Outfit color", kind: "swatch", count: 16 },
  { id: "backdrop", label: "Backdrop", kind: "catalog", count: 10, note: "brand-derived patterns" },
] as const;

/** One avatar-designer axis, as the capture declares it. */
export type AvatarAxis = (typeof AVATAR_AXES)[number];

/**
 * The 20 preinstalled messenger themes (P7), verbatim from the capture —
 * dialog colors, text color, accent and the send/receive color-fade pair.
 * Each theme's background pattern is brand-derived and generated at build
 * time from these palettes (`./messenger-themes`), never an
 * authored image file.
 */
export const MESSENGER_THEMES = [
  { id: "amber-classic", label: "Amber Classic", bg: "#1a1208", bubble: "#2a1c0c", text: "#ffd9a0", accent: "#FF7A1A", fade: ["#FF7A1A", "#ffb347"] },
  { id: "aim-retro", label: "AIM Retro", bg: "#ece9d8", bubble: "#ffffff", text: "#000000", accent: "#0054e3", fade: ["#0054e3", "#7aa7ff"] },
  { id: "midnight-ink", label: "Midnight Ink", bg: "#0b0e14", bubble: "#151a24", text: "#c9d4e6", accent: "#4a9eff", fade: ["#4a9eff", "#8ac2ff"] },
  { id: "terminal-green", label: "Terminal Green", bg: "#020a02", bubble: "#07140a", text: "#4ff04f", accent: "#22c55e", fade: ["#22c55e", "#a3f7a3"] },
  { id: "blood-orange", label: "Blood Orange", bg: "#160a05", bubble: "#241008", text: "#ffc9ad", accent: "#ff4d00", fade: ["#ff4d00", "#FF7A1A"] },
  { id: "royal-purple", label: "Royal Purple", bg: "#120a1e", bubble: "#1d1230", text: "#dcc9ff", accent: "#9b59ff", fade: ["#9b59ff", "#c9a0ff"] },
  { id: "ocean-deep", label: "Ocean Deep", bg: "#04121c", bubble: "#082032", text: "#a8d8f0", accent: "#00a8cc", fade: ["#00a8cc", "#5fd4ea"] },
  { id: "rose-gold", label: "Rose Gold", bg: "#1c0f12", bubble: "#2b181d", text: "#f5cdd5", accent: "#e8748c", fade: ["#e8748c", "#f2b9c4"] },
  { id: "slate-pro", label: "Slate Pro", bg: "#171a1e", bubble: "#22262c", text: "#d4d8de", accent: "#8a94a6", fade: ["#8a94a6", "#c2cad6"] },
  { id: "neon-noir", label: "Neon Noir", bg: "#0a0a0f", bubble: "#14141f", text: "#e8e8ff", accent: "#ff2d95", fade: ["#ff2d95", "#2de1ff"] },
  { id: "forest-floor", label: "Forest Floor", bg: "#0c1408", bubble: "#15200e", text: "#cfe6b8", accent: "#6aa84f", fade: ["#6aa84f", "#a8d08d"] },
  { id: "sunset-strip", label: "Sunset Strip", bg: "#190d14", bubble: "#26141d", text: "#ffd7c2", accent: "#ff6b6b", fade: ["#ff6b6b", "#feca57"] },
  { id: "arctic-white", label: "Arctic White", bg: "#f4f7fa", bubble: "#ffffff", text: "#20242c", accent: "#4a90d9", fade: ["#4a90d9", "#9cc3ec"] },
  { id: "carbon-fiber", label: "Carbon Fiber", bg: "#101010", bubble: "#1b1b1b", text: "#cfcfcf", accent: "#FF7A1A", fade: ["#FF7A1A", "#666666"] },
  { id: "vapor-dream", label: "Vapor Dream", bg: "#160f24", bubble: "#221838", text: "#ead9ff", accent: "#ff71ce", fade: ["#ff71ce", "#01cdfe"] },
  { id: "gold-leaf", label: "Gold Leaf", bg: "#161206", bubble: "#231c0a", text: "#f0e0a8", accent: "#d4a017", fade: ["#d4a017", "#f0d060"] },
  { id: "crimson-court", label: "Crimson Court", bg: "#170608", bubble: "#250a0e", text: "#f2c2c8", accent: "#dc2f45", fade: ["#dc2f45", "#f07585"] },
  { id: "steel-blue", label: "Steel Blue", bg: "#0d1319", bubble: "#161f29", text: "#c2d4e4", accent: "#5a8ab0", fade: ["#5a8ab0", "#8fb4d4"] },
  { id: "matrix-rain", label: "Matrix Rain", bg: "#000600", bubble: "#041004", text: "#8ff08f", accent: "#00ff41", fade: ["#00ff41", "#b3ffb3"] },
  { id: "gizmox-brand", label: "GizmoX Brand", bg: "#12100d", bubble: "#1e1a14", text: "#f0e2d0", accent: "#FF7A1A", fade: ["#FF7A1A", "#ffd9a0"], note: "watermarked with the brand pattern background" },
] as const;

/** One preinstalled messenger theme, as the capture declares it. */
export type MessengerTheme = (typeof MESSENGER_THEMES)[number];

/**
 * The P2P pin-confirmation protocol (P8), verbatim from the capture — a
 * ZRTP-style short-authentication-string over the WebRTC DTLS fingerprints.
 * `src/lib/amberxvid/sas.ts` implements exactly this derivation; the pins are
 * displayed and human-confirmed, never placed in any network payload.
 */
export const SAS_PAIRING = {
  scheme: "short-authentication-string over WebRTC DTLS fingerprints (ZRTP-style)",
  derivation:
    "sas = SHA-256(sort(fingerprintA, fingerprintB) joined) → two 4-digit pins mapped from disjoint hash slices; both peers compute the SAME pair locally from the negotiated fingerprints.",
  rule:
    "Pins are DISPLAYED on both screens and confirmed by the humans (read one aloud / compare). They are never placed in any signaling payload, header, URL or log — verified in the network log during the build.",
  mismatch: "Treat as man-in-the-middle on the signaling channel: tear down the connection, surface a branded warning.",
} as const;

/**
 * The NAT-traversal contract (P8/R13). The VALUES below are the captured
 * peer-to-peer-era record and stay verbatim; the TOPOLOGY they narrate was
 * replaced by the client/server conversion (`./mediaContract.ts`), and this
 * comment is where that replacement is documented (P9):
 *
 * **The SFU is in the media path now, and it changes what ICE is for.** Under
 * the mesh, coturn on the Hostinger VPS was LOAD-BEARING — two consumer NATs
 * frequently cannot reach each other at all, and the relay was what made a
 * call connect. Under the SFU there is no browser⇄browser leg left: every
 * WebRTC leg is client ⇄ media server, the server announces a PUBLIC address
 * (`AMBERXVID_MEDIA_ANNOUNCED_IP` — refused at media-server start when it
 * resolves to loopback/private outside dev) and binds a FIXED RTP port range
 * (`AMBERXVID_MEDIA_RTC_MIN/MAX_PORT`, opened in the VPS firewall), so most
 * clients dial it directly and no NAT hole-punching between peers is needed.
 *
 * **TURN narrows to the hostile-network case.** It is no longer what makes
 * calls work — it is what rescues the client whose OWN network is hostile:
 * symmetric NAT, or a corporate/UDP-blocked network where only TCP/TLS on
 * 443 gets out (`AMBERXVID_TURN_TLS_PORT=443` is the prod posture for that;
 * the relayed leg is then client → coturn → media server).
 *
 * **What stays exactly as written:** the credential minting. `lib/turn.ts`
 * and `/api/amberxvid/turn-credentials` keep the coturn `use-auth-secret`
 * idiom untouched — it is correct, and it is the secret-handling pattern
 * `mediaContract.ts`'s MEDIA_TOKEN deliberately copied. The `stun` list and
 * env-driven `AMBERXVID_TURN_*` pieces still serve the client ICE config on
 * the client⇄SFU leg; one code path for localhost dev and amberxai.com prod.
 *
 * **Historical clauses, kept as record, no longer true of the running
 * module:** `purpose`/`clientPolicy`'s "direct P2P path" (there is none — the
 * far end is always the media server), the "direct vs relayed" badge
 * distinction (relayed-through-our-server IS the architecture), and
 * `verification`'s forced-relay P2P call. The SAS pins named in
 * `clientPolicy` were retired with the peer referee (P5 —
 * `mediaContract.ts`'s security-promise section says what replaced them).
 */
export const ICE_CONTRACT = {
  purpose:
    "Two users in two different locations (both behind home NATs) video chat via amberxai.com — the primary purpose. LAN-only WebRTC is insufficient; full ICE with a TURN fallback is required.",
  stun: ["stun:stun.l.google.com:19302", "stun:turn.amberxai.com:3478"],
  turn: {
    host: "turn.amberxai.com (coturn on the Hostinger VPS, provisioned by this build over ssh gizmox-vps via Coolify/docker)",
    ports: "3478 udp/tcp + 5349 tls, bounded relay range (e.g. 49160-49200 udp) opened in the VPS firewall",
    auth:
      "coturn use-auth-secret: /api/amberxvid/turn-credentials (GizmoX-session-gated) mints ephemeral HMAC username/credential pairs with a short TTL; the shared secret lives in the VPS env only, never in the client bundle.",
  },
  clientPolicy:
    "STUN-first for a direct P2P path; TURN relay automatically when NAT demands it. Relayed media is DTLS-SRTP ciphertext — end-to-end encryption and the SAS pins hold either way. The in-call badge reports direct vs relayed from getStats().",
  verification:
    "Forced iceTransportPolicy:'relay' call must connect through the VPS coturn with a relayed candidate pair visible in getStats() — the build's stand-in for two physical locations.",
  envParity: "One code path; ICE servers, TURN route and store paths are env-driven so localhost dev and amberxai.com prod share identical code.",
} as const;

/**
 * The branded splash contract: a uniform-random 7–12 s loading sequence with
 * rotating status lines. Honest-theater rule (explicit user directive): the
 * lines are cosmetic staging — they rotate pseudo-randomly and never claim
 * completion of work the module didn't do elsewhere.
 */
export const LOADING_SEQUENCE = {
  durationS: { min: 7, max: 12 },
  /*
   * P14 (2026-08-15) re-wrote these for the PLATFORM. The capture's twelve
   * lines were all about one surface — devices, codecs, thumbnails, the
   * recorder — because in 2026-08-03 that was the whole product. The staging is
   * cosmetic either way (the honest-theater rule above still binds: these
   * rotate at random and claim no work the module did not do), but cosmetic is
   * not the same as arbitrary. What the lines NAME is the first thing a member
   * is told the platform is made of, and eleven of the twelve named a recorder.
   *
   * They now walk the same ground the navigation does — identity, the social
   * face, the live rooms, capture — so the splash and the surface bar describe
   * one product.
   */
  lines: [
    "Resolving your account…",
    "Reading the buddy graph…",
    "Priming the presence channel…",
    "Merging your feed…",
    "Indexing albums and thumbnails…",
    "Compositing avatar atlas…",
    "Unpacking messenger themes…",
    "Syncing mailbox…",
    "Opening the room registry…",
    "Counting who is live…",
    "Negotiating media transport…",
    "Probing capture devices…",
    "Warming the background recording engine…",
    "Polishing the chrome…",
  ],
} as const;

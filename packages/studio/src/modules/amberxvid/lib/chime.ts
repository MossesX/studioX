"use client";

/**
 * @file THE RING CHIME (P13) — the module's one bundled ring sound, and the
 * only thing in the module that makes a noise at somebody.
 *
 * ---------------------------------------------------------------------------
 * WHY IT IS SYNTHESISED RATHER THAN SERVED
 * ---------------------------------------------------------------------------
 * The step this was built for asked for "a bundled chime through the
 * vault-served assets". The vault is per-member storage that the ledger counts
 * and the quota charges for — a chime is neither, and there is no static-asset
 * route in the studio for module-owned files. Copying one WAV into every
 * member's vault so it could be served back would put an identical file under
 * every quota in the studio, and a member could then delete their own ring.
 *
 * So it is bundled as CODE: {@link CHIME} is the score, and {@link playChime}
 * renders it through WebAudio. Concretely that buys three things a served file
 * would not:
 *
 *  - **A ring cannot 404.** No fetch, no route, no cache miss, and nothing to
 *    go wrong on the one code path where going wrong means silence.
 *  - **It rings on the first frame.** A ring window that appears now and chimes
 *    when a download finishes is a ring that was late; there is no network
 *    round trip here at all.
 *  - **Volume is real gain, not `<audio>.volume`.** The member's setting scales
 *    the gain envelope, so 20% is 20% of the peak this file chose rather than
 *    20% of whatever an encoder baked into a file.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT SOUNDS LIKE, AND WHY
 * ---------------------------------------------------------------------------
 * A two-note descending fifth with a soft attack and a long tail, doubled an
 * octave up at a third of the level — a bell rather than a buzzer. Two
 * properties are deliberate: it is audible over a room without being a startle,
 * and its tail is longer than the gap between repeats, so a ring reads as one
 * continuous thing rather than as a series of unrelated beeps.
 *
 * The OUTGOING tone is a single quiet low note. It exists to tell the caller
 * something is happening, not to be heard across a room, so it is a third of
 * the incoming peak and takes no volume setting: the caller chose to make this
 * noise, the callee did not.
 */

/** One partial of the chime: `[frequency, start seconds, length seconds, gain
 *  fraction of the peak]`. */
export type ChimeNote = readonly [number, number, number, number];

/**
 * THE score. Exported rather than inlined so the settings dialog's "test"
 * button and the ring both play the identical sound — a preview that is not
 * the thing being previewed is worse than no preview.
 */
export const CHIME: readonly ChimeNote[] = [
  // The strike: A5, then E5 a fifth below.
  [880, 0.0, 0.9, 1.0],
  [659.25, 0.18, 1.0, 0.85],
  // The shimmer: the same pair an octave up, quiet — this is what stops it
  // sounding like a phone and starts it sounding like a bell.
  [1760, 0.0, 0.55, 0.3],
  [1318.5, 0.18, 0.6, 0.22],
] as const;

/** The caller's own tone — one low note, quiet, no shimmer. */
export const OUTGOING_TONE: readonly ChimeNote[] = [[392, 0, 0.9, 1.0]] as const;

/** Peak gain at 100% volume. Low on purpose: this plays without warning, on
 *  somebody else's machine, at whatever their system volume happens to be. */
const PEAK = 0.16;

/** The caller's tone never scales with the callee's setting — see the header. */
const OUTGOING_PEAK = 0.05;

/**
 * The module's ONE AudioContext, made lazily.
 *
 * Lazily because constructing one before a user gesture leaves it `suspended`
 * on every modern browser, and a context created at import time is a context
 * that is suspended for the whole session. Made on the first play instead —
 * by which point the member has clicked something, since they signed in.
 */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new AudioContext();
    // A backgrounded tab suspends the context; a ring is exactly when it has to
    // come back, so this is asked on every play rather than once.
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Play a score at `volume` (0–100).
 *
 * Silent failure is correct here and everywhere in this file: a browser that
 * refuses to make a sound must not stop the ring window from appearing, and
 * there is nothing useful to tell the member about it in the moment.
 */
export function playChime(score: readonly ChimeNote[], volume: number, peak = PEAK): void {
  const ac = audio();
  if (!ac) return;
  const level = Math.max(0, Math.min(100, volume)) / 100;
  if (level <= 0) return;
  try {
    const at = ac.currentTime;
    for (const [freq, start, len, share] of score) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      const top = peak * level * share;
      // Exponential ramps cannot touch zero, hence the near-silent floor — and
      // the 40 ms attack is what keeps this a chime rather than a click.
      gain.gain.setValueAtTime(0.0001, at + start);
      gain.gain.exponentialRampToValueAtTime(Math.max(top, 0.0002), at + start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + start + len);
      osc.connect(gain).connect(ac.destination);
      osc.start(at + start);
      osc.stop(at + start + len + 0.05);
    }
  } catch {
    /* no audio — the ring window is still on screen */
  }
}

/** The incoming ring, at the member's own volume. */
export function playRing(volume: number): void {
  playChime(CHIME, volume);
}

/** The caller's own outgoing tone — fixed level, deliberately. */
export function playOutgoing(): void {
  playChime(OUTGOING_TONE, 100, OUTGOING_PEAK);
}

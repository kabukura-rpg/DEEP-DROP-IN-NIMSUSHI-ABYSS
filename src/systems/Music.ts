/**
 * BGM: one looping track per AREA and one for the FINAL BOSS fight, through the same AudioContext and
 * the same ♪ switch as the sound effects. Nothing here reads or writes the run; it is told what is on
 * screen and plays that track.
 *
 *   - a SECTION change inside an AREA asks for the same track, so the music carries on
 *   - an AREA change fades the old track out and the new one in, from its top
 *   - ♪ off (GameAudio.muted) asks for silence; ♪ back on resumes the current track
 *   - THE ABYSS is silent until the fight starts (NimushiBossSystem.started), and the fight's track
 *     then fades in from its top
 *
 * The file lives in src/assets/audio and is imported by URL, so Vite ships it with the build.
 */
import mossyMonolithUrl from '../assets/audio/The_Mossy_Monolith.mp3?url';
import stoneVaultUrl from '../assets/audio/Beneath_the_Stone_Vault.mp3?url';
import sunkenMeridianUrl from '../assets/audio/Sunken_Meridian.mp3?url';
import cavernousDriftUrl from '../assets/audio/Cavernous_Drift.mp3?url';
import pressureInTheDeepUrl from '../assets/audio/pressure_in_the_deep.mp3?url';

export type AreaTrack = 1 | 2 | 3 | 4 | 'boss';
export const AREA_MUSIC: Record<AreaTrack, string> = {
  1: mossyMonolithUrl, 2: stoneVaultUrl, 3: sunkenMeridianUrl, 4: cavernousDriftUrl, boss: pressureInTheDeepUrl,
};
/** How loud the music sits under the effects, and how long an AREA change takes each way. */
export const MUSIC = { volume: 0.07, fadeOut: 0.35, fadeIn: 0.5 } as const;

/**
 * Which track the screen asks for, or null for silence. PAUSE, the rest point, the shop and the
 * SECTION CLEAR card keep the AREA's track -- there was no music before, so there is no pause
 * behaviour to copy, and none is invented here.
 */
export function musicTrack(screen: {
  mode: string; area: number; muted: boolean;
  /** The run is in THE ABYSS (the model's 'boss' state): staging room, reversal and arena. */
  abyss?: boolean;
  /** NIMUSHI has woken: the encounter itself has begun (NimushiBossSystem.started). */
  bossStarted?: boolean;
}): AreaTrack | null {
  if (screen.muted) return null;
  if (screen.mode === 'title' || screen.mode === 'over' || screen.mode === 'clear') return null;
  // THE ABYSS -- read off the model, not the menu, so PAUSE there never falls back to AREA 4's track.
  if (screen.abyss || screen.mode === 'boss') return screen.bossStarted ? 'boss' : null;
  return screen.area >= 1 && screen.area <= 4 ? screen.area as AreaTrack : null;
}

export class AreaMusic {
  private element?: HTMLAudioElement;
  private gain?: GainNode;
  private context?: AudioContext;
  /** The track that is (or is fading in to be) audible. */
  private playing: AreaTrack | null = null;
  private wanted: AreaTrack | null = null;
  /** The track whose file is on the element (paused or not). */
  private loaded: AreaTrack = 1;
  private busy = false;
  private hidden = false;
  /** A track that must start from its top the next time it plays, however it last stopped. */
  private fromTop: AreaTrack | null = null;

  /** A new fight has begun: its track starts from the top even if the last fight left it mid-way. */
  cue(track: AreaTrack) { this.fromTop = track; }

  /**
   * Called from GameAudio.unlock, i.e. inside the first user gesture. Browsers -- WebKit above all --
   * only let a media element start without a gesture once it has started inside one, so the element
   * is created and set playing here, silently, and paused again if nothing wants it yet.
   */
  unlock(context: AudioContext) {
    if (this.element) return;
    this.context = context;
    const element = new Audio();
    element.loop = true;
    element.preload = 'auto';
    const gain = context.createGain();
    gain.gain.value = 0;
    // Through Web Audio rather than element.volume, which iOS Safari ignores: the fades need a gain.
    context.createMediaElementSource(element).connect(gain).connect(context.destination);
    this.element = element; this.gain = gain;
    element.src = AREA_MUSIC[1];
    void element.play().then(() => { if (this.playing === null && !this.busy) element.pause(); }).catch(() => {});
  }

  /** The page went to the background or came back: hold the music with it. */
  setHidden(hidden: boolean) { this.hidden = hidden; this.sync(this.wanted); }

  /** Ask for a track (or silence). Cheap to call every tick; it acts only on a change. */
  sync(track: AreaTrack | null) {
    this.wanted = track;
    if (!this.element || this.busy) return;
    const want = this.hidden ? null : track;
    if (want === this.playing) return;
    this.busy = true;
    void this.transition(want).finally(() => { this.busy = false; this.sync(this.wanted); });
  }

  private async transition(want: AreaTrack | null) {
    const element = this.element!, gain = this.gain!.gain, ctx = this.context!;
    if (this.playing !== null) {
      gain.cancelScheduledValues(ctx.currentTime);
      gain.setValueAtTime(gain.value, ctx.currentTime);
      gain.linearRampToValueAtTime(0, ctx.currentTime + MUSIC.fadeOut);
      await new Promise(resolve => setTimeout(resolve, MUSIC.fadeOut * 1000));
      element.pause();
    }
    this.playing = want;
    if (want === null) return;
    // A different AREA starts its track from the top; the same one (♪ back on, the page back in
    // front) picks up where it was.
    if (want !== this.loaded) { element.src = AREA_MUSIC[want]; this.loaded = want; }
    else if (this.fromTop === want) element.currentTime = 0;
    if (this.fromTop === want) this.fromTop = null;
    gain.cancelScheduledValues(ctx.currentTime);
    gain.setValueAtTime(0, ctx.currentTime);
    try { await element.play(); } catch { this.playing = null; return; }
    gain.linearRampToValueAtTime(MUSIC.volume, ctx.currentTime + MUSIC.fadeIn);
  }
}

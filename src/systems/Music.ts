/**
 * AREA BGM: one looping track per AREA, through the same AudioContext and the same ♪ switch as the
 * sound effects. Nothing here reads or writes the run; it is told which AREA is on screen and plays
 * that AREA's track.
 *
 *   - a SECTION change inside an AREA asks for the same track, so the music carries on
 *   - an AREA change fades the old track out and the new one in, from its top
 *   - ♪ off (GameAudio.muted) asks for silence; ♪ back on resumes the current AREA's track
 *   - THE ABYSS and the FINAL BOSS have no track specified, so they ask for silence
 *
 * The file lives in src/assets/audio and is imported by URL, so Vite ships it with the build.
 */
import mossyMonolithUrl from '../assets/audio/The_Mossy_Monolith.mp3?url';
import stoneVaultUrl from '../assets/audio/Beneath_the_Stone_Vault.mp3?url';
import sunkenMeridianUrl from '../assets/audio/Sunken_Meridian.mp3?url';
import cavernousDriftUrl from '../assets/audio/Cavernous_Drift.mp3?url';

export type AreaTrack = 1 | 2 | 3 | 4;
export const AREA_MUSIC: Record<AreaTrack, string> = {
  1: mossyMonolithUrl, 2: stoneVaultUrl, 3: sunkenMeridianUrl, 4: cavernousDriftUrl,
};
/** How loud the music sits under the effects, and how long an AREA change takes each way. */
export const MUSIC = { volume: 0.25, fadeOut: 0.35, fadeIn: 0.5 } as const;

/**
 * Which track the screen asks for, or null for silence. PAUSE, the rest point, the shop and the
 * SECTION CLEAR card keep the AREA's track -- there was no music before, so there is no pause
 * behaviour to copy, and none is invented here.
 */
export function musicTrack(screen: { mode: string; area: number; muted: boolean }): AreaTrack | null {
  if (screen.muted) return null;
  if (screen.mode === 'title' || screen.mode === 'over' || screen.mode === 'clear' || screen.mode === 'boss') return null;
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
    gain.cancelScheduledValues(ctx.currentTime);
    gain.setValueAtTime(0, ctx.currentTime);
    try { await element.play(); } catch { this.playing = null; return; }
    gain.linearRampToValueAtTime(MUSIC.volume, ctx.currentTime + MUSIC.fadeIn);
  }
}

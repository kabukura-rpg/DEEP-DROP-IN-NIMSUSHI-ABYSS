/**
 * TITLE BGM: Beneath_the_Mossy_Stone, looping under the title menu and nowhere else.
 *
 * Its own element and its own gain, beside the AREA tracks (Music.ts) rather than inside them, so the
 * run's music is exactly what it was: START fades this one out while AREA 1 starts as it always has,
 * and nothing here touches the AREA gain or the sound effects. It shares GameAudio's AudioContext and
 * the same ♪ switch.
 *
 * Browsers only let sound start inside a user gesture, so `request()` is synchronous: it is called from
 * the gesture's own handler (the ENTRY GATE press, ♪, the button that returns to the title) and the
 * play request is issued before anything is awaited. A refusal is an ordinary state ('blocked'), never
 * a stuck screen: the wish is kept and the next gesture asks again (`retry`), and nothing polls.
 *
 * The file is preloaded ahead of the first press, but only once the game's own art has loaded (`preload`,
 * called when the scene is created): measured on a 1.6 Mbps line, 3.9MB of music fetched from page load
 * held the game's readiness back by about 5.5s. A press before then simply plays it as it streams. It is
 * not wired into the context, and cannot
 * make a sound, until the first gesture creates that context (`attach`).
 */
import titleUrl from '../assets/audio/Beneath_the_Mossy_Stone.mp3?url';
import { MUSIC } from './Music';

/**
 * The shared music volume, untrimmed (no per-track trim has been asked for), the AREA tracks' own
 * fade in, and a fade out on START inside the 0.5-1s the brief asks for.
 */
export const TITLE_MUSIC = { url: titleUrl, volume: MUSIC.volume, fadeIn: MUSIC.fadeIn, fadeOut: 0.6 } as const;

/**
 *   idle      no gesture yet: nothing is wired and nothing can sound
 *   requesting a play has been asked for and not answered
 *   playing   the element is playing AND the context is running -- only then
 *   blocked   the browser refused (or the context is not running); the next gesture retries
 *   stopped   silent on purpose: ♪ off, a run started, the page left the title
 */
export type TitleMusicState = 'idle' | 'requesting' | 'playing' | 'blocked' | 'stopped';

/** The parts of an HTMLAudioElement this uses, so it can be exercised without a browser. */
export type TitleElement = Pick<HTMLAudioElement, 'loop' | 'preload' | 'src' | 'paused' | 'currentTime' | 'error' | 'play' | 'pause' | 'load' | 'addEventListener'>;

export class TitleMusic {
  readonly element: TitleElement;
  private context?: AudioContext;
  private gain?: GainNode;
  /** Whether the title currently wants its track (the screen is the title and ♪ is on). */
  private wanted = false;
  private hidden = false;
  /** Bumped on every request and stop, so a late answer to an old one never overrides a newer wish. */
  private generation = 0;
  private stopTimer?: ReturnType<typeof setTimeout>;
  state: TitleMusicState = 'idle';
  /** The file failed to load. Kept apart from 'blocked': a retry reloads it first. */
  loadFailed = false;

  constructor(create: () => TitleElement = () => new Audio()) {
    const element = create();
    element.loop = true;
    element.preload = 'none';
    element.src = TITLE_MUSIC.url;
    element.addEventListener('error', () => { this.loadFailed = true; if (this.state === 'requesting' || this.state === 'playing') this.state = 'blocked'; });
    this.element = element;
  }

  /**
   * Called from GameAudio.unlock inside the first gesture: wire the element through its own gain. Once
   * only -- a media element can feed one MediaElementSource for its whole life.
   */
  attach(context: AudioContext) {
    if (this.context) return;
    this.context = context;
    const gain = context.createGain();
    gain.gain.value = 0;
    // A gain rather than element.volume, which iOS Safari ignores: the fades need one.
    context.createMediaElementSource(this.element as HTMLAudioElement).connect(gain).connect(context.destination);
    this.gain = gain;
  }

  /** Start fetching the file now, unless a press has already asked for it (a reload then would cut it off). */
  preload() {
    if (this.element.preload === 'auto') return;
    this.element.preload = 'auto';
    if (this.state === 'idle' && this.element.paused) this.element.load();
  }

  get attached() { return !!this.context; }
  get isWanted() { return this.wanted; }

  /**
   * Play from a user gesture. Synchronous up to the play() call; the answer only updates the state.
   * Safe to call again while playing (it does nothing) or while a request is out (it asks again, which
   * is what a touch's pointerup/touchend must do where the pointerdown did not count as a gesture).
   */
  request() {
    this.wanted = true;
    if (!this.context || !this.gain || this.hidden) return;
    if (this.state === 'playing' && !this.element.paused && this.context.state === 'running') return;
    const ctx = this.context, gain = this.gain.gain, token = ++this.generation;
    if (this.stopTimer !== undefined) { clearTimeout(this.stopTimer); this.stopTimer = undefined; }
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    if (this.loadFailed) { this.loadFailed = false; this.element.load(); }
    // Up to the volume from wherever it is: silence, or part-way down a stop that is now cancelled.
    gain.cancelScheduledValues(ctx.currentTime);
    gain.setValueAtTime(this.element.paused ? 0 : gain.value, ctx.currentTime);
    gain.linearRampToValueAtTime(TITLE_MUSIC.volume, ctx.currentTime + TITLE_MUSIC.fadeIn);
    this.state = 'requesting';
    let asked: Promise<void>;
    try { asked = this.element.play(); } catch { this.state = 'blocked'; return; }
    void Promise.resolve(asked).then(() => {
      if (token !== this.generation) return;
      // Playing on a context that is not running is still silence.
      this.state = ctx.state === 'running' ? 'playing' : 'blocked';
    }, () => {
      if (token === this.generation) this.state = 'blocked';
    });
  }

  /** The next gesture on the title, after a refusal: ask again. Never called on a timer. */
  retry() { if (this.wanted && this.state === 'blocked') this.request(); }

  /**
   * Silence it: fade over `seconds` (0 for at once), then pause and rewind, so the title starts the
   * track from its top next time. Never waits for the fade before returning -- START is not delayed.
   */
  stop(seconds: number = TITLE_MUSIC.fadeOut) {
    this.wanted = false;
    const token = ++this.generation;
    if (this.state === 'idle') return;
    this.state = 'stopped';
    if (this.stopTimer !== undefined) clearTimeout(this.stopTimer);
    const ctx = this.context, gain = this.gain?.gain;
    if (ctx && gain && seconds > 0 && !this.element.paused) {
      gain.cancelScheduledValues(ctx.currentTime);
      gain.setValueAtTime(gain.value, ctx.currentTime);
      gain.linearRampToValueAtTime(0, ctx.currentTime + seconds);
    }
    const finish = () => {
      this.stopTimer = undefined;
      if (token !== this.generation) return;
      this.element.pause();
      try { this.element.currentTime = 0; } catch { /* not seekable yet: it is paused, which is what matters */ }
      if (ctx && gain) { gain.cancelScheduledValues(ctx.currentTime); gain.setValueAtTime(0, ctx.currentTime); }
    };
    if (seconds > 0 && !this.element.paused) this.stopTimer = setTimeout(finish, seconds * 1000);
    else finish();
  }

  /**
   * The page went to the background or came back. Hidden pauses where it is (not a stop: the wish is
   * kept); visible again asks once more if the title still wants it, and a refusal there waits for the
   * next gesture like any other.
   */
  setHidden(hidden: boolean) {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (hidden) {
      ++this.generation;
      if (this.stopTimer !== undefined) { clearTimeout(this.stopTimer); this.stopTimer = undefined; }
      if (this.state === 'idle') return;
      this.element.pause();
      if (this.state === 'stopped') { try { this.element.currentTime = 0; } catch { /* paused is enough */ } }
      else this.state = 'blocked';
      return;
    }
    if (this.wanted) this.request();
  }
}

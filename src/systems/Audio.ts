import { comboFeedback } from './ComboFeedback';
import type { GameEvent } from './GameModel';

/** The sounds this game can actually make. Nothing else is playable. */
export type SoundId = 'shot' | 'land' | 'kill' | 'hurt' | 'upgrade' | 'empty' | 'over';
/** start frequency, end frequency, seconds. */
const SOUNDS: Record<SoundId, readonly [number, number, number]> = {
  shot: [170, 65, 0.07], land: [280, 720, 0.12], kill: [520, 90, 0.13], hurt: [100, 30, 0.23],
  upgrade: [440, 880, 0.3], empty: [70, 50, 0.035], over: [180, 35, 0.5],
};
/**
 * Every GameEvent, mapped to the sound it plays, with null meaning "deliberately silent".
 * Declaring it as a Record over GameEvent['type'] is the point: adding an event to the model
 * fails the build here until someone decides what it should sound like, instead of reaching the
 * audio engine as an unplayable name.
 */
export const EVENT_SOUNDS: Record<GameEvent['type'], SoundId | null> = {
  shot: 'shot', land: 'land', kill: 'kill', hurt: 'hurt', empty: 'empty', over: 'over',
  upgrade: 'upgrade', heal: 'upgrade', boss: 'upgrade', clear: 'upgrade',
  oxygen: 'land',
  section: null, ice: null, vent: null, crack: null, collapse: null,
  // A BREAK BLOCK: a dull knock while it holds, the heavier landing voice when it gives way.
  blockCrack: 'empty', blockBreak: 'land',
  // ACTION on the ground and against a wall, and the payout a landing banks. All reuse existing
  // voices rather than inventing new ones.
  jump: 'land', wallJump: 'land', comboSettle: 'upgrade',
  // Bouncing off scenery reloads, so it borrows the landing voice. Stepping into stopped time and
  // striking a vein both reuse the reward voice.
  doodad: 'land', timeVoid: 'upgrade', coinVein: 'upgrade',
  // Picking up a weapon has no sound of its own yet; the swap card carries the feedback.
  gunModule: null,
  // Money and doorways reuse the existing voices rather than inventing new ones.
  coin: 'land', containerBreak: 'kill',
  shopOpen: 'upgrade', shopBuy: 'upgrade', exitReady: 'upgrade', exit: 'upgrade',
  bossHit: null, bossTelegraph: null, bossFire: null, bossPhase: null, bossDown: null,
};
/** The sound an event should make, or null when it is silent. Never throws on an unknown type. */
export const eventSound = (type: GameEvent['type']): SoundId | null => EVENT_SOUNDS[type] ?? null;
export class GameAudio {
  private context?: AudioContext;
  muted = false;
  unlock() {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
  }
  play(kind: SoundId, combo = 0, stomp = false) {
    if (this.muted || !this.context || this.context.state !== 'running') return;
    // Defence in depth: a caller that hands over an id this engine cannot voice stays silent
    // rather than throwing and taking the whole game loop down with it.
    const settings = SOUNDS[kind];
    if (!settings) return;
    const ctx = this.context, oscillator = ctx.createOscillator(), gain = ctx.createGain();
    oscillator.type = kind === 'land' || kind === 'upgrade' ? 'sine' : 'square';
    const feedback = comboFeedback(combo);
    const pitch = kind === 'kill' ? feedback.pitch * (stomp ? 0.86 : 1) : 1;
    oscillator.frequency.setValueAtTime(settings[0] * pitch, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(settings[1] * pitch, ctx.currentTime + settings[2]);
    gain.gain.setValueAtTime(0.035, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + settings[2]);
    oscillator.connect(gain); gain.connect(ctx.destination);
    oscillator.start(); oscillator.stop(ctx.currentTime + settings[2]);
    if (kind === 'kill' && feedback.tier >= 8) {
      const chime = ctx.createOscillator(), envelope = ctx.createGain();
      chime.type = 'sine'; chime.frequency.setValueAtTime(660 * pitch, ctx.currentTime);
      chime.frequency.exponentialRampToValueAtTime(990 * pitch, ctx.currentTime + 0.09);
      envelope.gain.setValueAtTime(0.018, ctx.currentTime); envelope.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);
      chime.connect(envelope); envelope.connect(ctx.destination); chime.start(); chime.stop(ctx.currentTime + 0.14);
    }
  }
}

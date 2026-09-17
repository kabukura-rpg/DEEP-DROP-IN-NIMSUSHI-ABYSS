import { comboFeedback } from './ComboFeedback';
export class GameAudio {
  private context?: AudioContext;
  muted = false;
  unlock() {
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') void this.context.resume();
  }
  play(kind: 'shot' | 'land' | 'kill' | 'hurt' | 'upgrade' | 'empty' | 'over', combo = 0, stomp = false) {
    if (this.muted || !this.context || this.context.state !== 'running') return;
    const ctx = this.context, oscillator = ctx.createOscillator(), gain = ctx.createGain();
    const settings = { shot: [170, 65, 0.07], land: [280, 720, 0.12], kill: [520, 90, 0.13], hurt: [100, 30, 0.23], upgrade: [440, 880, 0.3], empty: [70, 50, 0.035], over: [180, 35, 0.5] }[kind];
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

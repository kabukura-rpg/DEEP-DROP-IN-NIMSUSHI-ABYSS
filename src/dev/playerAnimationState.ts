/** Candidate artwork selector: observes the simulation, never changes it. */
export const PLAYER_ANIMATIONS = {
  idle: [2, 6, true], damage: [2, 12, false], death: [4, 8, false],
  run: [4, 10, true], jump_rise: [2, 6, true], fall: [3, 6, true],
  gunboots_fire: [2, 12, false], gunboots_brake: [2, 16, true],
  landing: [2, 12, false], wall_contact: [1, 6, true], wall_kick: [2, 12, false],
  boss_ascend: [3, 6, true], boss_brake: [2, 16, true], boss_hover: [2, 16, true], boss_damage: [2, 12, false],
  // PLAYER BOSS CONTACT REBOUND v1 (ART LOCKED): one still frame, held for BOSS_CONTACT_REBOUND_SECONDS.
  boss_contact_rebound: [1, 1, false],
} as const;
/**
 * How long the rebound frame shows after a SURVIVED body contact with NIMUSHI: the length of the
 * rebound itself. The contact throws the player off at `BALANCE.bounce` (210px/s) against the boss
 * arena's 900px/s^2 pull, so the throw is spent in 210/900 = 0.23s -- the frame lasts as long as the
 * movement it depicts, and hands back to the ordinary poses as the player turns round.
 */
export const BOSS_CONTACT_REBOUND_SECONDS = 0.23;
export type PlayerAnimation = keyof typeof PLAYER_ANIMATIONS;
export interface AnimationInput {
  readonly elapsed: number; readonly hp: number; readonly state: string;
  readonly inBossArena: boolean; readonly wallSide: number;
  readonly player: { readonly grounded: number; readonly vy: number; readonly vx: number };
}
export class PlayerAnimationState {
  private shot = -Infinity;
  private hurt = -Infinity;
  private land = -Infinity;
  private wall = -Infinity;
  private rebound = -Infinity;
  reset() { this.shot = this.hurt = this.land = this.wall = this.rebound = -Infinity; }
  event(e: {readonly type: string; readonly stomp?: boolean; readonly cause?: string}, m: AnimationInput) {
    // Only a SURVIVED body contact with NIMUSHI: a killing blow is a death, and a stomp is not a hurt.
    if (e.type === 'hurt' && e.cause === 'bossContact' && m.hp > 0) this.rebound = m.elapsed;
    if (e.type === 'shot' && m.player.grounded === -1 && (!m.inBossArena || m.player.vy <= 0)) this.shot = m.elapsed;
    if (e.type === 'hurt') this.hurt = m.elapsed;
    if (e.type === 'land') this.land = m.elapsed;
    if (e.type === 'wallJump') this.wall = m.elapsed;
    if (['land','jump','wallJump','gravityFlip','clear','over'].includes(e.type) || e.type === 'kill' && e.stomp) this.shot = -Infinity;
  }
  pose(m: AnimationInput): PlayerAnimation | null {
    if (m.hp <= 0 && m.state === 'over') return 'death';
    if (!['playing','boss'].includes(m.state)) return null;
    if (m.hp > 0 && m.elapsed-this.rebound < BOSS_CONTACT_REBOUND_SECONDS) return 'boss_contact_rebound';
    if (m.elapsed-this.hurt < 2/12) return m.inBossArena ? 'boss_damage' : 'damage';
    if (m.player.grounded !== -1) return m.elapsed-this.land < 2/12 ? 'landing' : Math.abs(m.player.vx)>5 ? 'run' : 'idle';
    if (m.inBossArena) {
      // Downward bounces have no matching approved pose; never imply downward thrust.
      if (m.player.vy > 0) return null;
      if (m.elapsed-this.shot < .14) return Math.abs(m.player.vy)<20 ? 'boss_hover' : 'boss_brake';
      return 'boss_ascend';
    }
    if (m.elapsed-this.wall < 2/12) return 'wall_kick';
    if (m.wallSide !== 0) return 'wall_contact';
    if (m.elapsed-this.shot < 2/12) return 'gunboots_fire';
    if (m.elapsed-this.shot < .30) return 'gunboots_brake';
    return m.player.vy < 0 ? 'jump_rise' : 'fall';
  }
}
export function playerAnimationFrame(pose: PlayerAnimation, seconds: number) {
  const [count,fps,loop] = PLAYER_ANIMATIONS[pose];
  const n = Math.max(0,Math.floor(seconds*fps));
  return loop ? n%count : Math.min(n,count-1);
}

/** Temporary visual adapter. No model writes, velocity changes or new gameplay states. */
export type PlayerArtPose = 'normal_fall' | 'boss_ascend' | 'boss_brake';
export type PlayerArtMode = 'prototype' | 'legacy';
export interface PlayerArtInput {
  readonly elapsed: number;
  readonly hp: number;
  readonly state: string;
  readonly inBossArena: boolean;
  readonly player: { readonly grounded: number; readonly vy: number };
}

// Measured BODY centers, excluding ears/hair/tail. The original 48px PNGs stay untouched.
// Eyes sit at body y-2 in all three poses; the soles differ by only 2px in the crouch.
export const PLAYER_ART_FRAMES = {
  normal_fall: { anchor: { x: 24, y: 32 }, eyesY: 30, solesY: 44 },
  boss_ascend: { anchor: { x: 24, y: 23 }, eyesY: 21, solesY: 35 },
  boss_brake: { anchor: { x: 24, y: 28 }, eyesY: 26, solesY: 38 },
} as const;
export const PLAYER_ART_BRAKE_SECONDS = 0.14;

export class PlayerArtState {
  private brakeUntil = -Infinity;
  reset() { this.brakeUntil = -Infinity; }
  event(event: { readonly type: string; readonly stomp?: boolean }, input: PlayerArtInput) {
    if (event.type === 'shot' && input.inBossArena && input.player.grounded === -1 && input.player.vy <= 0) {
      this.brakeUntil = input.elapsed + PLAYER_ART_BRAKE_SECONDS;
    } else if (['land', 'jump', 'wallJump', 'gravityFlip', 'over', 'clear'].includes(event.type) || (event.type === 'kill' && event.stomp)) {
      this.reset();
    }
  }
  pose(input: PlayerArtInput): PlayerArtPose | null {
    if (input.hp <= 0 || !['playing', 'boss'].includes(input.state) || input.player.grounded !== -1) return null;
    if (!input.inBossArena) return input.player.vy >= 0 ? 'normal_fall' : null;
    // A stomp/bounce can send the player down. It is NOT gunboot thrust: use legacy there.
    if (input.player.vy > 0) return null;
    return input.elapsed < this.brakeUntil ? 'boss_brake' : 'boss_ascend';
  }
}

/** Keep the calibrated body center at the physics center, also after a horizontal flip. */
export function playerArtPlacement(pose: PlayerArtPose, x: number, y: number, scale: number, flipX: boolean) {
  const anchor = PLAYER_ART_FRAMES[pose].anchor;
  return { x: Math.round(x) + (flipX ? -1 : 1) * (24 - anchor.x) * scale, y: Math.round(y) + (24 - anchor.y) * scale };
}

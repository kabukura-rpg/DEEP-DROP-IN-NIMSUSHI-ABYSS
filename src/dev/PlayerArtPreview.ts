import Phaser from 'phaser';
import type { GameModel, GameEvent } from '../systems/GameModel';
import { PLAYER_ART_FRAMES, PlayerArtState, playerArtPlacement, type PlayerArtMode, type PlayerArtPose } from './playerArtState';

/** DEV ONLY. Kept outside public/ so prototype images are never copied into dist. */
export class PlayerArtPreview {
  static preload(scene: Phaser.Scene) {
    for (const pose of Object.keys(PLAYER_ART_FRAMES) as PlayerArtPose[]) {
      scene.load.image(`player-art-${pose}`, `${import.meta.env.BASE_URL}output/player-visual-prototype-v1/sprites-48/${pose}.png`);
    }
  }
  private readonly state = new PlayerArtState();
  private readonly image: Phaser.GameObjects.Image;
  private mode: PlayerArtMode = 'prototype';
  private scale = 1;
  private flipX = false;
  private currentPose: PlayerArtPose | null = null;
  constructor(private scene: Phaser.Scene, redraw: () => void) {
    this.image = scene.add.image(0, 0, '__MISSING').setOrigin(0.5).setVisible(false);
    for (const pose of Object.keys(PLAYER_ART_FRAMES)) {
      if (scene.textures.exists(`player-art-${pose}`)) scene.textures.get(`player-art-${pose}`).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    const control = (mode?: PlayerArtMode, scale?: number) => {
      if (mode !== undefined && mode !== 'legacy' && mode !== 'prototype') throw new Error('Use prototype or legacy');
      if (scale !== undefined && (!Number.isInteger(scale) || scale < 1 || scale > 3)) throw new Error('Use integer visual scale 1, 2 or 3');
      if (mode !== undefined) this.mode = mode;
      if (scale !== undefined) this.scale = scale;
      redraw();
      return { mode: this.mode, pose: this.currentPose, scale: this.scale, flipX: this.flipX, origin: [0.5, 0.5], position: { x: this.image.x, y: this.image.y }, visible: this.image.visible };
    };
    const target = window as unknown as { __playerArt?: typeof control };
    target.__playerArt = control;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { if (target.__playerArt === control) delete target.__playerArt; });
  }
  reset() { this.state.reset(); this.flipX = false; this.image.setVisible(false); }
  event(event: GameEvent, model: GameModel) { this.state.event(event, model); }
  render(model: GameModel, shakeX: number, direction: number): boolean {
    if (direction !== 0) this.flipX = direction < 0;
    this.currentPose = this.state.pose(model);
    const pose = this.currentPose;
    const use = this.mode === 'prototype' && pose !== null && this.scene.textures.exists(`player-art-${pose}`);
    const blink = model.player.invincible > 0 && Math.floor(model.player.invincible * 16) % 2 !== 0;
    this.image.setVisible(use && !blink);
    if (use && pose) {
      const p = playerArtPlacement(pose, model.player.x, model.player.y - model.cameraY, this.scale, this.flipX);
      this.image.setTexture(`player-art-${pose}`).setPosition(p.x + shakeX, p.y).setScale(this.scale).setFlipX(this.flipX);
    }
    return use;
  }
}

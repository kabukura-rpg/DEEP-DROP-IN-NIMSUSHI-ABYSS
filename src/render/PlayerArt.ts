import Phaser from 'phaser';
import type { GameModel, GameEvent } from '../systems/GameModel';
import type { PlayerArtMode } from '../dev/playerArtState';
import { PLAYER_ANIMATIONS, PlayerAnimationState, playerAnimationFrame, type PlayerAnimation } from '../dev/playerAnimationState';
import { PLAYER_ART_ASSETS, artFrameUsable, type ArtMap } from './playerArtAssets';

/**
 * PLAYER ART v1 (HUMAN APPROVED, docs/PLAYER-ART-v1-APPROVED.md) -- in the shipped game.
 *
 * It was a DEV-only preview whose sheets were fetched from `output/` and never reached `dist/`. The
 * EXTERNAL TEST BUILD imports the same files, byte for byte, so Vite ships them. Nothing about the
 * art changed: the 48x48 cells, the frame map, the anchors and the pose logic are the ones approved.
 *
 * VISUAL ONLY. The image is placed on the physics body by each frame's own anchor and never feeds
 * back: collision, physics and the model are untouched. If a sheet or the map fails to load the
 * image stays hidden and the scene draws the original procedural body instead.
 */
export class PlayerArt {
  static preload(scene: Phaser.Scene) {
    scene.load.json('player-animation-map', PLAYER_ART_ASSETS.map);
    for (const [group, url] of Object.entries(PLAYER_ART_ASSETS.sheets)) {
      scene.load.spritesheet(`player-art-${group}`, url, { frameWidth: PLAYER_ART_ASSETS.cell, frameHeight: PLAYER_ART_ASSETS.cell });
    }
  }
  private readonly state = new PlayerAnimationState();
  readonly image: Phaser.GameObjects.Image;
  private mode: PlayerArtMode = 'prototype';
  private scale = 1;
  private flipX = false;
  private currentPose: PlayerAnimation | null = null;
  private currentFrame = 0;
  private started = 0;
  private startedWall = 0;
  private forced: PlayerAnimation | null = null;
  constructor(private scene: Phaser.Scene, redraw: () => void) {
    this.image = scene.add.image(0, 0, '__MISSING').setOrigin(0.5).setVisible(false);
    for (const group of Object.keys(PLAYER_ART_ASSETS.sheets)) {
      if (scene.textures.exists(`player-art-${group}`)) scene.textures.get(`player-art-${group}`).setFilter(Phaser.Textures.FilterMode.NEAREST);
    }
    if (!import.meta.env.DEV) return;
    // DEV only: `__playerArt(mode, scale, pose)` -- a visual-only inspection override. 'auto' restores gameplay selection.
    const control = (mode?: PlayerArtMode, scale?: number, pose?: PlayerAnimation | 'auto') => {
      if (mode !== undefined && mode !== 'legacy' && mode !== 'prototype') throw Error('Use prototype or legacy');
      if (scale !== undefined && (!Number.isInteger(scale) || scale < 1 || scale > 3)) throw Error('Use integer visual scale 1, 2 or 3');
      if (pose !== undefined && pose !== 'auto' && !(pose in PLAYER_ANIMATIONS)) throw Error('Unknown player animation');
      if (mode !== undefined) this.mode = mode;
      if (scale !== undefined) this.scale = scale;
      if (pose !== undefined) { this.forced = pose === 'auto' ? null : pose; this.currentPose = null; }
      redraw();
      return { mode: this.mode, pose: this.currentPose, frame: this.currentFrame, override: this.forced, scale: this.scale, flipX: this.flipX, origin: [0.5, 0.5], position: { x: this.image.x, y: this.image.y }, visible: this.image.visible };
    };
    const target = window as unknown as { __playerArt?: typeof control };
    target.__playerArt = control;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { if (target.__playerArt === control) delete target.__playerArt; });
  }
  reset() { this.state.reset(); this.currentPose = null; this.forced = null; this.flipX = false; this.image.setVisible(false); }
  event(event: GameEvent, model: GameModel) { this.state.event(event, model); }
  render(model: GameModel, shakeX: number, direction: number): boolean {
    if (direction !== 0) this.flipX = direction < 0;
    const pose = this.forced ?? this.state.pose(model);
    if (pose !== this.currentPose) { this.currentPose = pose; this.started = model.elapsed; this.startedWall = this.scene.game.loop.time; }
    const seconds = pose === 'death' || this.forced ? (this.scene.game.loop.time - this.startedWall) / 1000 : model.elapsed - this.started;
    this.currentFrame = pose ? playerAnimationFrame(pose, seconds) : 0;
    const manifest = this.scene.cache.json.get('player-animation-map') as ArtMap | undefined;
    const key = pose ? `${pose}_${String(this.currentFrame).padStart(2, '0')}` : '';
    const frame = pose ? artFrameUsable(manifest, key, group => this.scene.textures.exists(`player-art-${group}`)) : undefined;
    const use = this.mode === 'prototype' && !!frame;
    const blink = model.hp > 0 && model.player.invincible > 0 && Math.floor(model.player.invincible * 16) % 2 !== 0;
    this.image.setVisible(use && !blink);
    if (use && frame) {
      // Wall poses were authored against a RIGHT wall; flip only the image.
      const flip = pose === 'wall_contact' ? model.wallSide < 0 : pose === 'wall_kick' ? model.player.vx > 0 : this.flipX;
      const x = Math.round(model.player.x) + (flip ? -1 : 1) * (24 - frame.anchor.x) * this.scale;
      const y = Math.round(model.player.y - model.cameraY) + (24 - frame.anchor.y) * this.scale;
      this.image.setTexture(`player-art-${frame.group}`, frame.index).setPosition(x + shakeX, y).setScale(this.scale).setFlipX(flip);
    }
    return use;
  }
}

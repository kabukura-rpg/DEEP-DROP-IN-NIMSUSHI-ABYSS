/** Preserve short taps between render frames; holds still use the live key state. */
export class InputBuffer {
  private direction = 0;
  private moveTime = 0;
  private shotTime = 0;
  move(direction: number) { this.direction = direction; this.moveTime = 0.05; }
  shoot() { this.shotTime = 0.1; }
  get firing() { return this.shotTime > 0; }
  consumeShot() { this.shotTime = 0; }
  resolveDirection(held: number) { return held || (this.moveTime > 0 ? this.direction : 0); }
  tick(dt: number) { this.moveTime = Math.max(0, this.moveTime - dt); this.shotTime = Math.max(0, this.shotTime - dt); }
  clear() { this.direction = 0; this.moveTime = 0; this.shotTime = 0; }
}

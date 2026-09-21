import { WORLD } from '../data/balance';
import { ABYSS, ABYSS_PHASES, abyssPhaseAt, type AbyssAttackId, type AbyssPhase } from '../data/abyss';
import {
  FINAL_RAGE_RATIO, FULL_SCREEN_TAPIOCA, HIT_REACTION, TRANSITION_HAUL, NIMUSHI, NIMUSHI_ATTACKS, NIMUSHI_CLONES, NIMUSHI_DYING_RATIO,
  NIMUSHI_LINES, STRAW_BEAM, TAPIOCA_CUP, TAPIOCA_SHOWER, type NimushiPose, type NimushiState, ATTACK_STATES } from '../data/nimushi';

/** One pearl in the air. Shower pearls, cup spit and FULL SCREEN waves are all just these. */
export interface Tapioca { id: number; x: number; y: number; vx: number; vy: number; size: number; life: number; damage: number }
/** A cup: falls past the player, turns, warns, then spits back up the shaft. Can be shot down. */
export interface TapiocaCup {
  id: number; x: number; y: number; vy: number; hp: number;
  state: 'falling' | 'warning' | 'firing' | 'spent';
  timer: number; fired: number; life: number; alive: boolean;
}
/** The straw. A column that is drawn thin and harmless first, then wide and live. */
export interface StrawBeamShot { id: number; x: number; width: number; state: 'warning' | 'live'; timer: number }

export type NimushiSignal =
  | { kind: 'phase'; phase: AbyssPhase }
  | { kind: 'eye'; open: boolean }
  | { kind: 'prep'; attack: AbyssAttackId }
  | { kind: 'attack'; attack: AbyssAttackId }
  | { kind: 'clones'; count: number; y: number }
  | { kind: 'rage' }
  | { kind: 'line'; text: string }
  | { kind: 'started' }
  | { kind: 'hurt' }
  | { kind: 'defeated' }
  | { kind: 'cleared' };

/**
 * NIMUSHI, the FINAL BOSS, as an explicit state machine.
 *
 * It owns its HP, where it hangs relative to the player along whichever way gravity is pulling, the
 * cycle its eye runs, the five attacks and everything those attacks put in the air. It owns NOTHING
 * about the player: every way it can hurt them is reported as geometry that GameModel tests and
 * routes through the ordinary HealthSystem, exactly as an enemy or a spike does.
 *
 * The one rule the whole class is arranged around is that the body is armour and the eye is the
 * fight. There is no path here by which HP falls other than `hitEye`, and `hitEye` refuses unless
 * the eye is open -- so no projectile source, no explosion and no stomp can find a way round it.
 *
 * Direction is a parameter, never an assumption. `sign` is which way the world pulls; the boss
 * hangs AHEAD of the player along it, its attacks travel AGAINST it, its cups turn and fire back
 * WITH it, and the boundary trails behind. Set sign to +1 and the whole fight is the mirror image.
 */
export class NimushiBossSystem {
  enabled = false;
  hp: number = NIMUSHI.maxHp;
  state: NimushiState = 'dormant';
  phaseId: 1 | 2 | 3 | 4 = 1;
  /** Seconds of BOSS TIME: it starts at the first weak-point hit, not when the arena opens. */
  elapsed = 0;
  started = false;
  defeated = false;
  raged = false;
  x = WORLD.width / 2;
  y = 0;
  tapiocas: Tapioca[] = [];
  cups: TapiocaCup[] = [];
  beams: StrawBeamShot[] = [];
  /**
   * The furthest along the pull the player has managed to get. The deep is never allowed to fall
   * further behind THIS than `maxSlack`, which is what makes climbing worth anything.
   */
  /** Extra room bought by weak-point damage, decaying away as the band reasserts itself. */
  private pushback = 0;
  /**
   * The hit recoil: how far along the pull the body is currently thrown, in pixels.
   *
   * It is applied to the BODY rather than to `y`, which keeps two things true at once. The eye, the
   * hitbox and the sprite all come off the same offset, so they jolt together and can never
   * disagree; and `y` itself stays monotonic along the pull, which is what the camera's anchor is
   * built on -- so a hit shakes NIMUSHI against a steady view instead of dragging the view after it.
   */
  private recoil = 0;
  mark = 0;
  /** Where the rising deep actually is, in world coordinates. */
  deepY = 0;
  /** How far behind the player's best progress the deep still is. Reporting, and the tests. */
  get slack() { return this.along(this.mark - this.deepY); }
  /** Which way the world pulls. The fight sets it once; nothing here assumes a value. */
  private sign: 1 | -1 = -1;
  private timer = 0;
  private defeatTimer = 0;
  /** Damage taken in the CURRENT open window. Deliberately not the same thing as phase HP. */
  private windowDamage = 0;
  private rotation = 0;
  private waveTimer = 0;
  private rageTimer = 0;
  private rageLane = 0;
  private rageDir: -1 | 1 = 1;
  /** Where the shower's gap is, and which way it is walking. -1 until the first wave picks it. */
  /** How many columns of the current beam attack have been raised. One at a time, up to `count`. */
  private beamsFired = 0;
  private showerLane = -1;
  private showerDir: -1 | 1 = 1;
  private taunted = false;
  private nextId = 1;
  private pendingAttack: AbyssAttackId = 'tapiocaShower';

  get maxHp() { return NIMUSHI.maxHp; }
  get ratio() { return Math.max(0, Math.min(1, this.hp / NIMUSHI.maxHp)); }
  get phase(): AbyssPhase { return ABYSS_PHASES.find(p => p.id === this.phaseId) ?? ABYSS_PHASES[0]; }
  /** True while the fight is live enough to be hit or to hurt: not asleep, not over. */
  get active() { return this.enabled && !this.defeated; }
  /**
   * The ONLY state in which HP can move. Three states, and each is deliberate.
   *
   * `dormant` counts because waking NIMUSHI up is done by shooting the eye, so the eye has to be a
   * target before the fight has started.
   *
   * `tapiocaShower` counts because of what this fight is. The loop the player was taught is stomp,
   * bounce, reload, brake, shoot -- and an attack that shuts the weak point turns its own duration
   * into a phase with nothing in it but dodging, which is a different game wearing the same
   * costume. With the eye open through the shower, the pearls ask the player to be somewhere else
   * across the shaft WHILE they keep doing all of it, which is the thing the attack is for.
   *
   * The 0.7s wind-up is NOT in the list, on purpose: the cast is a warning, and a warning that can
   * be shot is just a longer window. Closed for the tell, open for the answer.
   *
   * `strawBeam` counts for the same reason, once its WARNING has actually become a beam. The beam's
   * telegraph outlives the `attackPrep` state by half a second, so the state alone is the wrong
   * thing to ask: what the rule needs is "is there still a line being promised". Closed while one
   * is, open once the column is burning -- and open for the tail of the state after it has gone.
   *
   * CUP and CLONES are out of every rotation; if one comes back, whether it opens the eye is its
   * own decision to make and not one inherited from here.
   */
  get eyeOpen() {
    if (!this.active) return false;
    if (this.state === 'dormant' || this.state === 'eyeOpen' || this.state === 'tapiocaShower') return true;
    return this.state === 'strawBeam' && !this.beams.some(b => b.state === 'warning');
  }
  /** What the view draws. Derived, so a sprite can never disagree with the machine. */
  get pose(): NimushiPose {
    if (this.defeated) return 'dead';
    if (this.state === 'dormant') return 'dormant';
    if (this.state === 'finalRage') return 'rage';
    if (this.state === 'eyeOpen') return this.windowDamage > 0 ? 'damage' : 'idle';
    if (this.state === 'eyeClosing' || this.state === 'phaseTransition') return 'closed';
    if (this.state === 'attackPrep') return 'cast';
    if (this.state === 'recovery') return 'closed';
    return 'attack';
  }
  /** True while FULL SCREEN TAPIOCA is pouring underneath whatever else is happening. */
  /**
   * Whether FINAL RAGE's curtain is pouring.
   *
   * The rage STATE still happens -- the threshold, the cut-in, the line, the pose and the visual
   * hook are all live -- but the pearls are switched off at the data. See FULL_SCREEN_TAPIOCA.
   */
  get rageActive() { return FULL_SCREEN_TAPIOCA.enabled && this.raged && this.active && this.state !== 'finalRage'; }

  /** Where the body actually is: its station, plus however far the last hit has thrown it. */
  get body() {
    return { x: this.x - NIMUSHI.bodyWidth / 2, y: this.hitY - NIMUSHI.bodyHeight / 2, width: NIMUSHI.bodyWidth, height: NIMUSHI.bodyHeight };
  }
  /**
   * The body with the hit recoil taken OUT: where the CAMERA frames it.
   *
   * The distinction is the whole point of keeping the recoil small. The view is framed on NIMUSHI's
   * station, which only ever advances, so the recoil reads as NIMUSHI being knocked back rather
   * than as the camera lurching -- and the anchor keeps the clean monotonic input it needs.
   */
  get framedBody() {
    return { x: this.x - NIMUSHI.bodyWidth / 2, y: this.y - NIMUSHI.bodyHeight / 2, width: NIMUSHI.bodyWidth, height: NIMUSHI.bodyHeight };
  }
  /**
   * The box that costs a heart -- which is NOT the box that is drawn.
   *
   * `NIMUSHI.contactInset` is taken off the side the player arrives from, so the outermost fringe of
   * the silhouette is decoration rather than body. The asymmetry is deliberate and it runs one way:
   * a ROUND still stops on the drawn body (`hitTest` uses `body`), because a shot disappearing into
   * a hood that turns out to be hollow would be the unfair half of the same idea.
   */
  get contactBox() {
    const body = this.body;
    const inset = Math.max(0, Math.min(NIMUSHI.contactInset, NIMUSHI.bodyHeight - 1));
    // The player-facing side is the face, and the face is whichever end of the body the pull leads
    // away from -- so the inset is taken off the bottom under an upward pull and the top under a
    // downward one, and the rule reads the same whichever way the world is.
    return this.sign < 0
      ? { x: body.x, y: body.y, width: body.width, height: body.height - inset }
      : { x: body.x, y: body.y + inset, width: body.width, height: body.height - inset };
  }
  /** Station plus recoil: the one position everything the player can see or touch is built from. */
  private get hitY() { return this.y + this.recoil * this.sign; }
  /** How hard NIMUSHI was just hit, 1 down to 0. What the view flashes on; not a mechanic. */
  get hitFlash() { return Math.max(0, Math.min(1, this.recoil / HIT_REACTION.recoil)); }
  /** The face that looks at the player: the underside of the body while the ABYSS pulls upward. */
  get face() { return this.hitY - (NIMUSHI.bodyHeight / 2) * this.sign; }
  /** The eye, set into that face. Small, and the only thing on NIMUSHI worth aiming at. */
  get eye() {
    const depth = NIMUSHI.eyeHeight;
    const near = this.face - depth * this.sign;
    return {
      x: this.x - NIMUSHI.eyeWidth / 2, width: NIMUSHI.eyeWidth,
      y: Math.min(near, this.face), height: depth,
    };
  }
  /**
   * Where the rising deep is right now: `slack` behind the player's best progress, and never within
   * `minArena` of NIMUSHI itself. The second clamp is a safety net rather than a mechanic -- it is
   * what makes "the boundary never overtakes NIMUSHI" and "the arena is never inverted" true by
   * construction, whatever the tuning does.
   */
  get boundaryY() {
    const room = this.along(this.face - this.deepY);
    return room < ABYSS.minArena ? this.face - ABYSS.minArena * this.sign : this.deepY;
  }
  /** True once the boundary has reached this point -- the player's own crush test. */
  caught(y: number) { return this.along(y - this.boundaryY) <= 0; }

  private along(value: number) { return value * this.sign; }

  start(playerY: number, sign: 1 | -1) {
    this.enabled = true; this.sign = sign;
    this.hp = NIMUSHI.maxHp; this.state = 'dormant'; this.phaseId = 1; this.pushback = 0; this.recoil = 0;
    this.elapsed = 0; this.started = false; this.defeated = false; this.raged = false; this.taunted = false;
    this.x = WORLD.width / 2; this.y = playerY + NIMUSHI.restGap * sign;
    this.tapiocas = []; this.cups = []; this.beams = [];
    this.mark = playerY; this.deepY = playerY - ABYSS.maxSlack * sign;
    this.timer = 0; this.defeatTimer = 0; this.windowDamage = 0; this.rotation = 0; this.beamsFired = 0;
    this.waveTimer = 0; this.rageTimer = 0; this.rageLane = 0; this.rageDir = 1;
  }
  reset() {
    this.enabled = false; this.started = false; this.defeated = false; this.raged = false;
    this.state = 'dormant'; this.hp = NIMUSHI.maxHp; this.elapsed = 0; this.phaseId = 1; this.pushback = 0; this.recoil = 0;
    this.tapiocas = []; this.cups = []; this.beams = [];
    this.mark = 0; this.deepY = 0; this.windowDamage = 0; this.beamsFired = 0;
  }

  /**
   * A player-side round reached NIMUSHI. Reports WHICH part it met, so the caller can absorb the
   * round either way but only credit damage for one of them. Nothing else in the codebase can
   * reach the boss, which is what makes "an explosion cannot bypass the eye" true by construction
   * rather than by a check somewhere.
   */
  hitTest(shot: { x: number; y: number; previousY: number; size: number }): 'eye' | 'body' | null {
    if (!this.active) return null;
    const lo = Math.min(shot.previousY, shot.y), hi = Math.max(shot.previousY, shot.y);
    const eye = this.eye;
    if (shot.x + shot.size > eye.x && shot.x - shot.size < eye.x + eye.width && hi >= eye.y && lo <= eye.y + eye.height) return 'eye';
    const body = this.body;
    if (shot.x + shot.size > body.x && shot.x - shot.size < body.x + body.width && hi >= body.y && lo <= body.y + body.height) return 'body';
    return null;
  }

  /**
   * Damage through the weak point, and the only way HP ever moves.
   *
   * A hit on a shut eye is not damage -- it is a round hitting an eyelid -- so this refuses it and
   * the caller absorbs the round with nothing to show for it. The first one that lands is what
   * wakes NIMUSHI and starts BOSS TIME; it also buys the run a little room from the boundary,
   * which is the whole reason attacking is how you survive here.
   */
  hitEye(amount: number): NimushiSignal[] {
    const signals: NimushiSignal[] = [];
    if (!this.eyeOpen || !Number.isFinite(amount) || amount <= 0) return signals;
    if (!this.started) {
      this.started = true; this.elapsed = 0;
      this.state = 'eyeOpen'; this.timer = NIMUSHI.eyeWindow.timeout; this.windowDamage = 0;
      signals.push({ kind: 'started' }, { kind: 'line', text: NIMUSHI_LINES.wake });
    }
    this.hp = Math.max(0, this.hp - amount);
    this.windowDamage += amount;
    // The hit REACTION: the body is knocked back a few pixels and springs home. It is feedback, not
    // distance -- see HIT_REACTION for what it replaced and why.
    this.recoil = HIT_REACTION.recoil;
    if (HIT_REACTION.pushback) {
      // Shooting the eye shoves NIMUSHI further along the pull and pushes the boundary back with it.
      // Both are per point of damage, so the relief a run gets for taking HP off is the same whatever
      // it is holding -- and both are still capped, the shove by the ordinary gap clamp next frame
      // and the relief by `maxArena`, so a burst cannot bank unlimited safety out of one window.
      this.y += NIMUSHI.pushPerHit * amount * this.sign;
      // Raise the TARGET too, or the controller would simply pull the shove straight back in.
      this.pushback = Math.min(NIMUSHI.maxGap - NIMUSHI.restGap, this.pushback + NIMUSHI.pushPerHit * amount);
    }
    this.deepY += ABYSS.pushRelief * amount * this.sign * -1;
    if (this.slack > ABYSS.maxSlack) this.deepY = this.mark - ABYSS.maxSlack * this.sign;
    signals.push({ kind: 'hurt' });
    if (this.hp <= 0) {
      this.defeated = true; this.state = 'dead'; this.defeatTimer = NIMUSHI.defeatDelay;
      this.tapiocas = []; this.cups = []; this.beams = [];
      signals.push({ kind: 'defeated' });
      return signals;
    }
    if (!this.taunted && this.ratio <= NIMUSHI_DYING_RATIO) {
      this.taunted = true;
      signals.push({ kind: 'line', text: NIMUSHI_LINES.dying });
    }
    return signals;
  }

  /** A round hit a cup. Cups are the one thing in the fight that is NOT the weak point rule. */
  hitCup(cup: TapiocaCup, amount: number) {
    cup.hp -= amount;
    if (cup.hp > 0) return false;
    cup.alive = false;
    return true;
  }

  update(dt: number, player: { x: number; y: number; vy: number }, random: () => number, cameraY: number): NimushiSignal[] {
    const out: NimushiSignal[] = [];
    if (!this.enabled || !Number.isFinite(dt) || dt <= 0) return out;
    this.station(dt, player, cameraY);
    this.moveEntities(dt, player);
    if (this.defeated) {
      this.defeatTimer -= dt;
      if (this.defeatTimer <= 0) { this.enabled = false; out.push({ kind: 'cleared' }); }
      return out;
    }
    if (this.state === 'dormant') return out;
    this.elapsed += dt;
    this.pressure(dt, player);
    if (this.rageActive) this.pourRage(dt, random);
    this.advance(dt, player, random, out);
    return out;
  }

  /**
   * Station-keeping.
   *
   * NIMUSHI hauls the arena along the pull at its OWN pace -- it is what the whole fight is
   * climbing towards -- and the player, who falls much faster than that, decides the distance
   * between them. Fall freely and you close until `minGap` stops you; hold back on the gunboots'
   * recoil and you drift out to `maxGap` and no further.
   *
   * Its position is a POSITION, never a distance recomputed from the one it was given last frame.
   * That is the whole reason a shove works: adding the shove to a target that is then measured back
   * out of the result would simply ratchet the gap open a little more every frame until it hit the
   * clamp, which is what dragged the player out past the boundary the first time this was written.
   *
   * It only slides across the shaft while the eye is open, so a wind-up marks the column the attack
   * will actually land in and the telegraph can never lie.
   */
  /**
   * NIMUSHI climbs at its own pace, and nothing corrects the distance.
   *
   * This is the whole fight now. The player is pulled upward faster than NIMUSHI rises, so doing
   * nothing closes the gap and ends in the body -- and the way to buy that distance back is the one
   * AREA 1-4 teaches: stomp something and get thrown the other way.
   *
   * Everything that used to live here is gone. A velocity-matching controller, then a screen band,
   * then two screen bands: each of them kept the player at a safe distance FOR them, and each one
   * quietly removed the reason to play. The distance is the player's problem again.
   */
  private station(dt: number, player: { x: number; y: number; vy: number }, cameraY: number) {
    void cameraY;
    const haul = TRANSITION_HAUL.enabled && this.state === 'phaseTransition' ? NIMUSHI.transitionSpeed : 0;
    // Well under the arena's terminal speed, so the player always closes when they stop working.
    this.y += (NIMUSHI.ascentSpeed + haul) * dt * this.sign;
    // The hit recoil springs home. It moves the body, not the station, so nothing here is a rule
    // about where the player may be -- and NIMUSHI cannot be shot out of the frame.
    this.recoil = Math.max(0, this.recoil - (HIT_REACTION.recoil / HIT_REACTION.settle) * dt);
    if (HIT_REACTION.pushback) {
      this.y += this.pushback * this.sign * dt;
      this.pushback = Math.max(0, this.pushback - (NIMUSHI.pushPerHit / NIMUSHI.pushbackDecay) * dt);
    }

    /**
     * NIMUSHI cannot be overtaken.
     *
     * This is NOT the safe-distance controller coming back: it does not hold the player at a
     * comfortable range, and it does nothing at all until they are already inside the body taking
     * contact damage. What it stops is sailing straight past and leaving the fight behind -- with
     * nothing here at all, a player who keeps stomping climbs through NIMUSHI and ends up thousands
     * of pixels above it with no boss on screen.
     *
     * NIMUSHI is what the arena is climbing toward. The consequence of reaching it is the body, not
     * an empty sky.
     */
    if (this.along(this.y - player.y) < 0) this.y = player.y;

    if (this.state === 'eyeOpen' || this.state === 'dormant' || this.state === 'recovery') {
      const towards = Math.sign(player.x - this.x);
      const edge = WORLD.wall + NIMUSHI.bodyWidth / 2;
      this.x = Math.max(edge, Math.min(WORLD.width - edge, this.x + towards * NIMUSHI.drift * dt));
    }
  }
  /** How far the player currently is from the face -- the one number the fight is really about. */
  reach(playerY: number) { return this.along(this.face - playerY); }

  /**
   * The deep rises. It eats into the slack on its own, faster the deeper the fight has gone, and
   * the mark it is measured from only ever improves -- so climbing buys room and stalling spends it.
   * A phase transition hands the slack back in full, because being hauled up through a changing
   * arena is not something the player should be able to drown in.
   */
  private pressure(dt: number, player: { x: number; y: number }) {
    if (this.along(player.y - this.mark) > 0) this.mark = player.y;
    if (this.state === 'phaseTransition') { this.deepY = this.mark - ABYSS.maxSlack * this.sign; return; }
    // It rises at its own pace, and is never left further behind the player's best than maxSlack.
    // That second rule is the whole mechanic: outrun it and it is dragged along at arm's length,
    // stall and it closes. A boundary measured purely from the player would make climbing worthless.
    const speed = ABYSS.pressureSpeed + ABYSS.pressureRamp * (this.phaseId - 1);
    this.deepY += speed * dt * this.sign;
    if (this.slack > ABYSS.maxSlack) this.deepY = this.mark - ABYSS.maxSlack * this.sign;
  }

  /** Everything in the air, moved and culled in one place so a long fight cannot grow a list. */
  private moveEntities(dt: number, player: { x: number; y: number }) {
    for (const pearl of this.tapiocas) { pearl.x += pearl.vx * dt; pearl.y += pearl.vy * dt; pearl.life -= dt; }
    this.tapiocas = this.tapiocas.filter(p => p.life > 0 && Math.abs(p.y - player.y) < WORLD.height * 1.4);
    for (const cup of this.cups) {
      if (!cup.alive) continue;
      cup.life -= dt;
      if (cup.life <= 0) { cup.alive = false; continue; }
      if (cup.state === 'falling') {
        cup.y += cup.vy * dt;
        // It travels PAST the player and plants itself behind them, which is the half of the
        // pincer that comes from below. Never past the boundary: a straw inside the deep is
        // a straw nobody can shoot.
        let stopY = player.y - TAPIOCA_CUP.standoff * this.sign;
        if (this.along(stopY - this.boundaryY) < 0) stopY = this.boundaryY + 40 * this.sign;
        if (this.along(cup.y - stopY) <= 0) { cup.y = stopY; cup.state = 'warning'; cup.timer = TAPIOCA_CUP.warning; }
        continue;
      }
      // Planted: it holds the spot it chose. Being left behind by the ascent is what its lifetime
      // is for, and is also what keeps the list from growing across a long fight.
      cup.timer -= dt;
      if (cup.state === 'warning' && cup.timer <= 0) { cup.state = 'firing'; cup.timer = 0; cup.fired = 0; }
      if (cup.state === 'firing' && cup.timer <= 0) {
        // Spat back WITH the pull, which is straight at the player from below.
        this.tapiocas.push({
          id: this.nextId++, x: cup.x, y: cup.y - (TAPIOCA_CUP.height / 2) * this.sign,
          vx: 0, vy: TAPIOCA_CUP.shotSpeed * this.sign,
          size: TAPIOCA_SHOWER.size, life: TAPIOCA_SHOWER.life, damage: TAPIOCA_CUP.damage,
        });
        cup.fired++; cup.timer = TAPIOCA_CUP.shotInterval;
        if (cup.fired >= TAPIOCA_CUP.shots) { cup.state = 'spent'; cup.life = Math.min(cup.life, 1.2); }
      }
    }
    this.cups = this.cups.filter(c => c.alive && Math.abs(c.y - player.y) < WORLD.height * 1.2);
    for (const beam of this.beams) {
      beam.timer -= dt;
      if (beam.state === 'warning' && beam.timer <= 0) { beam.state = 'live'; beam.timer = STRAW_BEAM.live; }
    }
    this.beams = this.beams.filter(b => !(b.state === 'live' && b.timer <= 0));
  }

  /** The machine itself. Every state names its own exit; none of them shares a timer with another. */
  private advance(dt: number, player: { x: number; y: number }, random: () => number, out: NimushiSignal[]) {
    this.timer -= dt;
    switch (this.state) {
      case 'eyeOpen':
        // The window shuts on whichever comes first: enough damage taken, or long enough open.
        if (this.windowDamage < NIMUSHI.eyeWindow.damage && this.timer > 0) return;
        if (this.enterPhaseTransition(out)) return;
        this.state = 'eyeClosing'; this.timer = NIMUSHI.closing;
        out.push({ kind: 'eye', open: false });
        return;
      case 'eyeClosing':
        if (this.timer > 0) return;
        // A stretch with no attacks in its rotation goes straight to recovery and reopens. The
        // prototype runs the fight on gravity, stomps and the weak point alone, to find out whether
        // that is a game before anything is layered on top of it.
        if (!this.phase.attacks.length) { this.state = 'recovery'; this.timer = NIMUSHI.recovery; return; }
        this.pendingAttack = this.nextAttack();
        this.state = 'attackPrep'; this.timer = NIMUSHI_ATTACKS[this.pendingAttack].prep;
        this.prepare(this.pendingAttack, player);
        out.push({ kind: 'prep', attack: this.pendingAttack });
        return;
      case 'attackPrep':
        if (this.timer > 0) return;
        this.state = this.pendingAttack; this.timer = NIMUSHI_ATTACKS[this.pendingAttack].active;
        this.waveTimer = 0;
        this.launch(this.pendingAttack, player, random, out);
        out.push({ kind: 'attack', attack: this.pendingAttack });
        return;
      case 'tapiocaShower':
        this.pourShower(dt, random);
        if (this.timer > 0) return;
        this.state = 'recovery'; this.timer = NIMUSHI.recovery;
        return;
      case 'strawBeam':
        this.nextBeam(player);
        /**
         * The SEQUENCE decides when this ends, not a timer kept in step with it.
         *
         * `active` sets the floor and the columns set the real end: the state is over once the
         * clock has run out AND nothing is still burning. Each column is raised the frame after the
         * last one cleared, so a sequence drifts a few frames past any duration written for it --
         * and with a timer alone the third beam burned on into `recovery`, where the eye is shut.
         */
        if (this.timer > 0 || this.beams.length) return;
        this.state = 'recovery'; this.timer = NIMUSHI.recovery;
        return;
      case 'cupSummon':
      case 'nimushiClones':
        if (this.timer > 0) return;
        this.state = 'recovery'; this.timer = NIMUSHI.recovery;
        return;
      case 'recovery':
        if (this.timer > 0) return;
        if (this.enterPhaseTransition(out)) return;
        this.openEye(out);
        return;
      case 'phaseTransition':
        if (this.timer > 0) return;
        if (!this.raged && this.ratio <= FINAL_RAGE_RATIO) { this.enterRage(out); return; }
        this.openEye(out);
        return;
      case 'finalRage':
        if (this.timer > 0) return;
        this.openEye(out);
        return;
      default:
        return;
    }
  }

  /**
   * Open the eye -- and clear the air first.
   *
   * The damage window is for shooting NIMUSHI, so it starts with the last attack's pearls swept
   * away. Leaving them in flight made the counterattack a second dodge: the player would finally
   * get their window and spend it reading leftovers from the pattern they had already answered.
   *
   * FINAL RAGE's own curtain is not swept, because it is not an attack that ended -- it runs
   * underneath the whole cycle by design, and the eye still opens through it.
   */
  private openEye(out: NimushiSignal[]) {
    if (!this.raged && this.ratio <= FINAL_RAGE_RATIO) { this.enterRage(out); return; }
    if (this.state !== 'finalRage') this.tapiocas = [];
    this.state = 'eyeOpen'; this.timer = NIMUSHI.eyeWindow.timeout; this.windowDamage = 0;
    out.push({ kind: 'eye', open: true });
  }

  private enterRage(out: NimushiSignal[]) {
    this.raged = true;
    this.state = 'finalRage'; this.timer = NIMUSHI.rageIntro;
    this.rageTimer = 0; this.rageLane = 0; this.rageDir = 1;
    // The cut-in is the one beat the fight holds. Everything already in the air is swept away so
    // the rage opens on a clean screen rather than on leftovers nobody can read.
    this.tapiocas = []; this.beams = [];
    out.push({ kind: 'rage' }, { kind: 'line', text: NIMUSHI_LINES.rage });
  }

  /** True if the HP that has just been lost crossed into a new stretch of the ABYSS. */
  private enterPhaseTransition(out: NimushiSignal[]) {
    const phase = abyssPhaseAt(this.ratio);
    if (phase.id === this.phaseId) return false;
    this.phaseId = phase.id;
    this.rotation = 0;
    this.state = 'phaseTransition'; this.timer = NIMUSHI.transition;
    // Everything the previous stretch had in the air goes with it, so the haul upward is clean.
    this.tapiocas = []; this.cups = []; this.beams = [];
    this.deepY = this.mark - ABYSS.maxSlack * this.sign;
    out.push({ kind: 'eye', open: false }, { kind: 'phase', phase });
    return true;
  }

  /** The stretch's rotation, in order. Each phase adds to the last rather than replacing it. */
  private nextAttack(): AbyssAttackId {
    const list = this.phase.attacks;
    const id = list[this.rotation % list.length];
    this.rotation++;
    return id;
  }

  /** The wind-up. Only the beam has anything to show before it lands -- and it must. */
  private prepare(attack: AbyssAttackId, player: { x: number; y: number }) {
    if (attack !== 'strawBeam') return;
    this.beamsFired = 0;
    this.raiseBeam(player);
  }

  /**
   * One column, aimed at where the player is NOW.
   *
   * Locked onto the column the player is in at the MOMENT this warning starts, so stepping aside
   * always works and the line they are shown is the line the beam actually uses. Each column in a
   * sequence takes its own reading, which is what stops one sidestep answering the whole attack.
   */
  private raiseBeam(player: { x: number }) {
    this.beams.push({ id: this.nextId++, x: player.x, width: STRAW_BEAM.width, state: 'warning', timer: STRAW_BEAM.warning });
    this.beamsFired++;
  }

  /**
   * The next column of the sequence, raised only once the previous one has finished burning.
   *
   * "The list is empty" IS the rule -- there is no second timer to keep in step, and no way for two
   * columns to exist at once whatever the durations are set to. So the attack can never pincer the
   * player between two of them: it asks them to move, three times, and never asks where to.
   */
  private nextBeam(player: { x: number }) {
    if (this.beams.length || this.beamsFired >= STRAW_BEAM.count) return;
    this.raiseBeam(player);
  }

  private launch(attack: AbyssAttackId, player: { x: number; y: number }, random: () => number, out: NimushiSignal[]) {
    if (attack === 'cupSummon') {
      const span = TAPIOCA_CUP.maxCount - TAPIOCA_CUP.minCount;
      const count = TAPIOCA_CUP.minCount + Math.round(random() * span);
      const usable = WORLD.width - WORLD.wall * 2 - TAPIOCA_CUP.width;
      for (let i = 0; i < count; i++) {
        const x = WORLD.wall + TAPIOCA_CUP.width / 2 + usable * ((i + 0.5) / count);
        this.cups.push({
          id: this.nextId++, x, y: this.face, vy: -TAPIOCA_CUP.fallSpeed * this.sign,
          hp: TAPIOCA_CUP.hp, state: 'falling', timer: 0, fired: 0, life: TAPIOCA_CUP.life, alive: true,
        });
      }
    }
    if (attack === 'nimushiClones') {
      const span = NIMUSHI_CLONES.maxCount - NIMUSHI_CLONES.minCount;
      const count = NIMUSHI_CLONES.minCount + Math.round(random() * span);
      out.push({ kind: 'clones', count, y: this.face - NIMUSHI_CLONES.spread * this.sign });
    }
    // A fresh shower starts its gap somewhere new; the waves inside it walk from there.
    if (attack === 'tapiocaShower') {
      this.showerLane = -1;
      this.spawnShowerWave(random);
      // Start the clock HERE. Leaving it at zero let `pourShower` fire again on the very next frame,
      // so every shower opened with two waves six pixels apart -- double density at exactly the
      // moment the player is trying to read where the corridor is.
      this.waveTimer = TAPIOCA_SHOWER.waveInterval;
    }
  }

  private pourShower(dt: number, random: () => number) {
    this.waveTimer -= dt;
    if (this.waveTimer > 0) return;
    this.waveTimer = TAPIOCA_SHOWER.waveInterval;
    this.spawnShowerWave(random);
  }

  /**
   * One wave of TAPIOCA SHOWER. `safeLanes` columns are chosen and left EMPTY before anything is
   * spawned, so a wave with no way through it cannot be built -- the gap is a precondition of the
   * wave rather than a property somebody hopes holds.
   */
  spawnShowerWave(random: () => number) {
    const lanes = TAPIOCA_SHOWER.lanes;
    const width = Math.max(1, Math.min(TAPIOCA_SHOWER.safeLanes, lanes - 1));
    // The first wave of a shower picks where the gap starts; every wave after it moves the gap by
    // one lane, so following it is a matter of walking rather than of guessing.
    if (this.showerLane < 0) this.showerLane = Math.min(lanes - width, Math.floor(random() * (lanes - width + 1)));
    else {
      this.showerLane += this.showerDir;
      if (this.showerLane + width > lanes) { this.showerLane = lanes - width - 1; this.showerDir = -1; }
      if (this.showerLane < 0) { this.showerLane = 1; this.showerDir = 1; }
    }
    const safe = new Set<number>();
    for (let i = 0; i < width; i++) safe.add(this.showerLane + i);
    for (let lane = 0; lane < lanes; lane++) {
      if (safe.has(lane)) continue;
      // A pair per lane, set either side of its centre. One pearl per lane leaves a gap inside the
      // lane wide enough to park in, which turns the safe-lane guarantee into a safe-SEAM bug: the
      // column has to be genuinely closed or "at least one lane is open" means nothing.
      for (const offset of [-1, 1]) this.tapiocas.push(this.pearl(lane, lanes, TAPIOCA_SHOWER.speed, TAPIOCA_SHOWER.damage, TAPIOCA_SHOWER.size, offset));
    }
    return [...safe];
  }

  /**
   * FULL SCREEN TAPIOCA, pouring underneath the ordinary cycle once FINAL RAGE has triggered.
   *
   * The corridor is `corridor` adjacent lanes wide and walks one lane per wave, turning at the
   * walls. The screen is therefore never sealed, and the way through moves -- which is what makes
   * it a pattern to read rather than a dice roll to survive.
   */
  private pourRage(dt: number, random: () => number) {
    this.rageTimer -= dt;
    if (this.rageTimer > 0) return;
    this.rageTimer = FULL_SCREEN_TAPIOCA.waveInterval;
    this.spawnRageWave();
    void random;
  }

  spawnRageWave() {
    const lanes = FULL_SCREEN_TAPIOCA.lanes;
    const width = Math.max(1, Math.min(FULL_SCREEN_TAPIOCA.corridor, lanes - 1));
    const open = new Set<number>();
    for (let i = 0; i < width; i++) open.add(this.rageLane + i);
    for (let lane = 0; lane < lanes; lane++) {
      if (open.has(lane)) continue;
      for (const offset of [-1, 1]) this.tapiocas.push(this.pearl(lane, lanes, FULL_SCREEN_TAPIOCA.speed, FULL_SCREEN_TAPIOCA.damage, FULL_SCREEN_TAPIOCA.size, offset));
    }
    this.rageLane += this.rageDir;
    if (this.rageLane + width > lanes) { this.rageLane = lanes - width - 1; this.rageDir = -1; }
    if (this.rageLane < 0) { this.rageLane = 1; this.rageDir = 1; }
    return [...open];
  }

  /** One pearl in one lane, launched from NIMUSHI's face straight AGAINST the pull. */
  private pearl(lane: number, lanes: number, speed: number, damage: number, size = TAPIOCA_SHOWER.size, offset = 0): Tapioca {
    const usable = WORLD.width - WORLD.wall * 2;
    const width = usable / lanes;
    const x = WORLD.wall + usable * ((lane + 0.5) / lanes) + offset * width * 0.25;
    return {
      id: this.nextId++, x, y: this.face,
      vx: 0, vy: -speed * this.sign,
      size, life: TAPIOCA_SHOWER.life, damage,
    };
  }
}

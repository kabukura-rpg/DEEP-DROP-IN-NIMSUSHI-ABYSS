# NIMUSHI CORE GAMEPLAY RESET PLAN

**Plan only. No product code changed.** Baseline `6270378`, `main` untouched at `6e3d1af`,
789 tests green.

The principle: **SAME GAME, REVERSED GRAVITY.** The look, the attacks and the staging stay original;
the player's verbs go back to the ones AREA 1–4 taught.

---

## 1. Boss-specific systems that exist today

| # | System | Where | Boss-only? |
|---|---|---|---|
| 1 | Physics layer (`gravity`/`maxFallSpeed`/`moveSpeed`) | `bossPhysics.ts`, `GameModel.physics` | yes |
| 2 | Gravity direction as its own axis | `GRAVITY_DIRECTION`, `setGravity` | shared, boss uses `-1` |
| 3 | Floorless arena | `ABYSS_PHASES[*].groundless` | yes |
| 4 | **Vertical thrust** (negative brake floor + `maxThrust`) | `fireVolley` `floor` | yes |
| 5 | **Normalised vertical control 420** | `BOSS_PHYSICS.verticalControl` | yes |
| 6 | **CHARGE ORB** (contact pickup, FULL reload) | `chargeOrbChance`, `AirContainer.charge` | yes |
| 7 | Screen band, two positions | `NIMUSHI.attackBand/damageBand`, `station()` | yes |
| 8 | Camera-carry in `station()` | `NimushiBossSystem.lastCameraY` | yes |
| 9 | **Pressure boundary** (`deepY`, `slack`, `caught` → instant death) | `NimushiBossSystem`, `ABYSS` | yes |
| 10 | **Band-centre knockback** | `GameModel.damage`, `hazardKnockback` | yes |
| 11 | Eye-hit pushback + decay | `pushback`, `pushbackDecay` | yes |
| 12 | Tapioca destructibility | bullet pass, arena branch | yes |
| 13 | State machine / attacks / phases / RAGE | `NimushiBossSystem` | yes |
| 14 | BOSS TEST dev shortcut | `src/dev/bossTest.ts` | dev only |

Items 4, 5, 6, 9, 10 are the ones that made the fight a different game.

---

## 2. REMOVE

| System | Why | Cost |
|---|---|---|
| **Vertical thrust** (4) | The gunboots became a flight stick. Reverting restores `GUNBOOTS = BRAKE, NOT THRUSTER` under reversed gravity: firing weakens the climb and cannot drive the player down. | `floor` back to `0`; delete `maxThrust` |
| **Normalised 420** (5) | Only existed because thrust was a dodge. With thrust gone, recoil is the run's own again and weapon identity needs no special case. | delete `verticalControl`, restore `volleyRecoil` |
| **CHARGE ORB** (6) | A boss-only resource verb. Replaced by STOMP → FULL RELOAD, which is the run's own language. | delete `chargeOrbChance`, `AirContainer.charge`, the orb branch in `breakContainer` and `layAbyssRow` |
| **Pressure as a hazard** (9) | Boss + attack + pressure is three things at once. Demote to an anti-stall fallback. | see §9 |
| **Band-centre knockback** (10) | A correction controller layered on a correction controller. See §14. | simplify to the ordinary hurt response |

Already removed earlier and staying removed: the velocity-matching gap controller, `matchRatio`,
`gapGain`, `maxCorrection`, the `minGap` snap.

## 3. KEEP

Gravity abstraction · boss physics isolation · THE ABYSS transition and staging · gravity reversal ·
NIMUSHI state machine · eye open/closed weak point · attack → recovery → damage window · all 7
weapons · screen band (two positions) · camera-carry · floorless arena · readable corridor (3 lanes,
0.75s) · tapioca destructibility · clone system · phase progression · FINAL RAGE framework · retry
isolation · eye-hit pushback · BOSS TEST.

## 4. REPLACE

| Out | In | Mechanic reused |
|---|---|---|
| Vertical thrust as the dodge | **STOMP → BOUNCE** off an aerial target | enemy stomp |
| CHARGE ORB | **STOMP → FULL RELOAD** | `kill(e, true)` → `reloadCharge()` |
| Pressure as pacing | Attack cycle + phase progression (already there) | — |

---

## 5. Normal mechanics to reuse — and the good news

**The stomp is already fully gravity-relative.** No new code, no mirrored copy:

```ts
const crown = e.y - 10 * this.gravity;                       // the face the pull brings you onto
const topCrossing = this.along(p.vy) > 0                     // moving WITH the pull
  && this.crossedWithGravity(oldY + this.lead, p.y + this.lead, crown);
if (topCrossing && e.stompable) {
  this.kill(e, true);                                        // -> reloadCharge()
  p.y = e.y - 28 * this.gravity;
  p.vy = this.up * this.stats.bounce;                        // bounce AGAINST the pull
  p.grounded = -1;                                           // never grounded: no stop, no settle
}
```

In the arena that reads: the player rises into a target, stomps its **underside**, bounces back **down
the screen**, and refills CHARGE — exactly the verb from AREA 1–4, mirrored by the abstraction that
already exists. `grounded` stays `-1`, so it does not stop the player or settle a chain, which is
what the floorless rule needs.

Bullet/enemy collision, COMBO, COIN, BLAST MODULE and corpses all ride the same path unchanged.

## 6. Gravity-relative stomp: feasible today?

**Yes, with one blocker.** The mechanic works; there is nothing to stomp.

- Clones spawn **only** from the `nimushiClones` attack.
- That attack appears **only** in phase 4's attack list.
- Phase 4's `clonePool` is `nimushiShade`, which is **`stompable: false`**.

So **there is currently no stompable target anywhere in the fight.** Making STOMP the charge economy
requires bounce targets to exist independently of the clones attack, in every stretch.

## 7. BOUNCE TARGET proposal

**BOUNCE TAPIOCA** — a large pearl that is a stomp target, not a platform.

- Reuses `Enemy` with `stompable: true`, `shootable: true`, `flying: true`, 1 HP.
- Drifts across the shaft; no contact damage from the sides is *required*, but keeping ordinary
  enemy contact damage is the more honest reuse — mistiming a stomp should cost, as it does in the run.
- Stomping it: dies, bounces the player down the screen, fills CHARGE. All existing code.
- Shooting it: dies without the bounce — the same trade the run already has.

Placement is the design work, and the guarantee is the point:

> **Every attack cycle offers at least one bounce target reachable without taking unavoidable damage.**

Sketch: lay one per cycle at the start of `attackPrep`, on the opposite side of the shaft from the
shower's opening corridor, in the player's half of the band. Phase 4 keeps `nimushiShade` as its
unstompable threat and gets bounce tapiocas alongside, so LIMBO is not the one stretch with no
reload.

## 8. CHARGE economy after the change

```
fire to dodge / shoot a pearl  ->  CHARGE down
stomp a bounce target          ->  CHARGE FULL   (+ combo, + coins, + a downward dodge)
```

One verb, three payoffs — the same bargain the run makes. Soft-lock protection is the §7 guarantee
rather than a boss-only pickup. Worth stating plainly: with vertical thrust gone, CHARGE is no longer
needed for vertical control, so the pressure on the magazine drops on its own.

## 9. Pressure

Demote in two steps:

1. **Now:** `caught()` stops killing. Keep `deepY` rising and keep the HUD cue, so the shaft still
   reads as closing, but make contact harmless or a single heart on a long cooldown.
2. **After playtest:** decide whether it earns its place at all. A boss with an attack cycle and four
   stretches already has pacing; an anti-stall fallback may be all that is wanted.

`killInstantly('crush')` is one call site. `slack`, `mark` and `maxSlack` can stay as telemetry.

## 10. Minimum prototype (STEP 5)

One cycle, human-playable, nothing else touched:

```
TELEGRAPH -> TAPIOCA SHOWER -> dodge the corridor / shoot a pearl / stomp a bounce tapioca
          -> ATTACK END -> NIMUSHI APPROACHES -> EYE OPEN -> DAMAGE -> EYE CLOSE -> RETREAT
```

Scope: phase 1 only, shower only, bounce targets on, thrust off, orbs gone, pressure non-lethal.
STRAW BEAM, CUP and CLONES stay as they are until this cycle is judged.

## 11. Code and tests that go

**Code:** `BOSS_PHYSICS.verticalControl`, `.maxThrust`; the `floor`/`kick` arena branches in
`fireVolley`; `AirContainer.charge`; the orb branch of `breakContainer`; the orb block in
`layAbyssRow`; `AbyssPhase.chargeOrbChance` (×4 rows); `BOSS_PHYSICS.hazardKnockback` and the arena
branch in `damage()`; `killInstantly('crush')` at the `caught()` call.

**Tests:** `tests/bossMovement.test.ts` D–H and K (the thrust ladder) and its CHARGE-orb cases;
`tests/bossArena.test.ts` orb and knockback blocks; `tests/bossGap.test.ts` (mostly superseded —
its no-body-contact assertions should survive into the band tests). Roughly **25–30 assertions**
retired, replaced by stomp/bounce/reload coverage.

**Not touched:** `tests/boss.test.ts` (80), `bossPhysics.test.ts`, `bossPattern.test.ts`,
`bossRhythm.test.ts` band and tapioca cases.

## 12. Migration order

| Step | Change | Gate |
|---|---|---|
| 1 | Bounce tapioca as an enemy kind + per-cycle placement with the reachability guarantee | stomp fills CHARGE and bounces down-screen in the arena |
| 2 | Remove CHARGE ORB | no soft-lock across 4 stretches × N seeds at CHARGE 0 |
| 3 | Remove vertical thrust + normalised 420 | brake-not-thruster holds in the arena; all 7 weapons still reach |
| 4 | Pressure non-lethal | no crush deaths; fight still ends on HP or the boss |
| 5 | Simplify knockback | no death combo; ordinary hurt response otherwise |
| 6 | Minimum prototype playable end to end | browser + mobile, then **human playtest** |
| 7 | Re-enable / judge BEAM, CUP, CLONES | after 6 |

Steps 1–2 must land together or the fight has no reload. Step 3 after them, because removing thrust
before there is a stomp target leaves no vertical dodge at all.

**Design rule going forward:** before any new mechanic — *can something AREA 1–4 already taught solve
this?* If yes, reuse it. Boss-only mechanics are the last resort.

---

## Open questions for you

1. **Bounce target contact damage** — should mistiming a stomp cost a heart, as in the run (my
   recommendation: yes, it is the honest reuse), or should the target be harmless?
2. **Pressure** — non-lethal now and re-judged later, or removed from the fight outright?
3. **CUP** — keep as the fourth attack, or disable until the others are judged?
4. **Eye-hit pushback** — keep? It is boss-only, but it is presentation for a hit landing rather than
   a movement rule, so I would keep it.

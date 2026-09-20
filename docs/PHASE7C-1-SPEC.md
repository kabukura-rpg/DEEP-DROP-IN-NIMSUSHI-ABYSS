# PHASE 7C-1 — PHYSICS LOCK + TERRAIN SPECIFICATION

Specification only. `StageGenerator` is not rewritten here and no physics value is changed.
The one piece of code in this package is the development-only diagnostic in section A.

Baseline: HEAD `6b55a95`, `main` untouched at `6e3d1af`, 674 tests green, tsc clean, build ✓.

---

## A. BLOCK VISUAL DIAGNOSTIC — implemented

Status of the bug itself: **UNRESOLVED — NOT REPRODUCED.** Not closed.

What is actually established, and no more: the *model's* terrain is immutable. Across five SECTIONs
with every platform snapshotted every frame for 90s — `1-1` 32 rows, `1-3` 43, `2-2` 47, `3-2` 27,
`4-2` 48 — there were zero geometry mutations and zero id reuses with different geometry. That rules
out one layer. It says nothing about the renderer, and the human report stands.

**`src/dev/TerrainWatch.ts`** (new) records the layer the probe could not reach: what each frame is
about to draw. Every visible platform contributes two independent signatures.

| Signature | Contents | Changing is |
|---|---|---|
| GEOMETRY | `id, x, y, width` | **always a bug** — reported individually |
| APPEARANCE | `state, breakable, spikePlatform, limboHazard, safeZone, breakBlock{hits/durability/reward}` | legal; **≥4 in one frame** is reported as `BULK RESTYLE` |

The appearance key is exactly the set of fields `GameScene` branches on when drawing a platform, so
two ledges that look identical produce the same string and any visible difference produces a
different one.

Three design points that decide whether this catches anything:

- It is fed the **culled** list, not `m.platforms`. Feeding it everything reports each row scrolling
  into view as a change — that is the noise which buried the signal in the first investigation, and
  there is a test pinning the behaviour.
- The bulk threshold separates *gameplay* from *the symptom*. One ledge cracking under the player is
  silent; four changing in a single frame is the shape of "blocks all changed".
- Events carry `t`, frame, SECTION label and `cameraY`, so a dump lines up against what was on screen.

Usage: play the dev build, and when the terrain misbehaves run `__terrainWatch.dump()` in the console.

Cost outside development: **zero**. The call site and the field are behind `import.meta.env.DEV`;
`grep "BULK RESTYLE" dist/assets/*.js` returns nothing, so the module is dropped from the bundle.

### A hypothesis raised and then knocked down by measurement

`BreakablePlatformSystem.shatter` cracks every breakable ledge within `shatterRadius: 190` of a dying
RUIN BREAKER, and cracking recolours a ledge green → yellow → pink. One kill repainting several rows
at once is precisely what was described, so this looked like the answer.

It is not, or at least not usually. Measuring the generator: the median gap between levels is
**245px**, and only **2.4–3.2%** of gaps are within 190px. A kill therefore reaches its own row and
no other in ~97% of cases. The hypothesis is **weakened, not eliminated** — the remaining 3% is real.

`tests/terrainWatch.test.ts` keeps this inverted as a live assertion: a shatter at the measured
spacing must hit exactly one row. If anyone later widens the radius or tightens the rows, the
candidate comes back into play loudly rather than silently.

---

## B. METRIC TERMINOLOGY — correction

The 44–51 and 32–34 figures were both correct and were counting different things. Fixed vocabulary:

| Term | Definition |
|---|---|
| **PIECE** | one entry in `model.platforms`; the atom collision and the renderer see |
| **GATE BLOCK** | a piece carrying `breakBlock` |
| **GATE ROW** | the five gate blocks spanning the shaft at one y, counted **once** |
| **HAZARD PIECE** | a piece carrying `limboHazard` — never landable, not a floor |
| **CHAMBER FLOOR** | a piece carrying `safeZone` |
| **ROUTE LEDGE** | an ordinary landable piece: none of the above. *This is what the first audit called a platform.* |
| **TRAP LEDGE** | a route ledge carrying `spikePlatform` — a **subset** of route ledges, not an addition |
| **LEVEL** | a distinct y at which any piece sits |

So `1-1` has 33 pieces = 22 route ledges + 10 gate blocks (2 gate rows) + 1 chamber floor. Neither
earlier number was wrong; "rows" was.

Both earlier censuses also over-counted, because generation runs a screen ahead of the camera and
both loops counted the rows it laid past the section end. Corrected, section-bounded, 25 seeds:

```
AREA-SEC | pieces | routeLedge | trapLedge | gateBlock | gateRow | hazardPiece | chamberFloor | levels | density
  1-1    |  33.0  |   22.0     |    0.0    |   10.0    |   2.0   |     0.0     |     1.0      |  25.0  | 9.2 ledges/100m
  1-2    |  36.0  |   20.0     |    0.0    |   15.0    |   3.0   |     0.0     |     1.0      |  24.0  | 8.3
  1-3    |  36.0  |   20.0     |    0.0    |   15.0    |   3.0   |     0.0     |     1.0      |  24.0  | 8.3
  2-1    |  38.0  |   27.0     |    7.2    |   10.0    |   2.0   |     0.0     |     1.0      |  30.0  | 9.0
  2-2    |  37.7  |   26.7     |   11.8    |   10.0    |   2.0   |     0.0     |     1.0      |  29.7  | 8.9
  2-3    |  37.0  |   26.0     |   13.8    |   10.0    |   2.0   |     0.0     |     1.0      |  29.0  | 8.7
  3-1    |  42.0  |   31.0     |    0.0    |   10.0    |   2.0   |     0.0     |     1.0      |  34.0  | 9.1
  3-2    |  41.1  |   30.1     |    0.0    |   10.0    |   2.0   |     0.0     |     1.0      |  33.1  | 8.8
  3-3    |  40.7  |   29.7     |    0.0    |   10.0    |   2.0   |     0.0     |     1.0      |  32.7  | 8.7
  4-1    |  38.5  |    3.0     |    0.0    |    0.0    |   0.0   |    34.5     |     1.0      |  38.5  | 0.8
  4-2    |  37.7  |    1.0     |    0.0    |    0.0    |   0.0   |    35.7     |     1.0      |  37.7  | 0.3
  4-3    |  36.9  |    1.0     |    0.0    |    0.0    |   0.0   |    34.9     |     1.0      |  36.9  | 0.3
```

**Density (route ledges per 100m) is the metric to use from here on.** SECTION lengths differ by AREA
(240/300/340/380m), so raw per-section counts are not comparable and quietly flatter AREA 3.

Reproduce: `npx vitest run tests/measure/terrain.test.ts`

---

## C. DEEP DROP PHYSICS MEASUREMENT — results

`tests/measure/physics.test.ts`. Every figure is **observed from a running `GameModel`**, never
computed from the constants — clamps, grounded-frames, wall grace and the 1/120 step all get their
say. Player 22×30px, shaft 394px of open span.

| Quantity | Measured | Ratio |
|---|---|---|
| Ground jump rise | **59.13px** | **1.97 player-heights** |
| Ground jump apex | 0.36s | |
| Ground jump arc airtime | **0.72s** | |
| Ground jump horizontal reach | **130.5px** | **33.1% of shaft**, 5.93 player-widths |
| Gravity | 900px/s² exactly (7.5px/s per 1/120 step, verified f1…f60) | |
| Terminal velocity | **520px/s**, reached at **0.58s** after **155px** | 5.18 heights; **8.67px/frame @60fps** = 0.29 heights |
| Wall jump rise | **48.75px** | 1.63 heights |
| Wall jump apex / return | 0.33s / 0.67s | |
| Wall jump horizontal | **231.7px** | 10.53 widths, 58.8% of shaft — *not* wall-clamped |
| Recoil Δv, single shot | **−190px/s** | **36.5% of terminal** |
| Recoil, magazine from terminal | 1.17s, 525px vs 611px unfired | **14.0% slower** |
| Recoil, magazine from rest | 1.17s, **−45.8px — net CLIMB** | 109.9% |
| Stomp bounce | 210px/s → 21.6px rise, 0.4s apex | 0.72 heights |
| Walk | 180px/s; crosses the shaft in 2.19s | |
| Air control | **180px/s — 100% of ground** | |

Three harness defects were found and fixed before these numbers were trusted, and they are worth
recording because each produced a plausible-looking wrong answer:

1. A hand-built `Platform` never earns `player.grounded`, so `jump()` refused and the harness
   measured the **fallback path: 8.85px**, not the jump. Fixed by landing on a real platform and
   asserting the landing.
2. "Free fall" landed on generated ledges, so terminal read as `0px/s`. Fixed by clearing the
   platform list each step.
3. **Airtime was measured to landing** — a terrain figure wearing a physics costume. It reported 5s,
   which was the loop cap on a player who had fallen off the start platform. Airtime is now the
   ballistic arc: launch to back down at launch height.

### What these numbers already say about clone fidelity

- **A jump can never regain a row.** 59px rise against a 245px median gap. Descent is irreversible,
  which is correct in spirit — but 1.97 player-heights is a *tall* jump by Downwell's look, and it
  is the value flagged MEASUREMENT REQUIRED. Section D is how to settle it.
- **Air control is 100% of ground speed.** The player steers as freely mid-fall as standing. This is
  a strong candidate for feeling "floaty" versus the original and is measured, not guessed.
- **A magazine fired from rest is a net climb** (−45.8px). Gunboots are a full hover, not a brake.
  From terminal the same magazine only slows the fall 14%, so the two situations differ enormously —
  worth deciding deliberately rather than inheriting.
- **Wall jump throws the player 58.8% of the way across the shaft**, unclamped. That is a traversal
  move, not a foothold. *(Corrected: an earlier draft read the "壁に取っ掛かりが欲しい" note as being
  about this measurement. It is not — the request is about terrain geometry, whether the walls carry
  small landable structures at all. That is measurement 21; wall-contact physics is measurement 22.)*

---

## D. ORIGINAL FOOTAGE MEASUREMENT PROTOCOL

No original value is adopted without going through this.

Every quantity is recorded **twice**: the raw screen measurement, and its ratio against something
visible in the same frame. The ratio is what transfers — the original's resolution, zoom and sprite
scale are all different from DEEP DROP's — but the absolute is what makes a mistake findable later.
A ratio alone cannot be re-checked once the clip is closed.

**Capture.** 60fps, native resolution, no scaling or interpolation, Normal Mode, first World, a run
holding no upgrade that alters movement. Frame-step only; never scrub.

### Scale reference — measured once per clip, before anything else

| Symbol | Quantity | Note |
|---|---|---|
| `H` | player sprite height, px | the primary denominator for vertical quantities |
| `W` | player sprite width, px | the primary denominator for horizontal quantities |
| `S` | open shaft inner width, px, wall to wall | |
| `B` | apparent terrain block / tile size, px | **only if a repeating unit is actually visible** |

`B` is optional and is recorded **only when a repeating terrain unit can be seen**. If terrain reads
as a continuous mass with no repeating unit, or the apparent unit cannot be distinguished from a
texture, record `VISUAL UNIT ONLY` — or omit `B` entirely. Do not derive it from a guess at the
original's tile grid. Where `B` is available, terrain measurements carry `/ B` alongside `/ H` and
`/ W`, because a terrain grammar expressed in blocks is easier to reproduce than one in raw pixels.

### Measurements

Items 1–16 are unchanged from the original protocol; 17–22 are new. Grouped, one continuous numbering.

**Player physics — locomotion**

| # | Quantity | Method | Report as |
|---|---|---|---|
| 1 | Jump rise | standing frame → apex frame, top-of-sprite delta | px **and** `rise / H` |
| 2 | Jump apex time | frames from leaving ground to apex ÷ 60 | seconds |
| 3 | Jump airtime | leave-ground frame → first frame back at launch height ÷ 60 | seconds |
| 4 | Jump horizontal reach | x delta across that arc with a direction held | px **and** `dx / S`, `dx / W` |
| 5 | Free-fall acceleration | per-frame y delta over frames 1–10 of a fall; second difference | px/frame² **and** `/ H` |
| 6 | Terminal velocity | y delta per frame once flat, 10-frame mean | px/frame **and** `/ H` |
| 7 | Time to terminal | first fall frame → first flat frame ÷ 60 | seconds |
| 8 | Wall-jump rise | contact frame → apex | px **and** `rise / H` |
| 9 | Wall-jump horizontal | contact frame → frame back at contact height | px **and** `dx / W`, `dx / S` |
| 13 | Horizontal move, grounded | x delta per frame while grounded | px/frame **and** `/ W`, plus shaft-crossing seconds |
| 14 | Horizontal move, airborne | x delta per frame while falling ÷ grounded x delta per frame | ratio, 0–1 |

**Player physics — weapon and contact**

| # | Quantity | Method | Report as |
|---|---|---|---|
| 10 | MACHINE GUN single-shot recoil | per-frame y delta the frame before vs the frame after one shot | `Δ / terminal px-per-frame` |
| 11 | MACHINE GUN sustained recoil | y delta over a full magazine held from terminal, vs an unfired fall of equal frame count | % slower, **and** net px |
| 12 | Stomp bounce | contact frame → apex | px **and** `rise / H` |

Item 10 names the module deliberately: the original's gun modules do not share a recoil, so a figure
captured without recording which module was equipped is not a measurement of anything.

Item 11 must record whether the magazine produces a net **climb** or only a slowed descent. DEEP
DROP's own behaviour differs enormously by starting state — from terminal, a magazine slows the fall
14%; from rest, the same magazine is a net climb of 45.8px. So capture it **from terminal**, and note
separately whether a climb from rest is possible at all.

**Upgrade behaviour**

| # | Quantity | Method | Report as |
|---|---|---|---|
| 17 | HEART BALLOON fall multiplier | see below | `balloon px/frame ÷ normal px/frame` |
| 18 | HEART BALLOON pop / reset timing | see below | frames ÷ 60 |

*17.* Measure **terminal only**, never the acceleration phase — mixing the ramp in contaminates the
ratio, and the ramp is where the difference is least stable.

- Without the balloon: after terminal is reached, y displacement over **≥10 consecutive frames**.
- With the balloon: the same, under the same conditions.
- Report the quotient. **Minimum 3 samples** per condition.

*18.* Where the footage allows, additionally record:
- the frame the balloon pops;
- how long after the pop fall speed returns to normal (frames ÷ 60) — instantaneous, or a ramp;
- when it respawns on the next Level (at entry, or on some trigger).

These three are what decide whether the balloon is a persistent modifier or a consumable, which is a
structural question the current `fallMultiplier` cannot answer either way.

**Hazard timing**

| # | Quantity | Method | Report as |
|---|---|---|---|
| 19 | Catacombs spike — trigger → warning | frames B − A ÷ 60 | seconds |
| 20 | Catacombs spike — active / retract / reset | frames C→D, D→E ÷ 60 | seconds |

Capture these five frame indices per individual, **minimum 3 individuals**:

```
A  landing / trigger satisfied
B  warning visual begins
C  spike hitbox becomes active
D  spike begins to retract
E  fully inactive / reset, able to trigger again
```

Derived: `trigger → warning` = B−A · `warning duration` = C−B · `active duration` = D−C ·
`cooldown / reset` = E−D.

> **The frame the player takes damage is NOT frame C.** Damage is where the player happened to be;
> C is where the trap changed state. Conflating them measures the player's position and calls it a
> hazard constant. Read C from the spike's own animation, with no player contact if possible.

Where the footage allows, record any divergence between the **warning visual** and the **hitbox
becoming active** — if the hitbox leads the visual even by a frame, the telegraph is a lie, and that
is a design fact worth more than the duration itself.

**Terrain**

| # | Quantity | Method | Report as |
|---|---|---|---|
| 15 | Row spacing | vertical distance between consecutive landable rows | px **and** `gap / H` (`/ B`) |
| 16 | Ledge width | ledge width | px **and** `width / S` (`/ B`) |
| 21 | Wall foothold geometry | see below | ratios below |
| 22 | Wall-contact player physics | see below | see below |

**21 — WALL FOOTHOLD / TERRAIN GEOMETRY.**

*Correction to the earlier framing.* Section C of this document treated "壁に取っ掛かりが欲しい" as a
player-physics question, and section E's `wallStub` piece was proposed as the answer without anything
to measure it against. That was a misreading. The request is primarily about **terrain geometry** —
whether the original's shaft walls carry small landable structures at all — and it is measured here
as terrain. Item 22 below is the player-physics question, kept strictly separate because the two can
be true independently: a wall can carry footholds with no special contact physics, or have slide
physics with no footholds.

Observe and record:

- whether wall-attached footholds **exist at all** — this is the first question, and "no" is a result;
- `foothold width / W`;
- `foothold height / H`;
- `projection from the wall / W`;
- `vertical spacing between footholds / H`;
- whether they are **landable** (the player can come to rest) or only brushed past;
- whether they are usable as a temporary platform;
- whether footage shows them used to **set up a wall jump**;
- whether footage shows them used as an **emergency landing** to avoid a hazard below.

Record absolute px alongside every ratio. Where `B` was established, add `/ B` — if footholds turn
out to be one block wide, that is the most directly reproducible result this protocol can produce.

**22 — WALL-CONTACT PLAYER PHYSICS.** A separate measurement from 21. Falling while held against a
wall, determine which of these occurs:

- **wall slide** — fall speed is reduced while in contact;
- **wall grip** — the fall stops entirely while in contact;
- **neither** — contact changes nothing and only the wall jump exists.

If and only if a slide is observed, measure `wall-contact fall px/frame ÷ normal terminal px/frame`.
If a grip is observed, measure how many frames it can be held. If neither occurs, record exactly:

```
NO WALL SLIDE OBSERVED
```

Do not infer a value from how the movement looks. DEEP DROP is currently in the third category, and
that is a fact about DEEP DROP, not evidence about the original.

### Conversion

DEEP DROP `H = 30`, `W = 22`, `S = 394`. A ratio `r` against `H` becomes `r × 30`. Velocities in
px/frame convert ×60 to px/s. Acceleration in px/frame² converts ×3600 to px/s².

Timings (items 18, 19, 20) are **already in seconds and do not convert** — they transfer directly.
This is why hazard and upgrade timing are the highest-value items in this protocol: they are the only
measurements that need no scale assumption at all, and two of them replace values currently carrying
`DESIGN TUNING — ORIGINAL VALUE NOT VERIFIED` (`heartBalloon.fallMultiplier` 0.82 and the Catacombs
spike warning 0.65s).

### Rules

- **At least 5 independent clips** per quantity for items 1–16; report **median and spread**. A
  quantity whose spread exceeds 15% is not measured — it is contaminated by an upgrade or a
  different World.
- Items 17 and 19/20 have their own stated minimums (**3 samples** / **3 individuals**), because each
  sample is a whole staged situation rather than a frame range inside ordinary play.
- Items 11 and 14 decide more about feel than any other, and are the two most easily eyeballed wrong.
  They get **10 clips**.
- Record which gun module is equipped in any clip used for items 10 or 11, and which upgrades are
  held in **every** clip. An unrecorded loadout invalidates the sample.
- Any quantity not obtained this way stays `MEASUREMENT REQUIRED` in the data files. **No value is
  invented because it looks plausible.** `JUMP.impulse` and `WALL_JUMP.*` carry that label today and
  keep it until this protocol replaces them.
- **A negative result is a result.** "No foothold geometry", `NO WALL SLIDE OBSERVED`, "no divergence
  between warning and hitbox" are all findings and are recorded as such. An unmeasurable quantity is
  recorded as unmeasurable, never filled in.
- Items 15, 16 and 21 are terrain rather than physics and feed section F — but they are captured in
  the same pass, because a row gap is only meaningful next to the jump that has to clear it, and a
  foothold only means something next to the wall jump that reaches it.

---

## E. TERRAIN GRAMMAR SPECIFICATION

### The problem with what exists

`StageGenerator.chunk()` emits **exactly one `RoutePlatform` per level**: `nextY += gap + rnd()*28`,
an x chosen from candidates satisfying `canReachPlatform`, `rowsSinceWall >= 3` forcing alternating
wall contact. Everything else — spikes, breakable, limbo, doodads — is an *attribute painted onto
that one piece*. Gate rows are the sole exception, and they are a special case in the code rather
than a grammar production.

So the shaft is a **ladder**: one ledge, one gap, one ledge. There is no vocabulary in which two
pieces at different heights are one idea. Measured `pieces/level` is 1.19–1.50, and most of what
exceeds 1.0 is gate blocks. That is the structural reason the terrain does not read like the
original's, and it is not fixable by retuning the existing numbers.

### The grammar

Three levels: **SECTION → COMPOSITION → PIECE.** A COMPOSITION is the new middle term — a small
group of pieces that is authored and reasoned about as one unit, occupying a vertical band and
guaranteeing its own internal legality.

**PIECE** — the terminal vocabulary. Each is a placement rule, not a new collision type; all of them
emit ordinary `Platform` entries so nothing downstream changes.

| Piece | Shape | Role |
|---|---|---|
| `ledge` | free-floating, `width` of shaft span | the ordinary landing |
| `wallShelf` | flush to one wall | landing that also sets up a wall interaction |
| `wallStub` | **narrow**, flush to a wall | *foothold* — the "取っ掛かり". **Dimensions pending measurement 21**; not authored until the original is known to have footholds at all |
| `breakCluster` | 2–5 gate blocks, contiguous | obstruction that costs CHARGE |
| `partial` | spans part of the shaft, deliberately leaving a lane | funnels without blocking |
| `stack` | 2–3 pieces within one jump height of each other | vertical texture; the thing the ladder cannot express |
| `gap` | no piece | the fall |
| `narrows` | two opposing pieces leaving a lane < 3 player-widths | pressure without a hazard |
| `hazardShelf` | a `ledge` or `wallShelf` carrying `spikePlatform` | the trap floor |
| `doodadAnchor` | wall fixture, non-landing | CHARGE reload point |

**COMPOSITION** — the productions. Each names its pieces, its vertical extent, and its exit
condition. This list is the proposal; it is not measured against the original yet and every
composition is subject to ratios 15/16 from section D.

| Composition | Produces | Extent | Guarantees |
|---|---|---|---|
| `plain` | 1 `ledge` | 1 level | the current behaviour, kept as a production |
| `shelfPair` | `wallShelf` L + `wallShelf` R, offset vertically | 2 levels | wall contact both sides |
| `staircase` | 2–3 `stack` pieces descending one way | 2–3 levels | each reachable from the last by fall + steer |
| `foothold` | `wallStub` + `ledge` below and offset | 2 levels | the wall-jump setup |
| `gauntlet` | `hazardShelf` + a `ledge` escape within jump reach | 2 levels | **an escape exists** (see H) |
| `gateway` | `breakCluster` spanning, `gap` above | 1 level | crossable by CHARGE **or** by a lane |
| `funnel` | `partial` + `partial` opposed | 1–2 levels | a lane ≥ 2 player-widths |
| `chasm` | `gap` of 2–3 row heights | 2–3 levels | a landing at the bottom |
| `chamberMouth` | `wallShelf` + safe-zone cut | 1 level | existing safe-zone rules, unchanged |

**SECTION** is then a weighted sequence of compositions, with per-AREA weights, run-length limits
(no composition three times consecutively), and the existing depth-based rules — grace depth, gate
row count, chamber placement — expressed as constraints on the sequence rather than as branches
inside the row loop.

---

## F. AREA 1–4 GRAMMAR SPECIFICATION

Current per-AREA tuning, measured:

| AREA | Name | Sections × length | Ledge width | Gap | enemyChance | flyChance | Density |
|---|---|---|---|---|---|---|---|
| 1 | SURFACE RUINS | 3 × 240m | 176→132 | 232→244 | .30→.52 | .08→.30 | 9.2→8.3 |
| 2 | CATACOMB RUINS | 3 × 300m | 150→126 | 236→248 | .34→.56 | .26→.38 | 9.0→8.7 |
| 3 | SUNKEN RUINS | 3 × 340m | 150→126 | 236→248 | .34→.56 | .26→.38 | 9.1→8.7 |
| 4 | COLLAPSED REALM | 3 × 380m | 92→76 | 232→244 | .30→.58 | .26→.50 | **0.8→0.3** |

Two findings that shape the rewrite:

**AREA 2 and AREA 3 are the same AREA.** Identical widths, identical gaps, identical enemy and fly
chances across all three SECTIONs. They differ only in theme, enemy roster and the oxygen system.
Structurally they are one area shipped twice, which is why the middle of a run reads as long.

**AREA 4 has essentially no floor.** 1–3 route ledges per SECTION against 34–36 hazard pieces. It is
not a harder version of the shaft; it is a different game mode — a hazard corridor. That may be a
legitimate original design, but it must be a deliberate decision rather than an emergent one, and it
is the reason AREA 4 cannot be validated by the same reachability rules as 1–3.

### Proposed composition weights

Provisional; pending ratios 15/16. The intent per AREA is stated so the weights can be argued about
in terms of roles rather than numbers.

| Composition | A1 | A2 | A3 | A4 | Intent |
|---|---|---|---|---|---|
| `plain` | .38 | .26 | .22 | .10 | |
| `shelfPair` | .14 | .14 | .12 | .08 | teaches the walls exist |
| `staircase` | .12 | .16 | .16 | .10 | |
| `foothold` | .10 | .14 | .14 | .18 | the missing "取っ掛かり" |
| `gauntlet` | .02 | .16 | .10 | .18 | A2 is the trap AREA |
| `gateway` | .10 | .06 | .06 | .04 | |
| `funnel` | .06 | .04 | .10 | .16 | A3 = water pressure, A4 = collapse |
| `chasm` | .08 | .04 | .10 | .16 | |

**AREA 1** teaches: fall, land, shoot, stomp, and that walls can be touched. No traps until 1-3.
**AREA 2** owns the trap floor; `gauntlet` is its signature and the 0.65s warning is its contract.
**AREA 3** must stop being AREA 2. Its distinct identity is oxygen and verticality — `funnel` and
`chasm` up, `gauntlet` down, and a widened gap range that its containers pay for.
**AREA 4** is the hazard corridor, and gets a **floor budget**: a minimum route-ledge density so the
player can stand somewhere, which at 0.3/100m it currently does not have.

---

## G. ENEMY ARCHETYPE SPECIFICATION

### The gap, stated plainly

Every enemy in the game is driven by **one line** (`GameModel.ts:664`):

```ts
e.x = e.originX + Math.sin(this.worldElapsed * enemyType(e.kind).swaySpeed + e.phase) * e.range;
```

21 enemy kinds. One horizontal sinusoid, differing only in speed multiplier and amplitude. Nothing
moves vertically, nothing reacts to the player, nothing fires. The roster is *structurally* rich —
`shootable` and `stompable` are independent and honoured, threat tiers and spawn slots work — but
every enemy **behaves** identically. This is the single largest clone-fidelity gap in the project,
larger than any terrain issue, because it is what the player is actually interacting with.

### Archetypes

A `behaviour` field on `EnemyType`, defaulting to `sway` so the whole roster keeps working while
archetypes land one at a time.

| Archetype | Motion | Answers to | Notes |
|---|---|---|---|
| `sway` | current sinusoid | stomp / shoot | the default; stays for ambient enemies |
| `guard` | stationary, faces the player | stomp / shoot | occupies a ledge; the reason to route around |
| `patrol` | walks its ledge, **turns at the edges** | stomp / shoot | needs ledge extent, which `sway` ignores |
| `bob` | vertical oscillation in open shaft | shoot | first vertical motion in the game |
| `chase` | accelerates toward the player, capped **below** fall speed | shoot | must never outrun a fall |
| `charge` | holds, then a **telegraphed** horizontal dash | dodge / shoot | telegraph is mandatory, as with every hazard |
| `shooter` | stationary, fires on an interval with a wind-up | shoot first | needs an enemy-projectile path, which does not exist |
| `clinger` | attached to a wall, strikes into the shaft | shoot | makes the walls dangerous, complementing `wallStub` |
| `pursuer` | flying, slow homing, ignores terrain | shoot | pressure that follows you down |
| `bruiser` | `patrol`, unstompable, multi-HP | shoot only | already expressible: `tank`, `armorGuard` |

### Rules

- **Nothing outruns a fall.** Every velocity caps below terminal 520px/s. An enemy the player cannot
  escape downward breaks the core promise that falling is always available.
- **Every damaging action is telegraphed**, with the wind-up carrying no hitbox — the same contract
  as `SPIKE_PLATFORM_RULES` and NIMUSHI's attacks.
- **Behaviour is data.** `behaviour` sits on `EnemyType` beside `stompable`; no gameplay code
  branches on `kind`, exactly as today.
- `shooter` needs an enemy-projectile list. That is new surface area and is sequenced **last**, after
  the archetypes that reuse the existing collision paths.
- NIMUSHI's `nimushiClone` / `nimushiShade` are **out of scope** and keep `sway`.

---

## H. REACHABILITY SPECIFICATION

The two things the current `canReachPlatform` conflates and which must be separated:

> **SOFT-LOCK PREVENTION** is a correctness property. It is non-negotiable and is asserted.
> **DIFFICULTY SOFTENING** is a design choice. It is tunable, per-AREA, and must never be introduced
> to make a bot survive.

### Soft-lock prevention — the invariant

**From any reachable resting position, at least one legal route to the SECTION exit must exist.**

A resting position is anywhere the player can be stationary: on a route ledge, on a trap ledge, on a
chamber floor, or in a safe zone. Legal moves, with the measured budgets from section C:

| Move | Budget | Source |
|---|---|---|
| fall | unlimited down; 155px to reach terminal | measured |
| horizontal steer while falling | **180px/s, 100% of ground** | measured |
| ground jump | **59.13px** rise, **130.5px** reach, 0.72s arc | measured |
| wall jump | **48.75px** rise, **231.7px** horizontal | measured |
| recoil | −190px/s per shot, ≤ CHARGE remaining | measured |

Route search is a forward BFS over compositions, not over individual pieces — this is why the
composition is the right unit: each composition already guarantees its own internal legality, so the
search only has to answer "can I get from the bottom of composition *n* to a landing in *n+1*".

**Recoil is excluded from the invariant.** A route that requires spending CHARGE is not a guaranteed
route, because the player may arrive with none. Recoil may *widen* options; it may never be the only
way through. The same applies to upgrades: the invariant is proven for a run holding nothing.

**The descent asymmetry is load-bearing.** A 59px jump against a 245px median gap means the player
can never climb back a row. So the search is a DAG — no cycles, no backtracking — and a composition
that traps the player is a permanent trap, not a detour. This is why the invariant must be asserted
per composition boundary rather than sampled.

### Difficulty softening — separate, tunable

Per-AREA, and each one is a knob that may be turned to zero:
grace depth at SECTION start · max consecutive hazard compositions · minimum route-ledge density
(the AREA 4 floor budget) · trap-ledge run limits · guaranteed CHARGE reload interval.

**Bot survival is not an acceptance criterion for any of these.** A bot dying in 2-2 is evidence
about the bot until the same death is reproduced by a human or proven to violate the invariant above.

### Acceptance

For every AREA × SECTION × 200 seeds: the invariant holds; and the generator is deterministic for a
given seed — identical piece lists on repeated generation, asserted, which also keeps the section-A
diagnostic honest.

---

## I. PROPOSED StageGenerator ARCHITECTURE

Not implemented. Current `chunk()` is one function doing placement, attribute painting, enemy
spawning, container placement and reachability checking in a single pass over rows.

```
AreaPlan            data. Composition weights, run limits, difficulty knobs. No logic.
   |
CompositionPicker   weights + run-length limits + depth rules -> the next composition id.
   |                Deterministic from the seeded RNG. Knows nothing about pixels.
   |
CompositionBuilder  one builder per composition. Emits PIECES within a vertical band and
   |                guarantees its OWN internal legality. The only place geometry is decided.
   |
PieceEmitter        piece -> Platform entries. The single place `Platform` objects are created,
   |                so ids, widths and wall flushing are consistent by construction.
   |
ReachabilityGate    asserts the section-H invariant across each composition boundary.
   |                In development it THROWS; in production it re-rolls the composition.
   |
Populator           enemies, containers, doodads, pickups placed against FINISHED geometry
                    rather than interleaved with it.
```

Why this shape:

- **Geometry before population.** Today an enemy's `minPlatformWidth` is checked while the row is
  being built. Separating them means a composition can be validated on its own and the populator can
  see the whole band — which is what `patrol` (needs ledge extent) and `clinger` (needs a wall)
  require, and what the current interleaved pass cannot provide.
- **The reachability gate is one object**, so the invariant is enforced in exactly one place and can
  be exercised directly by tests without generating a whole section.
- **Determinism is structural.** One seeded RNG threaded through, consumed in a fixed order.
- **`Platform` does not change.** Collision, rendering, the safe-zone system, the break system, the
  gravity abstraction and NIMUSHI all consume the same shape they do now.

Explicitly unchanged: `SafeZone` placement, `BREAK_BLOCK_RULES`, `SPIKE_PLATFORM_RULES`, the ABYSS
generator, and every boss path.

---

## J. MIGRATION AND TEST PLAN

Preconditions — **none of the below starts until both hold**:
1. Section D executed and `JUMP.impulse`, `WALL_JUMP.*`, gravity, terminal, air control and recoil
   either confirmed or replaced by measured values. **Terrain is not written against unlocked physics.**
2. The section-H invariant implemented and passing against the *current* generator. A new generator
   validated by a brand-new checker proves nothing.

| Step | Work | Gate |
|---|---|---|
| 0 | Physics lock (D) | measured values landed; full suite green; a human play session confirms feel |
| 1 | `ReachabilityGate` + invariant tests against today's generator | 200 seeds × 12 sections pass |
| 2 | `PieceEmitter`; existing generator re-expressed through it | **byte-identical output for every seed** |
| 3 | `plain` composition only, via the new pipeline | identical output again — the pipeline is proven a no-op |
| 4 | Compositions added **one at a time**, each behind a per-AREA weight starting at 0 | invariant holds; density stays 8.3–9.2/100m |
| 5 | Weights moved to section F values, AREA by AREA | human play session per AREA |
| 6 | AREA 3 differentiated from AREA 2 | the two no longer share a tuning row |
| 7 | AREA 4 floor budget | route-ledge density ≥ the agreed minimum |
| 8 | Enemy archetypes (G), one per step, `sway` remaining the default | no archetype exceeds fall speed |

Step 2 is the load-bearing one: if the re-expressed generator does not reproduce current output
exactly, the refactor is wrong and nothing built on it can be trusted.

**Test plan.**
- *Kept and never weakened*: all 674 current tests. The 78 NIMUSHI tests are the regression gate for
  the protected boss work and must stay green at every step.
- *New*: invariant across 200 seeds × 12 sections; determinism per seed; density bounds per AREA;
  composition run-length limits; every archetype's speed cap; `gauntlet` escape existence.
- *Measurement, not assertion*: `tests/measure/**` — terrain census, level spacing, physics harness.
  These print and are excluded from the acceptance run.
- *Bot runs*: diagnostic only. A bot death is a lead, never a reason to soften the product.

**Rollback.** Each step is its own commit on `feature/downwell-core-fidelity`. Steps 2–3 are provably
reversible (identical output). From step 4, rollback is per-composition by returning its weight to 0,
which is why compositions are introduced weighted rather than wired in.

**Out of scope throughout:** NIMUSHI, THE ABYSS, the Final Shop, the seal, gravity inversion, the
tapioca attacks, FINAL RAGE, the pressure boundary, boss camera, BOSS TIME. Zero regression required.

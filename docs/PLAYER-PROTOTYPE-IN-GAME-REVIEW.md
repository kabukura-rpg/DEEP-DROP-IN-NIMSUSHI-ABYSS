# PLAYER VISUAL PROTOTYPE — temporary in-game review

Status: PLAYER VISUAL PROTOTYPE WIRED FOR HUMAN REVIEW. Not final asset adoption.

## Baseline and scope

- Start HEAD: 547997b, feature/downwell-core-fidelity.
- main at start: 6e3d1af06e633a8e33cf1d7eed4fa592268fa27c. No merge or checkout.
- Existing uncommitted Boss movement/camera edits were present before this task. They were committed separately as d58a190 during this task; this visual commit builds on that commit and does not contain those gameplay edits.
- The previous static-comparison output directory also had pending changes; those are not part of this integration commit.
- Only GameScene rendering/event observation, dev visual helpers, tests, documentation and review evidence are changed.
- No changes to GameModel, collisions, physics constants, player control, recoil, stomp, bounce, reload, camera or Boss systems.
- No generated asset changed. No new PLAYER frames or FX. No NIMUSHI images generated.

## Human review

Run the development server and open /. Prototype mode is enabled by default in dev. Use the existing BOSS TEST button or __bossTest() for the arena.

~~~js
__playerArt('prototype')
__playerArt('legacy')
__playerArt('prototype', 1) // default; 48x48 texture at 1x
__playerArt('prototype', 2) // integer-size comparison, also accepts 3
__playerArt()               // status, pose, position, visibility, facing
~~~

Switching also works while paused. The helper never writes to the game model. It is absent from production; production retains legacy drawing and loads no prototype PNGs. Assets live outside public/ and are not copied into dist.

## Mapping

| Existing situation | Temporary visual |
|---|---|
| Normal Run airborne with vy >= 0 | normal_fall |
| NIMUSHI arena, airborne, vy <= 0 | boss_ascend |
| Same arena motion within 0.14 seconds of an actual shot | boss_brake |
| Grounded / idle / run | legacy |
| Ground jump, wall kick, normal upward rebound | legacy |
| Boss downward rebound (vy > 0) | legacy |
| Dead / clear / non-play state, unavailable texture | legacy |
| Hurt / invulnerability | same pose, original blink cadence |
| boss_descend_thrust | never loaded or mapped; retained on disk for reference |

Holding fire with no shot does not activate BRAKE. The final successful round still does. The visual timer uses simulation elapsed time and therefore holds on pause. Stomp, landing, gravity reversal and run restart clear the short shot pose.

## Scale and body registration

All source images remain 48x48. Display defaults to 1x, nearest-neighbor filtering, no nonuniform stretch. Horizontal flip affects rendering only. Vertical flip is never used.

Texture origin remains (0.5,0.5). The following measured body anchors exclude decorative hair/ears/tail. Draw offsets bring the body anchor onto the rounded existing physics center (player.x, player.y - cameraY):

| Pose | Source body anchor | Default draw offset |
|---|---|---|
| normal_fall | (24,32) | (0,-8) |
| boss_ascend | (24,23) | (0,+1) |
| boss_brake | (24,28) | (0,-4) |

The face/eye landmark stays at body y-2 across the poses. The soles are at body y+12, +12 and +10: a 2px crouch difference, not a change of pivot. Flipping mirrors around the registered body. The same existing shake offset is applied to world, body and foreground.

The unused DESCEND_THRUST file keeps its original centered-cell metadata; there is no runtime registration or animation transition for that pose.

The dev renderer orders world -> body -> existing particles/damage highlights/heat/flash/scanlines. Existing HUD text and invulnerability blink remain in place.

## Browser verification

See output/player-art-in-game-review/index.html, browser-results.json and capture.mjs.

- Real CDP keyboard/mouse input, no gameplay assignments. Normal fall is reached by walking off the initial ledge.
- NIMUSHI entered via the existing development shortcut at full Boss HP. Natural ascent is observed without firing. Space then fires a real projectile.
- Natural ascent sample: vy=-262.5; after firing: vy=-102.5, CHARGE 8 -> 7, projectile vy=-850, five existing shot particles.
- A/B switching and scale switching leave serialized model state identical.
- Left input sets visual flipX while gravity and bullet velocity remain upward.
- PAUSE freezes model time and the BRAKE pose.
- Browser reports no runtime exception. Network requests only the three connected PNGs; DESCEND_THRUST is not requested.
- World/body/effects display indices are 0/1/2.
- Captures: normal-fall.png, nimushi-ascend.png, nimushi-brake.png, normal-legacy.png, nimushi-legacy.png, legacy-prototype-comparison.png.

Readability: warm face and white tail markings stand out in the dark shaft. Default size is comparable in height to the legacy player, with a narrower airborne body. BRAKE is wider and shorter as intended. Boots/nozzle detail is still small; the Boss art's boot orientation and the unchanged upward gameplay muzzle remain a human-review concern. Source pixels, projectile origin and existing FX were deliberately not altered to conceal this mismatch.

## Validation

- Before integration: 804/804 tests passed.
- After integration: 811/811 tests passed, including seven new visual mapping/read-only/registration tests.
- tsc --noEmit: passed.
- vite build: passed; existing Phaser chunk-size warning remains.
- dist contains neither prototype asset paths nor __playerArt, and no prototype PNGs.
- Original sprite bytes preserved; gameplay/collision changes in this commit: zero.

## NIMUSHI

NIMUSHI BOSS ART SPEC v1 APPROVED.
NIMUSHI ASSET GENERATION NOT STARTED.

The approved spec is recorded in docs/NIMUSHI-BOSS-ART-SPEC-v1.md. Next art step, after PLAYER review, is CHARACTER LOCK PASS with one IDLE reference sprite. No A/B/C sheet production in this task.

# AIR BUBBLES VISUAL DESIGN V1 — Runtime Integration

**Candidate A — Refined Original（Human Review承認済み）を runtime に統合。描画のみ変更。**

## 1. Baseline と作業環境

| 項目 | 値 |
|---|---|
| 公開 baseline | `5969f37`（Pages run 42392304299、44/44一致）— 変更なし・push なし・deploy なし |
| 作業 worktree | `~/Worktrees/deep-drop-air-bubbles-runtime`、branch `feature/air-bubbles-runtime-v1`（`5969f37` から新規作成） |
| main checkout | `~/Desktop/落ちゲー` `feature/downwell-core-fidelity` @ `080d022`（dirty）— 未変更。`080d022` は `5969f37` の子孫ではないため作業元にしない |
| 既存 Human Review サーバ | `start.mjs`（PID 53619、:5397）— 停止していない |
| Integration source | `output/air-bubbles-visual-design-v1/harness/air-art.js`（sha256 `2d78111b…6ee3a`）。設計資料ではなく、この承認済み実装の描画命令を基準にした |

## 2. AIR BUBBLES の runtime 経路（`5969f37` で照合）

| 処理 | ファイル / 関数 | 確認値 |
|---|---|---|
| 生成 | `GameModel.breakContainer` (`src/systems/GameModel.ts:1852`) | `3 + round(random × 2)` = 3〜5個、容器中心に同座標、`containerBreak` 1件 |
| 定数 | `AIR_CONTAINER_RULES` (`src/data/structures.ts:45`) | bubblesMin 3 / Max 5、recovery 5、riseSpeed 96、riseSpread 54、riseAccel 260、bubbleLife **4.2**、collectArm 0.08、debrisTime 0.35 |
| 更新 | `GameModel.tickBubbles` (`GameModel.ts:1872`) | 1/120 s 固定 step、vx×.985、vy→−96、X を壁間に clamp |
| 回収 | 同上 | arm 0 後、酸素有効かつ `|dx|<24, |dy|<28`、`oxygen.add(5)`、満タンは取らない |
| 消滅 | 同上 `filter` | taken / life≤0 / カメラ後端 90px |
| リセット | `GameModel.ts:1715, 2177, 2400` | SECTION 開始・BOSS arena・ABYSS 遷移で `bubbles = []` |
| 停止 | `timeFrozen` (`GameModel.ts:219`) | TIMEOUT / SAFE ZONE / SIDE CAVE 内で AIR tick 停止 |
| 描画 | `GameScene.draw()` の AIR ループ (`src/scenes/GameScene.ts:936`) | `worldFrontAir` Graphics（毎フレーム `clear().setPosition(g.x, g.y)`）、cull `by ∈ [−40, 850]`、fade `.92` / 寿命1秒未満 `.35+|sin(elapsed·18)|·.5` |
| レイヤー | `create()` (`GameScene.ts:303–312`) | containers(airLayer) → **worldFrontAir** → coinLayer → underAbyss(TIMEOUT) |
| Backend | `src/main.ts` Phaser `AUTO`（WebGL / Canvas）、pixelArt on、450×800 FIT | 経路共通（Graphics の command buffer） |

## 3. 変更ファイル

| ファイル | 変更 |
|---|---|
| `src/render/airBubbleArt.ts`（新規 68行） | Candidate A の移植。`AIR_BUBBLE_ART`（ring `#9fe8f5` / glint `#f0ffff` / glintShare .9）、`AIR_BUBBLE_GEOMETRY`（ring 12 / glint 2 rect、モジュール定数）、`drawAirBubbleArt(g, cx, cy, fade)` |
| `src/scenes/GameScene.ts` | import 1行 + AIR ループ内の 2行（`strokeCircle` r9 と 3×3 白 rect）→ `drawAirBubbleArt(this.graphics, bubble.x, by, fade)` 1行 + コメント1行。ループ・cull・fade・Graphics・順序は不変 |
| `tests/airBubbleArt.test.ts`（新規 21件） | 形状・Candidate A一致・格子・scene ループ・不変性・model trace |
| `tests/airBubbleArtRestore.ts`（新規） | `5969f37` 復元層（2 hunk） |
| `tests/airBubbleTrace.ts`（新規） | model-only trace（goldens は `5969f37` の git archive で生成） |
| `tests/timeoutArtRestore.ts` | 復元連鎖の先頭に `withoutAirBubbleArt` を追加 |
| 既存 test 8ファイル | 既存 byte-pin の列挙から新規ファイルを除外（`isAirBubbleArtFile`）。既存 digest・件数は不変 |

`git diff --stat`（tracked）: 10 files, +24 −10。モデル・データ・システム・音声・UI・TIMEOUT・他アートのソースは無変更（テストで92ファイル digest 一致）。

## 4. 描画変更の詳細（Candidate A との一致）

```
...rrrr...   r = ring  #9fe8f5 × fade
..r....r..   h = glint #f0ffff × .9·fade
.r.h....r.   1文字 = 2×2 native px、全体 20×20、中央 8×8 透明
r.h......r
r........r   (×3)
.r......r.
..r....r..
...rrrr...
```

| 項目 | Current (`5969f37`) | Integrated A |
|---|---|---|
| 形 | `strokeCircle(x, y, 9)` 線幅2（外径20） + 3×3 白 rect `(x−4, y−5)` | 20×20 段付き輪 12 rect + 2セル斜め glint 2 rect |
| 色 / alpha | `#9fe8f5`×fade、白×.8·fade | `#9fe8f5`×fade、`#f0ffff`×.9·fade |
| 座標 | 輪は小数、rect は丸め | 中心のみ `round(c + g.x) − g.x`（Graphics の小数移動込みで画面 1px に揃える、TIMEOUT と同方式） |
| 命令 / 泡 | lineStyle+strokeCircle + fillStyle+fillRect（22 slot） | 2 fillStyle + 14 fillRect（76 slot） |
| アニメーション | 既存 fade / 明滅のみ | 同一（式は呼び出し側のまま）。粒子・拡縮・残像・発光の追加なし |

一致確認:
- **描画命令**: `drawAirBubbleArt(g, 0, 0, 1)` の命令列が承認済み `air-art.js` の `drawAirReview(g, 0, 0, 1, 'A')` と完全一致（JSON sha256 `dad3fb0d…97e4`、test で固定）。
- **ビルド**: 本ハーネスの `build-review.mjs codex` の出力が、稼働中の Human Review サーバ（:5397）配信物と `index.html`・`index-*.js` とも byte 一致。
- **画面**: Visual Regression で Integrated A と Human Review の variant A が全 native framebuffer・全ページ screenshot で 0px 差（`AIR_BUBBLES_RUNTIME_VALIDATION_V1.md` §4）。

## 5. 既存ロジックの不変性

| 確認 | 方法 | 結果 |
|---|---|---|
| GameScene 以外の全92ソース | `5969f37` の `git show` から作った digest と比較 | 一致 |
| GameScene | 2 hunk を戻すと `5969f37` と byte 一致（sha256 `572a407c…1cdc`） | 一致 |
| AIR ループ | ループ本体を `5969f37` 版と同じ stand-in scene で実行し比較 | cull・fade・順序・泡数一致、model を変更しない |
| 定数 | `AIR_CONTAINER_RULES` | 3〜5個 / 4.2 s / 5 s / .08 s / 96 px/s 等不変 |
| 挙動 | `tests/airBubbleTrace.ts` 7 run（AREA3 1-1/1-2/1-3、満タン、SECTION×3、TIMEOUT所持、AREA1）を毎 step hash | `5969f37` archive の golden と digest・泡数・破壊数・酸素 event・回復量・SECTION 全一致 |
| 画像 / テクスチャ / GameObject | PNG 165、`this.add.graphics()` 13、`this.add.` / `this.textures.` 数 | 不変 |
| production dist | prod-base（公開と同一 byte）↔ prod-cand | 差分は `index.html` と `assets/index-*.js` の2ファイルのみ（44ファイル中） |

更新処理・生成条件・速度・判定・回復量・寿命・SECTION・時間停止には一切手を入れていない。ゲームロジック変更が必要になる場面はなかった。

## 6. TIMEOUT への影響

- `src/render/timeoutArt.ts` と TIMEOUT ループは無変更（digest 一致、`tests/timeoutArt.test.ts` 22件 PASS、TIMEOUT trace 13 run の golden 一致）。半径96・脈動式・停止/再開・SECTION 消去は不変。
- 描画順は不変: AIR（`worldFrontAir`）が TIMEOUT（`underAbyss`、coins の後）より手前。重なり時は AIR の輪が TIMEOUT の面と縁の上に描かれる。
- runtime smoke で TIMEOUT 生成・r96・停止/再開・脈動・AIR 重なりを4構成で確認（Validation Report §3）。

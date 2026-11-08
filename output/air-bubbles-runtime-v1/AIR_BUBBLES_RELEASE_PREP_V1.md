# AIR BUBBLES VISUAL DESIGN V1 — Release Preparation

**Final Human Review: CONDITIONAL GO（2026-11-09）。Candidate A の runtime 統合を承認。Canvas の JS 割当増（+48〜70 KiB/frame）は許容し PERFORMANCE DEBT として記録。ステータス: READY FOR DEPLOY REVIEW。未push・未merge・未deploy。公開 baseline `5969f37` 維持。**

## 1. 変更内容の最終確認（`git diff 5969f37`）

| 種別 | ファイル | 内容 |
|---|---|---|
| 追加 | `src/render/airBubbleArt.ts` | Candidate A の描画（輪 12 rect・glint 2 rect、中心の画素整列） |
| 変更 | `src/scenes/GameScene.ts` | import 1行追加、AIR ループの stroke + glint 2行 → `drawAirBubbleArt` 1行（+3 −2） |
| 追加 | `tests/airBubbleArt.test.ts`（21件）、`tests/airBubbleArtRestore.ts`、`tests/airBubbleTrace.ts` | 描画命令 pin、`5969f37` 復元、model trace golden |
| 変更 | `tests/timeoutArtRestore.ts` | 復元連鎖の先頭に `withoutAirBubbleArt` |
| 変更 | 既存8テスト（balloonArt / corpseArt / inputCancel / jetpackArt / jetpackBehavior / tapiocaProjectileArt / timeoutArt / titleAudioGate） | import 1行＋列挙フィルタに `!isAirBubbleArtFile(k)` 追加のみ |
| 追加 | `output/air-bubbles-runtime-v1/` | 報告書・harness・証跡（§5） |

## 2. ゲームロジック・TIMEOUT 不変の再確認

- `src/` の差分は上記2ファイルのみ。GameScene の差分は import と AIR 描画2行のみで、AIR の cull 条件・`fade` 式・ループ・描画順は同一行のまま。
- `src/systems/**`・`src/data/**`・`src/render/timeoutArt.ts` を含む他の全 92 source は `5969f37` と byte 一致（`tests/airBubbleArt.test.ts` の digest `ffc7e302…7c671c`）。
- GameScene から AIR hunk を戻すと `5969f37` の GameScene と sha256 一致（`572a407c…1cdc`）。
- TIMEOUT: 半径96・脈動・停止/再開・描画順は無変更（timeoutArt 22件、TIMEOUT trace golden 一致、smoke 4構成）。TIMEOUT freeze は維持。

## 3. 既存8テストの列挙除外の妥当性

- `isAirBubbleArtFile` が一致するのは `../src/render/airBubbleArt.ts` の1件のみ（新規テストと timeoutArt テストで `toEqual([...])` により固定）。
- 各テストの期待値（ファイル数・digest）は未変更。除外は「その時点に存在しなかった新規ファイル」を列挙から外すだけで、既存ファイルの検査範囲は同じ。GameScene は復元連鎖（`withoutAirBubbleArt` → 既存の restore）を通して各テストの基準 commit と byte 比較を継続。
- 新規ファイルの中身は `tests/airBubbleArt.test.ts` が描画命令 sha256（`dad3fb0d…`）・形状・色で固定。
- 変異試験（作業用コピーで実施、`evidence/exclusion-mutation/`、本体は無改変）:

| 変異 | 結果 |
|---|---|
| なし（control） | 9 files / 223 passed |
| `src/systems/GameModel.ts` に1行追加 | **9/9 files が失敗**（各テストの digest pin） |
| `airBubbleArt.ts` の輪の色を 1 変更 | `airBubbleArt.test.ts` 3件失敗（新規ファイルは新規テストが担当） |
| GameScene の cull 条件 `850`→`851` | **9/9 files が失敗** |

→ 除外による検査範囲の不当な縮小はない。

## 4. ブランチと祖先関係

| ref | commit | 備考 |
|---|---|---|
| `origin/feature/downwell-core-fidelity`（公開） | `5969f37` | 変更なし |
| `feature/air-bubbles-runtime-v1`（本作業） | `5969f37` の子1件 | fast-forward 可能。公開側の履歴は書き換えない |
| main checkout `feature/downwell-core-fidelity` | `080d022`（dirty、未変更） | `5969f37` と分岐。merge-base `882d633`。`080d022` 側に未push 2件（`ad12cd8`、`080d022`、2026-09-23 の boss contact rebound review）、`5969f37` 側に 98件 |

main checkout と公開 remote は互いに祖先関係にない。本作業は main checkout・既存ブランチに触れておらず、deploy 時も `080d022` 側の2件を巻き込まない（deploy 手順の判断は次フェーズ）。

## 5. 証跡の保存

- commit 対象: 報告書4本・README、`harness/`、`evidence/`（テストログ 1,795件、visual 300 frame の JSON、smoke・perf・sustained の生データ、dist sha256、変異試験ログ）。
- commit 対象外（worktree に保存、`.gitignore` で除外）: `builds/`（136 MB、`harness/build-review.mjs` で再生成可）、`smoke/`（36 MB）、`visual/`（28 MB）の画像。全 416 ファイルの sha256 を `evidence/untracked-artifacts.sha256` に記録。前フェーズまでも runtime harness の画像・build は commit していない。

## 6. FOUND — NOT FIXED（記録）

| # | 項目 | 状態 |
|---|---|---|
| 5 | Canvas の JS 割当増（+48〜70 KiB/frame、泡0でも発生。WebGL 泡0 +44 / 12泡 −229） | **PERFORMANCE DEBT（Human Review で許容）**。原因は Phaser Graphics の command buffer の V8 要素種別差（Performance Report §5）。GC 回数・pause・frame time への影響は未観測。V8 依存の暫定修正は禁止のため未適用 |
| 6 | 実機 Mobile 性能 | **未検証**。Chrome の mobile/touch emulation で表示のみ確認。deploy 前後で実機確認が必要 |
| 1–4 | 泡の個数上限なし／重なり濃度／停止中の酸素減少／SwiftShader 停滞 | 既存問題のまま継続（変化なし） |

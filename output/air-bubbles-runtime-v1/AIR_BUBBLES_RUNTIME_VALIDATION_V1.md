# AIR BUBBLES VISUAL DESIGN V1 — Runtime Validation

環境: Apple M3 Pro（11コア / 36 GB）、macOS 27.0.1、Headless Chrome 156.0.8078.80（harness 専用プロファイル、port 9640–9642）、Phaser 3.90.0、Node 26.9.0。
ホスト負荷: 他セッションの vite dev server（PID 90492、main checkout）が計測中 ~400% CPU、load average 10〜16。停止していない。

## 1. Build / テスト

| 項目 | コマンド（worktree ルート） | 結果 |
|---|---|---|
| 型検査 | `node node_modules/typescript/bin/tsc --noEmit` | exit 0（`evidence/tsc.log`） |
| production build | `GITHUB_SHA=air-a node node_modules/vite/bin/vite.js build` | exit 0（`evidence/build.log`） |
| Vitest（AREA 4 以外） | `node node_modules/vitest/vitest.mjs run --testTimeout=60000 --exclude tests/area4.test.ts --exclude '**/node_modules/**' --exclude '**/dist/**' --exclude 'tests/measure/**'` | **83 files / 1747 passed**（`evidence/vitest-main.log`） |
| Vitest（AREA 4 別プロセス） | `node node_modules/vitest/vitest.mjs run --testTimeout=60000 tests/area4.test.ts` | **1 file / 48 passed**（`evidence/vitest-area4.log`） |
| 合計 | | **84 files / 1795 passed、fail 0、skip 0、todo 0、timeout 0** |

内訳: 既存 83 files / 1774 件（Codex 記録と同数）＋新規 `tests/airBubbleArt.test.ts` 21 件。分割は Codex 前フェーズと同じ理由（一括実行時のタイムアウト回避）で、`--testTimeout=60000` 以外の緩和・無効化はしていない。既存テストの変更は新規ファイルを byte-pin 列挙から除外する1行と import のみ（digest・件数の期待値は未変更）。

## 2. 検証用ビルド（`builds/`、`harness/build-review.mjs`）

| build | 内容 | 用途 |
|---|---|---|
| `prod-base` | `5969f37` 本番 build（前フェーズ `builds/final`、公開 44/44 一致） | smoke 比較 |
| `prod-cand` | 本 worktree の本番 build（無改変） | smoke |
| `review-codex` | Codex `start.mjs` と同一変換（A/B 分岐あり）。稼働中の Human Review サーバ :5397 の配信物と `index.html`・`index-*.js` が **byte 一致** | Candidate A の基準 |
| `review-base` / `review-cand` | `5969f37` / 本 worktree ＋ scene 公開 hook・Codex fixture のみ（AIR 描画は出荷コード） | Visual Regression・性能 |

prod-base ↔ prod-cand の差分は 44 ファイル中 `index.html` と `assets/index-*.js` の2つのみ（`evidence/dist-prod-*.sha256`）。

## 3. Runtime smoke test（`harness/smoke.mjs`、`evidence/smoke-prod-cand.json`、画像 `smoke/prod-cand/`）

本番 build に注入なし。NATURAL = 信頼済み CDP 入力のみ。FIXTURE = ヒープから取得した実 GameModel を自身の API で操作（`jumpToStage(3,1)`、プレイヤー上に封印容器を置き model 自身の接触判定で破壊、`breakContainer`、`oxygen`、`completeSection` 後は本番 REST パネルを実タップ、`upgrades.grant`＋`damage` で TIMEOUT）。プレイヤー位置は各 step 前に固定。

| 構成 | Renderer / GPU | Viewport / DPR | Canvas CSS 表示 | 入力 |
|---|---|---|---|---|
| WebGL Desktop | WebGL / ANGLE SwiftShader (Vulkan 1.3.0, LLVM 10) | 1440×1000 / 1 | 448×800 @ (496,100) | key |
| WebGL Mobile | 同上 | 390×844 / 1、mobile+touch | 388×692.3 @ (1,77)、touch UI flex | touch |
| Canvas Desktop | Canvas（`--disable-webgl`、GPU raster） | 1440×1000 / 1 | 448×800 | key |
| Canvas Mobile | 同上 | 360×640 / 1、mobile+touch | 314.1×561 @ (22.9,77)、touch UI flex | touch |

ゲーム内部解像度は全構成 450×800。

| 項目 | WebGL 1440 | WebGL 390 | Canvas 1440 | Canvas 360 |
|---|---|---|---|---|
| ENTRY GATE（gate 表示・押下前の再生0 → 通過） | PASS | PASS | PASS | PASS |
| BGM（gate 後に title BGM 再生中） | PASS | PASS | PASS | PASS |
| START → playing、AREA1 右/左移動・射撃 | PASS（x 225→410→95、shot 8） | PASS（→89.2、shot 8） | PASS（→89.2、shot 6） | PASS（→83.3、shot 8） |
| AIR 放出（1 event、同一 step、3〜5個） | 3個 | 4個 | 4個 | 3個 |
| 上昇（4回サンプル全泡 y 減少） | PASS | PASS | PASS | PASS |
| 描画命令（AIR layer slot / 泡） | 76 | 76 | 76 | 76 |
| 回収と酸素（3.5 s → 11.6 s、event 数 = 泡数、対象泡消滅） | PASS | PASS | PASS | PASS |
| 寿命消滅（末尾1秒の明滅を撮影 → 全消滅まで simulation 秒） | 4.208 s | 4.233 s | 4.233 s | 4.233 s |
| カメラ後端で消滅（参考） | 3.70 s | 3.68 s | 3.70 s | 3.68 s |
| SECTION（3-1 → REST → 実タップ NEXT → 3-2、泡0・AIR layer 0 slot・時間再開） | PASS | PASS | PASS | PASS |
| TIMEOUT 生成（`damage` 受理、HP 4→3） | PASS | PASS | PASS | PASS |
| 半径 96 | 96 | 96 | 96 | 96 |
| 時間停止（内側: worldElapsed 0、elapsed 進行）/ 外側再開 / 再入で停止 | PASS | PASS | PASS | PASS |
| TIMEOUT 内の AIR は停止中に不動 | PASS | PASS | PASS | PASS |
| 脈動（固定画素の色 4サンプル 4種） | PASS | PASS | PASS | PASS |
| AIR と TIMEOUT の表示重なり（AIR を TIMEOUT 内に表示、画像） | PASS | PASS | PASS | PASS |
| Console error / Page exception | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

寿命消滅は 4.2 s ＋ポーリング間隔（約 1〜2 フレーム）。容器をプレイヤー位置で割った場合は泡が約 3.7 s でカメラ後端（cameraY−90）を越えて先に消える（`5969f37` の既存ルール）。比較用に `prod-base` でも同じ smoke を実行（§5）。

## 4. Visual Regression（`harness/visual.mjs`、`evidence/visual-webgl+canvas-accel+canvas-soft.json`、画像 `visual/`）

Codex の review fixture（seed 71103、実 `breakContainer` + `tickBubbles`）で同じ状態・同じ座標・同じ tick を4通りに描画:
Codex A（Human Review の variant A）／Codex Current／base（`5969f37`）／cand（Integrated A）。

- 状態 20（AREA3 tick 0/24/48/120/240/390/420/456/500/520、TIMEOUT 0/48/120、BOSS AQUIFER 0/48、回収 60/64/66、12泡 48/400）
- × Viewport 5（1440×1000、1280×680、390×844、360×640、390×844 DPR 2）× Renderer 3（WebGL SwiftShader / Canvas GPU / Canvas software）= **300 フレーム**
- 比較面: ネイティブ 450×800 framebuffer（`toDataURL`）と、ページ全体 screenshot（CSS 縮小・DPR 込み）

| 判定 | WebGL | Canvas accel | Canvas soft |
|---|---|---|---|
| cand == Codex A（native 全画面 0px） | 100/100 | 100/100 | 100/100 |
| cand == Codex A（page screenshot 全画面 0px） | 100/100 | 100/100 | 100/100 |
| base == Codex Current（native・page 0px） | 100/100 | 100/100 | 100/100 |
| cand vs base: AIR マスク外 0px（native・page） | 100/100 | 100/100 | 100/100 |
| 泡なし（tick 520）の全画面 0px | 5/5 | 5/5 | 5/5 |
| 泡あり状態で差分が出る（候補が描かれている） | 95/95 | 95/95 | 95/95 |
| 同一 build 再描画・再撮影ノイズ | 0px | 0px | 0px |
| 4 build 間の model 全フィールド一致 | 100/100 | 100/100 | 100/100 |
| Console / Page error | 0 | 0 | 0 |

AIR マスク = 描画された各泡の丸め中心 ±12 native px（page はその CSS/DPR 換算 +1px）。マスク内の差分は Current→A の形状差そのもの（cand vs base の最大差分画素 native 741〜1779px は12泡時）。アンチエイリアス・DPR による許容は使っていない（Codex A と全画面 0px のため分類対象の差分が存在しない）。

確認項目:
- 形状・色・輪郭・ハイライト: Codex A と画素一致（`visual/*/*/…-native-x4.png` は左から Current / Codex A / Integrated A）。
- ぼけ・欠け: Candidate A と同一画素のため、承認時の見え方から変化なし。中心は画面画素に整列（unit test で全平行移動量に対し整数辺）。
- 下端の視認性・TIMEOUT との識別性: Human Review で承認された画と同一画素。
- AIR 以外の描画差分: 0px。

## 5. Console / Page error

| 実行 | exception | console error |
|---|---|---|
| smoke prod-cand 4構成 | 0 | 0 |
| smoke prod-base 4構成（比較用、同一手順。放出 3〜5・上昇・寿命消滅 4.22–4.27 s・回収・SECTION・TIMEOUT r96/停止/再開すべて同等、AIR 22 slot/泡） | 0 | 0 |
| visual 3 renderer × 5 viewport × 4 build | 0 | 0 |
| perf 3 renderer・sustained 2 renderer（各 build） | 0 | 0 |

## 6. 未実施・限界

- 実機 Mobile（iOS / Android）・実機 GPU: 未実施。Mobile は Chrome の寸法・touch emulation のみ。
- DPR 3、Safari / Firefox: 未実施。
- 自然プレイで AREA 3 に到達しての AIR 検証: 未実施（AREA 3 は `jumpToStage` fixture。AREA1 の自然操作のみ natural）。model 側の自然挙動は unit test の trace（seed 固定 bot）で `5969f37` と一致を確認。
- BOSS AQUIFER の弾による容器破壊の runtime 再生: 未実施（review fixture の `breakContainer` のみ）。
- 音声は再生開始の確認のみ（音質・ミックスは対象外）。

# Deploy 2026-11-10 — AIR BUBBLES VISUAL DESIGN V1

**DEPLOYED / CLOSED（freeze）。public baseline `b5becdd`（Pages run 42742780376 success）。前段の BLOCKED 記録は経緯として残す。**

## 経緯（認証停止時の記録）

| 項目 | 結果 |
|---|---|
| Release commit | `b5becdd`（親 `5969f37`、FF可能、`080d022` 非混入） |
| remote 直前確認 | origin `feature/downwell-core-fidelity` / `feature/external-test-build` = `5969f37`（想定通り） |
| tsc | exit 0（`evidence/tsc.log`） |
| production build | exit 0、44 files（`evidence/dist-deploy.sha256`）。prod-cand（2026-11-09）との差は build tag（`air-a`→`b5becdd`）による entry JS / index.html のみ、tag 置換後 byte 一致 |
| Vitest | 83 files / 1747 + area4 48 = **1795 passed**（airBubbleArt 21・timeoutArt 22 含む） |
| Push | **未実施**。dry-run で GitHub 認証失敗（"Invalid username or token"）→ keychain の資格情報が無効化され消去。再認証が必要 |

## 2026-11-10 追記 — external-test-build のみ push

- 再認証後（Fine-grained PAT 更新）、origin `feature/external-test-build` を `5969f37` → `b5becdd` へ fast-forward（force・merge・rebase なし）。
- `feature/downwell-core-fidelity` は `5969f37` のまま（未変更）。deploy 未実施。
- 事前確認: 有効な workflow は `pages.yaml`（trigger は downwell-core-fidelity への push のみ）。`deploy.yml` は `main` への push のみが trigger（remote に main なし、Actions にも未登録）。過去 53 run はすべて pages.yaml × downwell-core-fidelity で、external-test-build への push による run は 0。
- 事後: `head_sha=b5becdd` の run 0、総 run 数 53（最新 42392304299 のまま）、公開ページの entry は `assets/index-A7LuZSdp.js`（5969f37）。

## 2026-11-10 本番前最終レビュー — READY FOR DEPLOY

- 差分 `5969f37..b5becdd`: src 2ファイル（`render/airBubbleArt.ts` 新規、`GameScene.ts` +3/−2）、tests 12、`output/` 50（報告書・harness・証跡、bundle 非参照）。package.json / lock / vite.config / index.html / public / .github は無変更。dist は 44 files で `5969f37` と同構成。
- 検証（同日再実行）: tsc 0、build 0、Vitest 1795 passed。
- Rollback 手順: (A) Actions で run 42392304299（5969f37）を Re-run all jobs → 5969f37 を再公開（branch は動かさない、2026-12-08 まで可）。(B) `git revert b5becdd` を新 commit として FF push → 自動 deploy。force push は使わない。CI の build 失敗時は deploy job が走らず 5969f37 のまま。

## 2026-11-10 本番 deploy（承認後）

| 項目 | 結果 |
|---|---|
| Push | origin `feature/downwell-core-fidelity` `5969f37` → `b5becdd` fast-forward（11:26 JST）。`feature/external-test-build` は同日先行で `b5becdd`。force・merge・rebase なし |
| Pages run | 42742780376（#54）build / deploy とも success、head_sha `b5becdd` |
| 公開ファイル | **44/44** が `builds/final`（local b5becdd build）と SHA-256 一致、全件 HTTP 200、root `/` も一致（`public-check.txt`）。公開 tag `hash:"b5becdd"` |

## Public runtime smoke（`harness/smoke.mjs pub` → `evidence/smoke-pub.json`、画像 `smoke/pub/`）

| 構成 | WebGL 1440 | WebGL 390（touch） | Canvas 1440 | Canvas 360（touch） |
|---|---|---|---|---|
| NATURAL gate / タイトルBGM / START / AREA BGM / 左右・射撃 | ✓ | ✓ | ✓ | ✓ |
| AIR 放出（1 event）/ 上昇 / 76 slots/泡 | 4 / ✓ / ✓ | 5 / ✓ / ✓ | 5 / ✓ / ✓ | 4 / ✓ / ✓ |
| 画面外退場 / 寿命消滅（sim 秒） | 3.667 / 4.217 | 3.667 / 4.233 | 3.733 / 4.217 | 3.700 / 4.233 |
| 回収 酸素 | 3.48→11.63 | 3.48→11.61 | 3.50→11.63 | 3.50→11.61 |
| SECTION 3-1→3-2、泡→0 | ✓ | ✓ | ✓ | ✓ |
| TIMEOUT r96 / 内部停止 Δ0 / 外 Δ0.5 / 再停止 / 脈動4色 / 停止中AIR静止 | ✓ | ✓ | ✓ | ✓ |
| console error / exception | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

local prod-cand（11/09）と同値（76 slots/泡、退場 3.68–3.73 s、寿命 4.22–4.27 s）。

## Visual（`harness/pubvisual.mjs` → `evidence/visual-pub.json`、画像 `smoke/pub-visual/`）

loop sleep + `game.step(t,0)` で泡あり/なしを native 450×800 snapshot で差分。4構成 × AREA1/3/4/TIMEOUT 重なり = 16 case 全て: Candidate A 期待画素 624 に対し **余剰 0 / 欠落 0 / 同状態再描画差 0**。色: 624 中 156（TIMEOUT 162）画素が単純合成式から ±25〜34 ずれるが、4 行周期で AIR 層の上に重なる既存の横縞 overlay の行のみ（それ以外の画素は ±3 内）。local b5becdd build で同一の統計。全画面 hash は地形生成が毎回異なるため build 間比較不可。360px・AREA4 暗背景・TIMEOUT 重なりで輪郭判読可（目視）。

## Performance（`harness/pubperf.mjs` → `evidence/perf-pub-webgl+canvas-accel.json`、`perf.log`、host `evidence/perf-host.txt`）

公開版 vs local 5969f37 prod build、live loop、AREA 3-1、泡固定、2 round 交互、240 frame。11/09 の review-build 計測とは方法が異なるため数値の直接比較はしない（差分の符号・大きさのみ照合）。

| | WebGL pub / base（KiB/frame） | Canvas pub / base（KiB/frame） |
|---|---|---|
| AIR 0 | 135 / 90（+45） | 202 / 153（+49） |
| AIR 4 | 133 / 179（−46） | 200 / 144（+56） |
| AIR 12 | 152 / 381（−229） | 216 / 151（+65） |
| TIMEOUT+AIR 12 | 151–179 / 380（−200〜−229） | 217–231 / 150（+67〜+81） |

- frame interval p50 16.7 ms 全条件。>25 ms frame は WebGL 1440 の AIR0/4 で両 build に発生（pub 36/14・12/0、base 22/16・0/3、SwiftShader 既知の揺れ）。Canvas は全条件 0。
- 90 s 持続（AIR12、360）: forced-GC 後 heap WebGL 7.55→7.75 MB（base 7.49→8.10）、Canvas 7.22→7.32（base 7.01→7.18）。単調増加なし。minor GC WebGL 151（base 442）、Canvas 227（base 273）、major 同数。
- 判定: 既知 PERFORMANCE DEBT（Canvas +48〜70 KiB/frame、WebGL 0泡 +44 / 12泡 −229）と同じ大きさ・符号。著しい悪化なし。
- host: 他セッションの node（PID 90492、約370% CPU）稼働中、未停止。load avg 約8.7。

## FOUND — NOT FIXED

| # | 項目 |
|---|---|
| 5 | Canvas JS 割当 +49〜81 KiB/frame（PERFORMANCE DEBT、継続） |
| 6 | 実機 Mobile 未計測（Chrome mobile/touch emulation のみ） |
| 7 | WebGL SwiftShader の >25 ms frame 揺れ（base 同様、既存） |
| 1–4 | 泡の個数上限なし／重なり濃度／停止中の酸素減少／SwiftShader 停滞（既存） |

## Freeze

**AIR BUBBLES VISUAL DESIGN V1 — CLOSED / freeze（2026-11-10）。** public baseline `b5becdd`。

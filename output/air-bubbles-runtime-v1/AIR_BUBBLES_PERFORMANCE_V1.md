# AIR BUBBLES VISUAL DESIGN V1 — Performance (Current vs Integrated A)

**結論: フレーム時間・CPU 描画時間・GPU flush・GC pause・長時間メモリで、統合による一貫した退行は観測されなかった。Canvas の JS 割当は A が約 +48〜70 KiB/frame 多く、原因は AIR の描画量ではなく V8 の配列要素種別の差（§5）。未解決のまま記録し、合格扱いにはしない。Final Human Review（2026-11-09）で PERFORMANCE DEBT として許容。実機 GPU / 実機 Mobile は未計測。**

## 1. 測定環境と条件

| 項目 | 値 |
|---|---|
| ハードウェア | Apple M3 Pro（11コア / 36 GB）、macOS 27.0.1 |
| ブラウザ | Headless Chrome 156.0.8078.80、harness 専用プロファイル（毎回削除） |
| Renderer | **WebGL = ANGLE SwiftShader（CPU ソフトウェア GPU）**、Canvas accel = `--disable-webgl`（GPU raster）、Canvas soft = GPU 無効 |
| 解像度 | 360×640 DPR 1（mobile + touch emulation）、12泡・TIMEOUT は 1440×1000 DPR 1 も。ゲーム内部 450×800 |
| 比較対象 | `review-base`（`5969f37` + hook）vs `review-cand`（Integrated A + hook）。差は AIR 描画2行のみ。同じ fixture（seed 71103、実 `breakContainer`/`tickBubbles`）、同じ泡数、同じフレーム数 |
| 進行 | ゲームループ停止、rAF 1回につき scene 自身の `draw()` + renderer（cycle は model 2 tick + draw） |
| 回数 | 3 round、build 順を round ごとに反転。表の値は3 round の範囲 |
| ホスト負荷 | 他セッションの vite dev server（PID 90492）が ~400% CPU、load avg 10〜16。停止していない。両 build に同条件 |

計測項目（`harness/perf.mjs`）: paced 240 frame の CPU（draw+render）と rAF 間隔／flush 120 frame（WebGL `gl.finish()`、Canvas 1px `getImageData` で強制ラスタ）＝ GPU 完了時間の代理／V8 sampling heap profiler 1 KiB 間隔 151 frame（GC で回収済みも含む）／devtools.timeline trace の MinorGC・MajorGC／強制 GC 後の JSHeapUsedSize。

再現手順（worktree ルート）:

```sh
sh output/air-bubbles-runtime-v1/harness/serve.sh            # 5641–5645 で5 build を配信
node output/air-bubbles-runtime-v1/harness/perf.mjs webgl canvas-accel canvas-soft
node output/air-bubbles-runtime-v1/harness/sustained.mjs 120 webgl canvas-accel
node output/air-bubbles-runtime-v1/harness/alloc-profile.mjs canvas-soft area3 520
node output/air-bubbles-runtime-v1/harness/elements-kind.mjs
```

builds は `node output/air-bubbles-runtime-v1/harness/build-review.mjs base|cand|codex <out>` で再生成可能。

## 2. Frame time / CPU / GPU flush（360×640、3 round 範囲、ms）

| Renderer | 泡 | 案 | CPU p50 / p95 / p99 | rAF 間隔 p50 / p99 | >25 ms | flush p50 / p95 |
|---|---|---|---|---|---|---|
| WebGL SS | 0 | Current | 0.40 / 0.50 / 0.60 | 16.7 / 16.8 | 0 | 0.40 / 0.50 |
| | 0 | A | 0.40 / 0.50–0.60 / 0.60 | 16.7 / 16.8 | 0–1 | 0.40 / 0.50 |
| | 4 | Current | 0.40–0.50 / 0.50 / 0.50–0.60 | 16.7 / 16.8 | 0–1 | 0.40–0.50 / 0.50–0.60 |
| | 4 | A | 0.40 / 0.50 / 0.50–0.60 | 16.7 / 16.8 | 0 | 0.40–0.50 / 0.50–0.60 |
| | 12 | Current | 0.50 / 0.60 / 0.60–0.70 | 16.7 / 16.8 | 0 | 0.50 / 0.60 |
| | 12 | A | 0.40–0.50 / 0.50–0.90 / 0.50–1.10 | 16.7 / 16.8–50.1 | 0–5 | 0.40 / 0.50–0.60 |
| | TIMEOUT+4 | Current | 0.40 / 0.50–0.60 / 0.50–0.60 | 16.7 / 16.8 | 0 | 0.40 / 0.50 |
| | TIMEOUT+4 | A | 0.40 / 0.50–0.60 / 0.50–0.70 | 16.7 / 16.8 | 0–1 | 0.40–0.50 / 0.50–0.80 |
| | cycle | Current | 0.40 / 0.50–0.60 / 0.50–0.60 | 16.7 / 16.8 | 0 | 0.40 / 0.50 |
| | cycle | A | 0.40–0.50 / 0.50–0.60 / 0.60–0.80 | 16.7 / 16.8 | 0–2 | 0.40 / 0.50 |
| Canvas accel | 0 | Current / A | 0.60–0.70 / 0.80 / 0.80 ・ 0.60–0.70 / 0.80–0.90 / 0.80–1.20 | 16.7 / 16.8 | 0 / 0 | 4.3–4.5 / 4.9–7.4 ・ 4.2–4.6 / 4.6–6.4 |
| | 4 | Current / A | 0.60 / 0.70–0.80 / 0.80–1.00 ・ 0.60 / 0.70–0.80 / 0.80–0.90 | 16.7 / 16.8 | 0 / 0 | 4.4–4.7 / 5.3–7.7 ・ 4.2–4.4 / 4.6–5.8 |
| | 12 | Current / A | 0.60 / 0.70 / 0.80 ・ 0.60 / 0.70 / 0.80 | 16.7 / 16.8 | 0 / 0 | 4.2–5.5 / 4.6–7.2 ・ 4.2–4.4 / 4.6–5.1 |
| | TIMEOUT+4 | Current / A | 0.60–0.70 / 0.70–0.80 / 0.80–0.90 ・ 0.60–0.70 / 0.80 / 0.80–0.90 | 16.7 / 16.8 | 0 / 0 | 4.2–4.4 / 4.6–5.9 ・ 4.2–4.6 / 4.7–5.3 |
| | cycle | Current / A | 0.60–0.70 / 0.80 / 0.90–1.10 ・ 0.60–0.70 / 0.80 / 0.80–0.90 | 16.7 / 16.8 | 0 / 0 | 4.3–4.4 / 4.7–7.1 ・ 4.2–4.5 / 4.6–5.6 |
| Canvas soft | 0 / 4 / 12 / T+4 / cycle | Current | p50 0.60–0.70、p95 0.70–0.80、p99 0.80–1.10 | 16.7 / 16.8 | 0 | 1.4–1.5 / 1.6–1.7 |
| | 同 | A | p50 0.60–0.70、p95 0.80–0.90、p99 0.80–0.90 | 16.7 / 16.8 | 0 | 1.4–1.6 / 1.6–1.7 |

1440×1000（12泡 / TIMEOUT+4）: WebGL Current p99 0.90–1.10 vs A 0.70–0.80、Canvas accel 0.90 vs 0.90–1.00、Canvas soft 0.90–1.00 vs 0.90。rAF p99 は 16.8、ただし WebGL で 50 ms 前後の停滞が Current 12泡（1 round で 6件）と A TIMEOUT+4（1 round で 11件）に出た。

- CPU 描画時間の差は 0.1 ms 単位の揺らぎ内。A は Phaser の円弧（WebGL では earcut 三角分割）を使わないため、WebGL 12泡では A がやや軽い。
- `>25 ms` は SwiftShader の WebGL でのみ、両 build に round 単位で散発（§6 #4）。Canvas は全条件 0。

## 3. Allocation / GC（360×640、151 frame・240 frame、3 round 範囲）

| Renderer | 泡 | Current KiB/frame | A KiB/frame | 差 | GC minor / major（240 frame）Current → A | GC pause 合計 ms Current → A |
|---|---|---|---|---|---|---|
| WebGL SS | 0 | 78.8–79.7 | 123.1–123.4 | **+44** | 12–24 / 1 → 18 / 1 | 2.9–5.0 → 3.4–3.7 |
| | 4 | 178.7–180.1 | 132.0–133.5 | −47 | 29–45 / 1 → 23–24 / 1 | 4.7–5.4 → 4.0–5.5 |
| | 12 | 376.8–378.1 | 147.5–148.0 | **−229** | 60–69 / 1 → 24 / 1 | 7.6–7.8 → 4.1–4.7 |
| | TIMEOUT+4 | 192.1–193.5 | 156.1–156.6 | −36 | 31–32 → 24 | 4.4–4.9 → 4.1–4.2 |
| | cycle | 170.0–173.3 | 135.3–135.6 | −35 | 37–38 → 20 | 4.9–5.4 → 3.9–5.1 |
| Canvas accel | 0 | 139.3–140.9 | 188.6–188.9 | **+48** | 20–39 / 2 → 39–40 / 2 | 5.2–8.1 → 7.6–7.9 |
| | 4 | 139.4–140.7 | 196.8–198.6 | +57 | 27–39 → 28–29 | 6.1–8.1 → 6.0–7.0 |
| | 12 | 144.3–145.3 | 208.8–211.1 | **+65** | 23–39 → 29–41 | 5.5–7.4 → 6.2–7.2 |
| | TIMEOUT+4 | 149.0–150.2 | 216.0–216.5 | +66 | 23–36 → 40 | 5.6–7.8 → 7.5–7.9 |
| | cycle | 145.9–146.8 | 198.7–199.9 | +53 | 35–39 → 39–40 | 6.7–7.5 → 7.5–7.7 |
| Canvas soft | 0 / 4 / 12 / T+4 / cycle | 139–151 | 187–216 | +48〜+66 | 同程度 | 4.7–7.4 → 6.0–7.8 |

1440×1000 12泡: WebGL 381 → 151、Canvas accel 148 → 214、Canvas soft 150 → 215 KiB/frame。

GC pause は各条件とも最大でも数 ms／240 frame（1回あたり ≤ 3.4 ms、§4）で、フレーム間隔に影響する長さではない。

## 4. 長時間実行（cycle: 放出→上昇→消滅→リセット、120 s × 各 build 2回、360×640）

| Renderer | 案 | frame | rAF p99 | >25 / >50 ms | CPU p95 | GC minor / major（ms） | 最大 GC pause | 強制 GC 後 heap 開始 → 終了 |
|---|---|---|---|---|---|---|---|---|
| WebGL SS | Current | 7205 / 7204 | 16.8 | 0/0, 0/0 | 0.6 | 366 / 35（54+32）, 363 / 35（57+35） | 2.5, 2.9 | 6.55→7.38, 6.58→7.39 MB |
| | A | 7202 / 7204 | 16.8 | 1/1, 0/0 | 0.5 | 234 / 35（43+33）, 235 / 34（42+33） | 2.3, 1.4 | 6.39→7.38, 6.47→7.38 MB |
| Canvas accel | Current | 7206 / 7204 | 16.8 | 0/0, 0/0 | 0.8 | 284 / 72（62+73）, 324 / 73（74+73） | 3.4, 1.6 | 5.94→6.87, 5.87→6.86 MB |
| | A | 7204 / 7204 | 16.8 | 0/0, 0/0 | 0.8 | 277 / 73（65+74）, 282 / 72（66+72） | 1.3, 1.4 | 6.02→6.88, 5.92→6.89 MB |

- 5 秒ごとの heap（GC 強制なし）は両 build とも 6.4〜13.6 MB の鋸歯状で、GC 後の値は同じ水準（7.38–7.39 / 6.86–6.89 MB）に戻る。
- 強制 GC 後の残留増加は 120 s で両 build とも 0.8〜1.0 MB（Current 0.82–1.0、A 0.86–0.99）。A 固有の増加ではない。2分を超える傾向は未計測のため、リークの有無はこの範囲では「両 build 同等・判定不能」とする。

## 5. Canvas 割当増の原因調査

1. **泡数に比例しない**: Canvas では泡0個でも A が +48 KiB/frame。AIR の描画ループは泡0個なら何もしないので、AIR 描画の命令量そのものではない。泡あたりの増分は Canvas A 約 1.8 KiB / Current 約 0.4 KiB（12泡と0泡の差 ÷ 12）。
2. **関数別割当**（`evidence/alloc-profile-canvas-soft-area3-520.json`、泡0）: 差はすべて `GameScene.rect()`→Phaser `Graphics.fillRect` の command buffer 伸長（draw 内 33.6 → 66.8、submerged 内 10.8 → 21.7 KiB/frame）。その他の関数は同値。
3. **要素種別**（`evidence/elements-kind.txt`、`--allow-natives-syntax`）: 内容のある Graphics の command buffer は Current では V8 の `PACKED_ELEMENTS`（tagged、整数は Smi で 4 B）、A では `PACKED_DOUBLE_ELEMENTS`（8 B/要素）。Phaser の command buffer は全 Graphics が同じ配列リテラル（allocation site）から作られ、毎フレーム `clear()` で長さ0から再伸長する。Current では AIR の `strokeCircle` が `arc` コマンドに boolean を積むため配列が tagged に遷移し、その allocation-site feedback が他の Graphics にも及んでいた。A は数値しか積まないため double のまま残り、同じ命令数でも再伸長のバイト数が約2倍になる。
4. **WebGL** は逆に、Current の円弧が earcut の三角分割で泡あたり約 25 KiB を割り当てていたため、4泡以上では A の方が少ない（12泡で −229 KiB/frame）。泡0の +44 KiB は Canvas と同じ要素種別の効果。

描画内容は Candidate A と画素一致しており、この差は V8 の内部表現の選択による。等価な対策は「command buffer に数値以外を積んで tagged に戻す」等の V8 依存の細工しかなく、見た目は変えないが意図が不明瞭で将来の V8 で効果が保証されないため **適用していない**（§6 #5）。

## 6. FOUND — NOT FIXED

| # | 項目 | 状態 | 根拠 |
|---|---|---|---|
| 1 | 泡の全体個数上限なし | **既存問題のまま継続**（統合は個数・生成に関与しない） | model ソース digest 一致、trace 一致。trace の最大同時 10泡 |
| 2 | 放出直後の重なりで濃度増加 | **既存問題のまま継続**。A でも各泡を個別に描くため同心の重ね描きで濃くなる（Candidate A の承認画像と同一画素） | unit test「burst at one centre stacks as before」、Visual Regression tick 0 |
| 3 | 時間停止中も酸素が減る | **既存問題のまま継続**（ゲーム仕様。統合はモデル無変更） | smoke: TIMEOUT 内で worldElapsed 0、AIR 不動。OxygenSystem digest 一致 |
| 4 | SwiftShader WebGL のフレーム停滞 | **既存問題のまま継続（統合による悪化は確認されず）**。50 ms 前後の停滞が Current（1440 12泡 1 round 6件）と A（1440 TIMEOUT+4 1 round 11件、360 12泡 1 round 5件）の双方に round 単位で散発。CPU 描画時間・flush は差なし。長時間 120 s では A 1件 / Current 0件 | §2, §4。ホスト負荷下 |
| 5 | Canvas の追加割当・GC 負荷 | **PERFORMANCE DEBT（Human Review で許容、V8 依存の暫定修正は行わない）**。**統合により割当は増加（Canvas +48〜70 KiB/frame、WebGL 泡0で +44）。GC 回数・pause は同等で frame time への影響は未観測**。原因 §5。等価最適化は未適用 | §3, §4, §5 |
| 6 | 実機 Mobile 性能 | **未検証**。Chrome の mobile/touch emulation で表示のみ確認 | — |

## 7. 未計測

- 実機 GPU（Apple / Mali / Adreno 等）での描画・GPU 完了時間。ここでの flush 時間は SwiftShader / Chrome のラスタ経路の代理値。
- 実機 Mobile（iOS Safari / Android Chrome）、低速 CPU throttle、DPR 2 以上での性能。
- 2分を超える連続実行、自然プレイ（AREA 3 の通し）での最大同時泡数と性能。
- 入力遅延。

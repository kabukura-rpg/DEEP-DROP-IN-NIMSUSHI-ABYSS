# NIMUSHI MASTER FIDELITY / GAMEPLAY ALIGNMENT PASS

Starting HEAD: `3abbda5` / branch `feature/downwell-core-fidelity`。
MASTER DESIGNはHUMAN APPROVED / LOCKED。解像度・alignmentは未承認。FULL SHEETは未着手。

## Review

- `index.html`: MASTER / LOW / HIGH横並び、配置A/B、desktop/mobile、判定overlay、PLAYER比較。
- `live.html`: 本物のBoss戦でHIGH/LOW・A/B・LEGACY・判定表示を即切替。標準はHIGH / 配置A。公開entryへ接続していない。
- LOW/HIGH・A/Bの切替はモデルを書き換えず、同じ戦況を保持。PAUSE後にも比較可能。
- RESTARTは既存 `__bossTest({ weapon, target, attack })` を利用。MACHINE/SHOTGUN/PUNCHER、SHOWER/BEAM/CLONES、phase1/phase4を選択。phase4は既存の開始HP fixtureを使う。戦闘中の回復・無敵化・強制撃破なし。
- PCは通常キー、mobileは通常の左右/FIRE/画面操作。PAUSE / RESUMEで通常のポーズ処理を呼ぶ。

**IDLE一枚のみ。** 目の開閉・hit/rage/death表情は未制作。内部eyeOpenは上部のOPEN/CLOSED表示・任意の判定枠色で確認する。これは完成した戦闘演出の承認用ではない。BODY/EYE別offsetは未実装。

## Source / dimensions

MASTERは `../master-alignment-v1/MASTER_NIMUSHI.png`。今回変更なし、SHA-256はmanifest。画像生成・描き直しなし。

|候補|source|logical display|処理|
|---|---|---|---|
|LOW|128×112|256×224|前回candidateをbyte一致で再利用、23色|
|HIGH|256×224|256×224|MASTERから同じcrop、nearest resize、alpha二値化、減色なし|

HIGHは128版の拡大ではない。従来と同じlogical content bounds `(16,16)-(232,208)` を保つ。pivotはLOW `(64,20)` / HIGH `(128,40)`、logical換算は共通。縮小先の整数丸めだけで元の縦横比を近似し、部位別変形なし。描画scaleはLOW 2 / HIGH 1。collisionはモデルのgetterを読み、source解像度に依存しない。

3列比較のMASTER欄は原画を同寸法へLanczos表示した参考（game assetではない）。HIGHはnearestのまま。解像度だけでなく、LOWにあった減色制限も解除した比較である。

## Alignment measurements

「+16px alignment」は画面上へ移動する意味と解釈し、screen Y offsetは **−16**。

|論理座標|配置A|配置B|
|---|---:|---:|
|offset Y|0|−16|
|contact top|160|160|
|visual top|192|176|
|上端空白|32|16|
|両目登録anchor Y|290|274|
|weak point Y範囲|272–344|272–344|
|contact / weak寸法|168×82 / 60×72|同左|

LOW/HIGH共通。測定は同じ静止Boss基準姿勢。実戦では既存のbody移動・hit recoil・cameraに追従。配置Bの両目anchorはweak上端から2px内側で、まぶた・傾いた目の一部は上へ外れる。contactの丸いフード外側にも透明域が残る。32px上へ移して目が外れる案は採用していない。

## Fidelity observation (Human approval pending)

HIGHでは犬フードの輪郭・垂れ耳・小さい犬顔、顔の比率、両目、巻き髪の線、骨、ストロー、カップ内の粒、服の折り目がLOWより読み取れる。色相・陰影関係も無減色で維持。原画の微細線・個々の粒や折り目は256化でも完全保存ではない。pixel countだけで採否を決めていない。MASTERに本人らしさが近いか、最終判断はHuman。

## Implementation boundary

唯一のproduct変更は `src/scenes/GameScene.ts`。従来のBoss本体＋顔描画を `bossBody()` へ抽出。legacy描画内容を維持し、攻撃物・境界・cast・死亡時破片は既存encounter描画に残す。physics、damage、HP、weapon、camera、C1 geometry、attackロジックは差分なし。

live.jsはこの本体描画だけをruntimeで差し替える。敵・弾が本体の前に描かれる順序をdev専用graphicsで維持。更新時にBoss画像をいったん非表示にし、Boss不在時に残像を残さない。ゲームコードへのart importer/API追加なし。reloadでlegacyへ戻る。実戦ページ自身を開いた時だけ有効。

## Verification

- 既存テスト **907 / 907**、36 files。`tests.log`。
- `tsc --noEmit` 成功、`vite build` 成功。`build.log`。既存Phaser chunkの500KB警告あり。
- distで `artReview` / `nimushi-review` / `nimushi_idle_256` / `resolution-review-v1` / `ART REVIEW` は0件。art資産・review HTMLなし。
- 静止12ケース: errorsなし、model不変、geometry共通。`browser-results.json`。
- 実戦7ケース: CDPの実pointer/key入力。weak-point命中をMACHINE/SHOTGUN/PUNCHERで観測。SHOWER、BEAM、CLONE、SHADEを確認。踏みつけ撃破イベント、bossContactとbossSweep死亡を観測。HPを補助していないため短時間で死亡するケースもある。全戦通しクリア試験ではない。`live-results.json`。
- HIGH/LOWと配置切替は全てJSONモデル不変。カメラ・プレイヤー座標も同一。
- 390×844相当: 実CDP touchでFIRE・左右。`touch-results.json`。実機スマホではない。

## Performance

同じデスクトップheadless Chrome / Phaser WebGLの短時間実戦で、LOW中央値16.7ms / p95 16.7ms、HIGH中央値16.7ms / p95 16.7–16.8ms。mobile viewportのHIGHも16.7ms。測定はRAF間隔であり、GPU時間・実機mobile FPSの保証ではない。乱数も固定した厳密ベンチマークではない。目立つframe時間増加・描画例外は観測されなかった。

RGBA8のbase texture理論値はLOW 56KiB / HIGH 224KiB（+168KiB）。これは実GPU使用量測定ではない。比較ページは両方をキャッシュする。低解像度へ戻す実測根拠なし。

## Human review checklist / remaining

1. HIGHが「MASTERそのものがゲームにいる」見た目か。
2. A/Bでcontact空白32/16pxの差をどう感じるか。
3. 見える両目の縁へ射撃した際のMISSが納得できるか。
4. SHOWER/BEAM/CLONE/SHADE、踏みつけ、camera、PLAYER/敵との密度差。
5. 実機mobileでの視認性・性能。

IDLEの開閉差分がない制約を踏まえて評価する。BODY/EYE別offset・FULL SHEETへは進めない。現在は比較準備完了で停止する。

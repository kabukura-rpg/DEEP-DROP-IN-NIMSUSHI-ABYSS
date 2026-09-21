# PLAYER SPRITES v1 — DEV REVIEW CANDIDATES

正式採用前のPLAYERアート制作・dev接続。NIMUSHI生成は未着手。mainへのmergeなし。

## Deliverables

- `frames/`: 35個の独立48×48 PNG。
- `sheets/`: shared 192×96 / normal 192×240 / boss 192×144。4列、余りは透明。
- `animation-map.json`: state / fps / loop / sheet index / frameごとのbody anchor。
- `index.html`: 48px実寸と拡大のアニメーション、左右反転、一時停止。
- `previews/contact-sheet.png`: 全フレーム一覧。
- `source/`: built-in imagegenによる32枚の生成候補原画。
- `generation-plan.json`, `generation-record.json`, `records/`: プロンプト、参照、生成先、採否。
- `rejected/idle_01.png`: 初回不採用画像。
- `review/`: 実ゲームCanvas画像、検証スクリプト、結果、テスト・ビルドログ。

|分類|state: frames|
|---|---|
|Shared|IDLE 2 / DAMAGE 2 / DEATH 4|
|Normal|RUN 4 / JUMP_RISE 2 / FALL 3 / GUNBOOTS_FIRE 2 / GUNBOOTS_BRAKE 2 / LANDING 2 / WALL_CONTACT 1 / WALL_KICK 2|
|Boss|BOSS_ASCEND 3 / BOSS_BRAKE 2 / BOSS_HOVER 2 / BOSS_DAMAGE 2|

指定の合計は35枚。承認済みFALL・ASCEND・BRAKEの各00はバイト単位で再利用。
BOSS_DESCEND_THRUSTは元prototypeディレクトリのarchive/referenceとして保持し、sheetにもstateにも含めない。

## Generation and cleanup

通常のbuilt-in imagegenを使用。各回に承認済み4poseを参照し、差分生成ではstateの先頭候補も参照。巨大sheetの直接生成なし。NIMUSHIの生成なし。

nearest-neighborで48pxへ縮小、承認済みパレットへ量子化、alphaを0/255へ整理。元の生成候補は非破壊で保存。

不採用・修正:

1. IDLE_01初回は尻尾が上がり、IDLE_00と連続しなかった。state基準画像を追加参照して再生成。
2. FALL_01/02、BOSS_ASCEND_01/02、BOSS_BRAKE_01の生成原画は、微動指定に対して顔・身体・尻尾の長さが変化。最終フレームへの直接採用を見送り。承認済みrasterの顔・身体を固定し、尻尾先端だけ1px移す仕上げへ変更。原画と採否は記録済み。
3. その他は候補として維持。完成アートとして自動承認したものではない。

## Registration / consistency

48pxセルを歪めず等倍表示。bodyの基準点をphysics centerに合わせ、全フレームのanchorをmapへ記録。画像のoriginは0.5。髪・耳・尻尾をhitboxへ含めない。横反転ではanchorのXオフセットも反転。壁接触は壁側、壁蹴りは離れる方向を使ってvisualのみ反転。

全35枚: 48×48、透明度0/255、共通パレット、sheetとの完全一致を自動確認。
承認済み3枚: byte-identical。微動3stateの顔・身体: 基準画像を固定。
目視: 茶髪・耳・白茶尻尾・衣装・Gunbootsを維持し、暗い背景上でも輪郭を確認。
RUNの足運び、DEATHの脱力感、WALL_KICKのポーズ変化は人間の最終レビュー対象。全stateの顔・足位置が人間の許容範囲かは、一覧を再生して判断してほしい。

## Dev integration

`__playerArt('prototype')` / `__playerArt('legacy')`

`__playerArt('prototype', 1, 'wall_kick')` のように第3引数で描画だけを指定できる。`'auto'`で実gameplay選択へ戻る。これはゲーム状態を作る機能ではなく、画面上でのアート確認専用。

- 自動選択: 接地・水平速度・垂直速度・壁側と既存shot/land/wallJump/hurtイベントを参照。
- DAMAGE: 約0.167秒。無敵時間全体には適用しない。
- DEATH: 約0.5秒で最終フレーム。空中でも成立し、結果画面やgameplay進行を遅らせない。
- BOSS_HOVER: 実射撃後0.14秒以内、|vy|<20の場合だけ。自由浮遊なし。
- Bossでvy>0の下降バウンド、clear/restなど対象外stateはlegacy。
- FXは従来レイヤー。physics / collision / movement / camera / input / balanceへの書き込みなし。
- dev条件でのみロード。production/distに候補PNG・map・切替hookなし。

## Browser verification

`review/actual-state-results.json`: 既存STARTとBOSS TESTから実CDPキー入力で11状態を記録:
FALL, LANDING, IDLE, GUNBOOTS_FIRE, GUNBOOTS_BRAKE, WALL_CONTACT, JUMP_RISE, BOSS_ASCEND, BOSS_BRAKE, BOSS_DAMAGE, DEATH。

RUN / WALL_KICK / 通常DAMAGE / BOSS_HOVERは短い試走で自然発生を記録できなかった。全15stateの`visual-only-*.png`は停止中の実ゲーム描画にdev表示指定を使ったもの。自然発生確認とは区別する。

`review/browser-results.json`: real-input FALL / ASCEND / BRAKE、legacy比較、scale変更、全state表示指定。A/B・scale・表示指定の前後でmodel JSONが一致。ブラウザ例外なし。

`review/asset-validation.json`: 35/35構造検証成功。
`review/tests.log`: 876/876成功（44 files）。
`review/build.log`: tsc --noEmit + vite build成功。既存Phaser chunk-size警告あり。

## Scope

この変更のソース差分はsrc/dev内のみ。GameModel・入力・GameScene・Boss gameplayを変更しない。
別セッションのAREA地形変更はこのart commitにstageしない。
main基準: `6e3d1af06e633a8e33cf1d7eed4fa592268fa27c`（変更なし）。

最終テスト再実行時、既存AREA 3の重いテストがデフォルト並列で一度5秒timeout。テストコード・timeout値は変更せず、`npm test -- --reporter=dot --maxWorkers=2`で全876件成功。確認用ギャラリーは15カード・30canvas、ブラウザ例外なし。

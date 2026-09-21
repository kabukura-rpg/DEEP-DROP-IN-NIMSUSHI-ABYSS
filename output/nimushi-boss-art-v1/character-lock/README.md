# NIMUSHI CHARACTER LOCK CANDIDATE v1

Human Review待ち。新規生成はIDLE基準画像1枚だけ。BODY/EYE/CLONE/SHADEの全sheet未生成。正式renderer未接続。

## Art / files

- `nimushi_idle_lock_v1.png`: 128×112 RGBA、23不透明色、alpha 0/255。
- `source.png`: built-in imagegen生成原画1340×1174。コンセプトボードはidentity参照のみ、切り抜き不使用。
- `actual-size.png`: 256×224、2×nearest-neighbor。
- `enlarged.png`: 768×672、6×nearest-neighbor。
- `player-size-comparison.png`: PLAYER 48×48とBoss 256×224の等倍比較。
- `desktop.png` / `mobile.png`: 実ゲーム静止プレビュー1280×900 / 390×844。
- `collision-overlay.png`: cyan＝visual bounds、orange＝actual contact rect、yellow＝単一weak point、green＝両目のvisual anchor。
- `generation-record.json`: prompt、参照、生成方式・原画パス。
- `manifest.json`: 寸法、anchor、palette、透明化・縮小処理。
- `prepare.py` / `capture.mjs`: 再現用処理。
- `preview.html`: devテスト画面を同一origin iframeで開き、BOSS TEST開始後にSceneを停止。runtimeの描画関数だけを置換し、リロードで元に戻る。モデルを変更しない。戦闘検証用ではない。

犬の垂れ耳フードと小さい犬の顔、巻き髪、人間の両目、茶系衣装、骨の髪飾り、小さいタピオカカップとストローを維持。今回のlock画像には目を含む。将来のアニメーションではbody/eye overlayを分離する。

## Registration and collision — review issue

旧specのeye anchor(64,77) / pivot(64,40)に対し、生成された自然な構図ではeye anchor(64,57) / pivot(64,20)。両方を20px上へ登録する候補とし、世界座標での目の高さ＝body center+74pxは維持。縦横比を歪めて合わせていない。

- source alpha bounds: x8..116 / y8..104（右・下はexclusive）、108×96。
- logical visible bounds: 216×192。cellは256×224、PLAYER cell比は幅5.33倍・高さ4.67倍。
- pivot: source(64,20)、origin相当(0.5,20/112)。
- eye anchor: source(64,57)、eye overlay将来左上(46,45)。
- body centerの画面座標(225,216)、body上端160＝800px画面の20%。既存cameraそのまま。
- visual bounds画面座標: x113..329 / y192..384。
- actual body: x141..309 / y160..272（168×112）。
- actual contact: x141..309 / y160..242（168×82）。contactInset30、player-facing側だけ削減。
- single logical weak point: x195..255 / y272..344（60×72）。eyeHeight72。
- visual paired-eye anchor: (225,290)。両目は一つの弱点帯内。

**未解決のart側調整点：contact矩形上端はvisible bounds上端より32 logical px上。** 現候補は顔・耳・髪・衣装が判定外へ大きく張り出す構図。collisionとsilhouetteは同一にしないが、上部の見えない接触領域は正式接続前に、フードの構図を上へ広げる等のアート修正が必要。gameplay値を動かして帳尻を合わせていない。

弱点は顔からストロー・カップ上部にかかる縦長の範囲。目の形＝collisionではない。Human Reviewではこの見た目と狙い所の関係も確認したい。

## Human review checklist

|項目|今回の観察・確認点|
|---|---|
|本人らしさ|犬フード、巻き髪、骨飾り、飲料のidentityを維持。本人らしさの最終承認待ち|
|cute / unsettling|可愛さが強く、赤茶の目と紫茶の影で静かな不穏さ。暗さを足すか判断対象|
|dog hood|垂れ耳と犬の顔を確認。犬の目は装飾|
|face|PC・mobileで顔を識別可能|
|two eyes|人間の両目あり、単一ellipseではない|
|tapioca motif|カップ・黒い粒・ストローを確認|
|PLAYER比|Bossは明確に大きい。比較画像あり|
|screen top|既存20%camera anchor維持。アート上端自体は24%位置|
|weak point|両目anchorは単一領域内。縦長領域と飲料の重なりは要判断|
|collision乖離|上端32pxのずれを明示。正式接続前にart修正が必要|
|desktop|1280×900の実ページHUD込み静止配置。HUDと重ならない|
|mobile|390×844の実ページ幅で静止配置。実スマホ端末のタッチ試験ではない|

## Validation / Git

開始HEAD7331904、feature/downwell-core-fidelity。b6f76e3→581229dはancestor=true、逆=false。両コミット間にdivergenceなし。現在HEADにも両方を含む。merge / rebase / cherry-pickなし。

実プレビュー3ケースとも描画変更前後のmodel JSON一致、browser例外なし（最終再実行）。`browser-results.json`参照。

`npm test -- --reporter=dot --maxWorkers=2`: 907/907成功、36 files。
`npm run build`: tsc --noEmit / vite build成功。既存Phaser chunk size警告のみ。

product code / gameplay / collision変更なし。output配下の独立devプレビューと承認記録だけ。
旧PLAYERプレビュー4変更・未追跡ファイル群、および未追跡`.github/workflows/pages.yml`は対象外として保持。
mainは6e3d1af06e633a8e33cf1d7eed4fa592268fa27cのまま。mergeなし。

PLAYER ART v1 — HUMAN APPROVED
NIMUSHI BOSS ART — CHARACTER LOCK CANDIDATE READY FOR HUMAN REVIEW
FULL NIMUSHI SHEETS NOT GENERATED YET

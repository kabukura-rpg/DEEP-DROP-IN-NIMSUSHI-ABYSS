# NIMUSHI CHARACTER DESIGN — HUMAN APPROVED / LOCKED

今回添付された `codex-clipboard-0c670789-eb7b-4fcc-89b3-93f7d94a99de.png` を `MASTER_NIMUSHI.png` へバイト単位でコピー。これだけを今後のcharacter referenceとする。過去のフード拡張案 `alignment-pass-v1` は撤回・不採用。新規生成・MASTERの描き直しなし。

## Gameplay alignment only

MASTERから従来と同じ均等縮小・nearest-neighbor・23色・透明度0/255のgameplay spriteを作成。128×112 source / 256×224 display。A/Bとも同一PNG・同一scale・同一pivotを使用。Bの違いはrenderOffsetY=-16だけ。

|450×800論理画面での測定|A current|B adjusted|
|---|---:|---:|
|render offset Y|0|-16|
|contact top|160|160|
|visual silhouette top|192|176|
|差 visual−contact|+32|+16|
|両目のvisual anchor Y|290|274|
|logical weak point Y範囲|272–344|272–344|
|contact寸法|168×82|168×82|
|weak point寸法|60×72|60×72|

body上端=画面20%の既存camera、physics、geometryは変更しない。source eye anchor(64,57)、pivot(64,20)。背景・HUD・PLAYERは現行ゲーム。静止devプレビューのみ、正式rendererへ未接続。

**Bは部分改善案でありalignment承認済みではない。** 両目の中点は弱点上端から2px内側だが、傾いた両目・まぶたの一部は弱点上端より上に出る。丸いフードとcontact矩形の角も一致しない。頂部1点の差が半減したことと、矩形全域の透明な接触が解消したことは別。

単純に32px上へ移すと上端差は0になるが、両目anchor Y258は弱点上端272より14px上へ外れる。crop/padding/pivotだけでは顔とフードの相対距離は変えられない。今回、上端一致のために目やMASTER形状を変える処理は行っていない。Bの見た目が自然かHuman Reviewで確認する。

## Outputs

- `MASTER_NIMUSHI.png`: 今回添付されたMASTERそのもの。
- `nimushi_idle_lock_v1.png`: gameplay sprite。`actual-size.png` 2×、`enlarged.png` 6×nearest。
- `A-desktop.png` / `B-desktop.png`: 1280×900。
- `A-mobile.png` / `B-mobile.png`: 390×844。
- `A-overlay.png` / `B-overlay.png`: cyan visual bounds / orange contact / yellow single weak point / green paired-eye anchor。
- `alignment-comparison.png`: A/B overlayのゲーム部分比較、数値つき。
- `player-size-comparison.png`: PLAYER 48pxとのサイズ比較。
- `manifest.json`: hash・sprite登録・offset。
- `browser-results.json`: 全6ケースでmodel変更なし、geometry一致、browser例外なし。

MASTERは元の生成原画と同じ構図・alphaだが再添付ファイルのRGBに微差があったため、今回の添付ファイル自体をsource of truthとして保存した。

## Scope / validation

src・gameplay・collision変更なし。画像寸法・alpha・MASTER hash・全6ケースのgeometry同一性を検証。今回テスト・buildの再実行なし（product code変更なし）。直前HEAD a9cb984での記録は907 tests / tsc / build成功。

MASTER designはLOCK済み。Gameplay alignmentのみレビュー待ち。BODY14 / EYES7 / CLONE / SHADEはまだ生成しない。承認後もMASTER参照、state単位で制作して最後にpackする。

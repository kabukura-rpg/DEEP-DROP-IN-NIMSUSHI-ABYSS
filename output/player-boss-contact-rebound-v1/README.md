# PLAYER BOSS CONTACT REBOUND — one-frame art candidate

## Scope and semantics

BOSS_CONTACT_REBOUNDは名称候補。48×48の追加1フレームのみ。既存PLAYER ART v1の35 frames・15 statesは全ファイルのbaseline SHA-256と一致。既存のsheet/animation map/source/product rendererにこの候補を登録していない。

監査した `GameModel.tickNimushi()` のBoss本体接触は `damage(NIMUSHI.contactDamage, 'bossContact')` が成立し生存した場合に `p.vy = this.up * this.stats.bounce` と `reloadCharge()` を実行する。通常敵の無傷stompとは別。見た目は反転重力下で画面上のBossへ足を向ける接触瞬間。候補はhit reactionを示すが、攻撃成功や無敵を示す演出にしない。

## Asset

- `boss_contact_rebound_00.png`: 最終candidate、transparent 48×48、pivot `(24,24)`。alphaは0/255、RGBは既存PLAYER v1 paletteのみ。縦横比を保つnearest縮小とpalette mapping。SOURCEや既存35 frameは上書きしていない。
- `source/contact.png`: built-in imagegenで生成した高解像度の採用元。初回候補は足が左へ出ていたので不採用。方向修正を1回実施してこの1枚を採用。prompt全文は`prompts.md`。
- `nearest-10x.png`、`comparison.png`、`desktop-contact.png`、`mobile-contact.png`。

## Preview and validation

desktop/mobileは実際の `bossContact` イベント直後にdevゲームを停止し、PLAYERの見た目だけcandidateへ一時置換した静止画像。NIMUSHIはHIGH source256×224、display256×224、renderOffsetY −16 (B)。captured `bossContact` はHP 4→3、CHARGE 8、反発速度+210を記録。PLAYER/Bossの位置・HP・modelは置換時に変更していない。`browser-results.json`。正式rendererは未接続。

`validation.json`: 寸法、透明度、palette、35既存frame hash、15state、MASTER hash、HIGH+B、2ブラウザケース。previewの見た目と接触の納得感はHuman Review対象。

## Git and release

c6c39fcの128再出力13ファイルだけをrevertしたcommitは3c47a1b。HIGH+Bの選択はdev review manifestと承認文書に記録。128はarchival comparisonのみ。mainを変更しない。

今回product gameplay/renderer codeの変更なし。907 tests/tsc/buildの再実行は行っていない。直近のproduct検証は解像度レビュー時の907/907、tsc成功、build成功。別セッションのmobile UI commit `882d633` は今回の検証対象ではない。反発後フレーム、NIMUSHI FULL SHEETSは未制作。

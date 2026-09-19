# DEEP DROP

縦落下アクションゲーム仕様書 v0.1 をもとにした、TypeScript / Vite / Phaser 3 のプレイ可能な MVP です。

## 起動

Node.js 22.12 以降を推奨します。

この Mac では `start.command` をダブルクリック、または `./start.command` で起動できます。システムの Node.js が動かない場合は、Codex に同梱された Node.js を利用します。

```sh
npm install
npm run dev
```

表示されたローカル URL を開きます。同じ Wi-Fi のスマートフォンからは Vite が表示する Network URL にアクセスできます。

```sh
npm test       # 物理・衝突・弾薬・敵・強化・生成のテスト
npm run build # TypeScript 検査 + 本番ビルド
npm run preview
```

## 操作

| 入力 | 動作 |
| --- | --- |
| A / D または ← / → | 左右移動 |
| Space（長押し可） | 真下への射撃 |
| Esc / 右上の Ⅱ | ポーズ |
| スマホのプレイ画面の左右をホールド | 左右移動（押した瞬間に1発射撃） |
| スマホの画面をタップ | 射撃 |
| 画面下部の ← / → / FIRE | 移動・連射。複数指で同時操作可能 |

ACTIONは1つです。接地中は**ジャンプ**、空中は**射撃**になります（`JUMP.impulse` は原作未計測の暫定値）。射撃反動は落下を減速し、上昇速度を発生させません。踏みつけは上向きにバウンドし、CHARGEを全回復し、コンボは続きます。着地はCHARGEを全回復し、そこで**コンボを精算**します。空中で弾は自然回復しません。CHARGEは残り1以上なら武器コスト未満でも最後の1射を撃てます（消費後は0）。

「操作を試す / CONTROL LAB」は敵のいない足場1枚の練習画面です。画面下に落ちると上から再開します。Esc でタイトルに戻れます。

## 実装範囲

- 9:16 の縦画面、デスクトップの装飾・ガイド、スマホの同時タッチ入力
- 指定初期パラメータ、弾数制限、上面着地、リロード、反動
- スライム / コウモリ / アーマースライム / アーマーブルート、射撃と踏みつけ、約1秒のダメージ無敵
- 空中コンボ、段階的スコア倍率、深度と難易度の進行
- チャンク生成と古いオブジェクトの破棄
- 区間クリアから呼び出せる休憩・3択強化（10種類、カテゴリ分散・スタック上限・選択確認）
- HPの一元管理、FOOD、余剰回復4ポイントでLIFE UP、25コンボ以上で着地精算時にHP +1
- 4 AREA × 3 SECTION + FINAL BOSS のステージ進行。各SECTIONは区間内200mで CLEAR。休憩では自動回復しません
- AREA 1「SURFACE RUINS」は3SECTIONぶんの生成レシピを持ち、1-1から1-3へ足場が狭く敵が濃くなります
- AREA 2「SUNKEN RUINS」はOXYGEN・泡・エアポケット・水中物理を追加。酸素はSECTION開始で満タン、休憩・ポーズ中は減りません
- AREA 3「MAGMA DEPTHS」はHEAT・溶岩（接触即死）・噴出口・アイスを追加。HEATは時間ではなく熱源との距離で増減します
- AREA 4「COLLAPSED REALM」は新しいゲージを持たず、着地すると崩れる足場だけで難度を作ります
- ポーズ、タブ非表示時の自動ポーズ、ゲームオーバー、リトライ
- localStorage の自己ベスト、Web Share API / X 共有
- ピクセル描画、発射・着地・撃破SE、画面振動、ヒットストップ、粒子演出
- 通常プレイと操作練習モード

仕様の「下方向から弾を命中」は、コンセプトと射撃仕様に合わせて「プレイヤーの真下へ発射した弾が敵に当たる」と解釈しています。深度は 24px = 1m。滞空・着地時間によってプレイ時間が変わります。2〜8分のプレイ時間や深層難易度は継続したプレイテストでの調整対象です。

## 構成・調整

- `src/data/balance.ts`: 初期数値、画面寸法、深度の換算
- `src/data/upgrades.ts`: 強化の効果と候補抽選
- `src/systems/GameModel.ts`: 描画に依存しないゲーム進行・衝突判定
- `src/systems/StageGenerator.ts`: 深度による足場・敵の生成
- `src/systems/Audio.ts`: 外部音源不要の合成SE
- `src/scenes/GameScene.ts`: Phaser 描画、固定刻み更新、演出
- `src/main.ts`: 画面遷移、HUD、キーボード・タッチ入力、保存・共有
- `src/style.css`: 外装とレスポンシブ表示
- `tests/game.test.ts`: コア挙動の回帰テスト

アートはコードで描画しており画像素材は不要です。Google Fonts が利用できない場合はシステムフォントにフォールバックします。

## GitHub Pages

1. GitHub リポジトリに配置し、main ブランチへ push。
2. リポジトリの Settings → Pages → Source を GitHub Actions に設定。
3. 同梱の Deploy to GitHub Pages ワークフローがテスト・ビルド後に公開します。

`base: './'` のためプロジェクトのサブパスにも対応します。この作業では GitHub へのアップロードや公開は行っていません。

## 操作感・生成・フィードバックの調整

練習モードでゲーム横（スマホでは下）の **PHYSICS TUNING** を開くと、重力・単発反動・移動速度・最大落下速度・最大弾数を即時変更できます。RESET は現在の標準値に戻します。値は `deep-drop-practice-physics-v1` に保存され、通常のランや標準設定には反映されません。弾数変更時は消費済みの弾数を維持します。

標準値は引き続き `gravity=900 / shotRecoil=190 / moveSpeed=180 / maxFallSpeed=520 / maxAmmo=6` です。最速連射の反動は約65%まで弱まり、0.34秒以上間隔を空けると単発の全反動に戻ります。上昇を発生させず、連射による滞空を抑える調整です。

難易度は足場の実深度で連続的に変化します。

| 深度 | 足場幅の目安 | 敵・配置 |
| --- | --- | --- |
| 0–100m | 156–194px | 最初の30mは敵なし。その後もノーマルのみ、低密度 |
| 100–300m | 130–180px | 少しずつ敵を増やし、スパイクを低確率から追加 |
| 300–600m | 108–154px | フライを徐々に追加。地上敵との組み合わせ |
| 600m〜 | 最終的に100–124px | タンク・フライ・地上敵の密度を徐々に増加。難化には上限 |

足場の安全側に約60pxの着地・退出用スペースを残し、そこを敵の巡回範囲から外しています。次の安全側へ、標準の重力・最高落下速度・横移動速度で弾なしでも移れる位置だけを採用します。移動予算には0.12秒の反応余裕と14pxの余白を確保。フライはこの移動経路の外を巡回します。チャンク境界でも足場間隔と経路を継続し、左右の壁際も周期的に足場で遮ります。

コンボ倍率は従来どおりです。演出だけを3・5・8・10以上に段階化し、10以降は20まで少しずつ強化。表示の拡大は220ms、粒子は180–400ms、ヒットストップは射撃25ms／踏みつけ42msです。ヒットストップ中も横移動は受け付け、短い射撃入力を最大100ms保持します。被弾した敵を300ms強調し、プレイヤーの点滅と残り無敵時間バーを表示します。無敵時間は1秒のままです。

### ブラウザ再現チェック

開発サーバーで `/tests/browser.html` を開くと、実際のアプリにキーボード長押しを送る確認ボタンと、踏みつけ・コンボ5/8/10/14・被弾・リトライの固定配置ケースを利用できます。「通常のランを開始」と矢印・射撃ボタンは通常生成のランをそのまま操作し、深度やHPを書き換えません。戦闘ケースだけ敵配置を固定します。このHTMLは本番の `dist` に含まれません。

追加テストは `tests/refinement.test.ts`。練習値の分離・保存・RESET、難易度境界、16乱数列×10,000mの配置検査、実衝突処理による無弾着地、壁際の抜け道、連射、入力保持、コンボ段階、被弾元を検証します。

## 休憩・HP・ステージ制への接続

`GameModel.completeSection(uniqueSectionId)` で休憩へ入ります。`upgrades.choices` が確定済みの3候補、`selectUpgrade(id)` は仮選択、`confirmUpgrade()` だけが効果を1回適用して進行を再開します。同一区間のクリア通知を重複しても、候補の再抽選や再取得はできません。休憩中は操作・物理・射撃・敵更新・生成・無敵時間の更新を停止し、HPダメージ／即死も拒否します。HP・残弾・コンボは入場前のままです。

HPの正本は `HealthSystem`。`GameModel.damage(amount, cause)` / `heal(amount)` / `killInstantly(cause)` を入口に利用してください。敵・oxygen・heatなどは通常ダメージ、lavaなどは無敵時間を無視する即死として区別し、最終被弾・死亡原因を記録します。現在はOXYGEN / HEATゲージ自体はありません。追加時はゲームの停止条件とシミュレーション時間を使用し、独立した実時間タイマーを動かさないでください。

FOODはHPを4回復し、超過分を余剰回復へ蓄積。余剰4ごとに最大HPを1増やし、4を消費して残りを保持します。新しい1HPも埋めます（`HEALTH_RULES.fillNewHeart`で変更可）。コンボ報酬は**着地精算**です：8以上でCOIN、15以上でCOIN + MAX CHARGE +1、25以上でCOIN + MAX CHARGE +1 + HP +1。段位は`src/data/combo.ts`の`COMBO_TIERS`にあり、COIN値は暫定です。満タンのHP +1は従来どおり余剰へ回ります。

進行の正本は `StageProgressionSystem`（AREA / SECTION / 4-3後のBOSS遷移 / 1-1へのリセット）、AREA定義は `src/data/areas.ts`。SECTION CLEAR の判定は区間内の `sectionDepth` のみで、`totalDepth` は記録用に累積します。`confirmUpgrade()` が強化を1回適用してから次SECTIONを開始し、プレイヤー位置・速度・カメラ・生成状態をリセット、CHARGEを満タンに補充します。**コンボはSECTION／AREA／BOSS遷移をまたいで維持**されます（休憩は着地ではないため精算しません）。HP・MAX HP・余剰回復・取得強化・スタックはランの状態として引き継ぎ、AREA境界でも初期化しません。生成器には `depthOffset`（= 累積深度）を渡すため、SECTIONごとに地形を作り直しても難易度はラン全体で進みます。`new GameModel(false, random, 'endless')` はSECTION CLEARを止める検証用モードです。

敵は `src/data/enemies.ts` の1テーブルが正本です。`stompable` が踏めるかどうかの唯一の判定材料で、衝突処理は種類を見ずにこのフラグだけを読みます。`silhouette` は描画形状（blob / wing / shell / brute）で、踏めない敵は色ではなく甲羅・トゲ・装甲で区別します。AREAは `enemyPool` で出現する敵を選び、AREA 1は slime / bat / armoredSlime のみです。

SECTIONごとの生成は `AreaConfig.plans` の `SectionPlan`（足場幅・間隔・敵密度・非踏破率・コンボ寄せ・冒頭の無敵区間）で決まります。planを持つAREAでは共有の深度カーブを使わないため、AREA設定とラン全体進行が二重に掛かりません。planを持たないAREA 2〜4は従来どおり `difficultyAt(累積深度)` で生成します。

取得物は `src/data/pickups.ts` の `PICKUP_TYPES` が正本です。`effect`（現在は `oxygen` のみ）で作用が決まり、GameModelは種類ではなく効果で分岐します。敵の `drop` に `PickupKind` を書けばその敵を倒したときに落ちます（BUBBLE FISH が例）。AREA 3のアイスや回復アイテムはここへ1行足すだけで同じ経路に乗ります。

AREA 2の酸素は `src/systems/OxygenSystem.ts` が正本で、`step(dt)` から渡されるシミュレーション時間だけで減ります。HPには触れず「溺れダメージが必要」とだけ返し、GameModelが通常の `damage(1, 'oxygen')` を通します。無敵時間で弾かれたぶんは負債として残り、無敵が切れた瞬間に入るため、無敵で永久に無効化されることはありません。水中物理は `AreaConfig.water`（重力倍率と横入力の追従速度）で、生成側の到達可能性判定 `horizontalReach(gap, water)` にも同じ値が渡ります。

AREA 3のHEATは `src/systems/HeatSystem.ts` が正本です。上昇率はタイマーではなく位置で決まり、`HeatSystem.contribution()` が各熱源の矩形までの距離から `(1 - d/r) ** HEAT_FALLOFF` で寄与を出します。熱源が圏内にあれば ambient + 最大寄与、完全に圏外なら cooling ぶん下がります。HPには触れず「オーバーヒートのダメージが必要」とだけ返し、GameModelが `damage(1, 'heat')` を通します（無敵で弾かれた分は負債として残ります）。

危険物は `src/data/hazards.ts` の `HAZARD_TYPES` が正本です。`lethal` が接触即死かどうかの唯一の判定材料で、溶岩は true、噴出口は false。噴出口は `ventStateAt()` が経過時間から idle → warning → erupting を決める純関数なので、予兆なしに噴火することが構造上ありません。生成側は安全ルートの回廊（前の出口と次の安全着地を結ぶ帯）から必ず外へ置き、致死物は足場の上には一切載りません。

AREA 4の崩壊足場は `src/systems/BreakablePlatformSystem.ts` が正本です。`Platform.breakable` を生成側が決め、着地した瞬間だけシステムがタイマーを開始します。一度始まった崩壊は離れても止まらず、再着地でもリセットされません。状態は `stable / cracking / critical / broken` で、描画と衝突はこの `state` だけを読みます。`EnemyType.onDefeat: 'shatterNearby'`（RUIN BREAKER）は近くの足場へ外部トリガーを送り、**ヒビ済みの足場は即崩壊・未着地の足場はヒビ開始まで**なので、ルート上の未使用足場が不意に消えることはありません。

生成側は `breakableChance` / `breakDelay` / `maxBreakableRun` だけを持ちます。連続する崩壊足場は `maxBreakableRun` で必ず頭打ちになるため、どのシードでも立て直せる通常足場が周期的に現れます。開発用のSECTIONジャンプは `GameModel.jumpToStage(area, section)` / `jumpToBoss()` で、UIは `/tests/browser.html` にのみ置いています（本番の `dist` には出ません）。

定義と上限は `src/data/upgrades.ts`、HPは `src/systems/HealthSystem.ts`、選択トランザクションは `src/systems/UpgradeSystem.ts`、回帰テストは `tests/rest.test.ts` と `tests/stage.test.ts`。

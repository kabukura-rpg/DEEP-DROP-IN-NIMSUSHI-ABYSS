# NIMUSHI BOSS ART SPEC v1

状態：APPROVED（2026-09-21、ユーザー承認）。ASSET GENERATION NOT STARTED。

承認範囲：body / eye overlay / clone・shadeの分離、VISUAL = TWO EYES / GAMEPLAY = ONE WEAK POINT、装飾でcollisionを拡張しない、小型敵は専用spriteにする。PLAYER実ゲームレビュー後の次工程はCHARACTER LOCK PASSとしてIDLE基準sprite 1枚のみ。A/B/C全sheet生成はまだ開始しない。

以下は承認された制作仕様の記録。照合コミット・ゲーム状態の説明は仕様作成時の履歴であり、現行gameplayの変更指示ではない。
照合：feature/downwell-core-fidelity。開始時d7365fb、確認中に外部で6270378へ進んだ（2026-09-21）。差分を読み、本仕様に使うbody/eye寸法・eye anchor・pose・clone/shade分類が変わっていないことを確認した。最終作業ツリーはclean。
Visual reference：ユーザーが提示したNIMUSHI Bossコンセプトボード。PLAYERコンセプト画像は使用しない。

## 1. Scope / identity

制作系統はA：NIMUSHI本体、B：両目overlay、C：nimushiClone/nimushiShadeの3つだけ。

犬型の垂れ耳フード、フードの犬の顔、茶色の巻き髪、人間の顔、茶系衣装、手持ちのタピオカ飲料を維持する。可愛い外形に、静かな執着・疲れた微笑み・暗い紫茶の影で不穏さを加える。フードの目は常に小さく暗い装飾で、人間の目より目立たせない。

正面〜ごく浅い3/4の上半身Boss sprite。大きい耳、髪、両手、小さな飲料カップで形を読む。全身の立ち絵や大型カットインを制作しない。背景なしの新規描き起こしで、参照画像から切り抜かない。左右反転を前提にせず、手持ちカップは原則画面右側。

推奨palette：最大24不透明色＋透明。温かい茶・ベージュ・肌色、深い紫茶の輪郭、少量の暗赤色。OPEN eyeは肌・髪から区別できる明るい色。AA、ぼかし、写真質感、連続グラデーションは使わない。

制作対象外：tapioca projectile / wall、straw beam、telegraph、pressure boundary、background、Giant Cup攻撃体、UI、title、dialogue cut-in。既存procedural drawingを維持する。手持ちの小さい飲料カップとストローは本体の小道具として含むが、新しい攻撃object・独立したカップsheetは作らない。

## 2. 現行gameplayとの接続条件

- 本体collisionは168×112 logical px。
- 単一weak-point regionは60×36 logical px。
- 現在のBoss戦（sign=-1）ではbody中心=(boss.x,boss.y)、body下端=boss.y+56。
- 現在のeyeはx=boss.x-30〜+30、y=boss.y+56〜+92。中心は(boss.x,boss.y+74)。body矩形の幾何学中心ではない。
- 新しい顔の両目をこの既存領域へ合わせる。顔中央を狙う見た目にはするが、判定を顔の見た目へ移動しない。
- VISUAL = TWO EYES。GAMEPLAY = ONE WEAK POINT。瞳ごとの判定、左右別HP、フード弱点を追加しない。
- 本体・弱点の矩形とvisual silhouetteは別物。髪・耳・フード・手・カップの追加輪郭へcollisionを付けない。
- nimushiCloneはshootable=true / stompable=true、nimushiShadeはshootable=true / stompable=false。両方HP1、表示上のbodyWidth=26。実衝突はGameModelの接触/射撃ルートに従い、画像幅から再生成しない。

## 3. A: Body states

フレーム番号は各行内の左から。眼球・瞳・まぶた・眉はbodyへ描かず、同色の肌面を残す。鼻・口・頬はbodyに含む。以下の顔表情はB overlayとの合成結果。

| state | frame数 | body pose | face expression | hand / cup | hair / hood | optional effect（既存再利用のみ） |
|---|---:|---|---|---|---|---|
| dormant | 1 | 肩を落とし、静かに待つ | 眠そうな開眼、淡い微笑み。閉眼は禁止 | カップを胸の右下で抱える | 垂れ耳、髪は下へ落ち着く | 原則なし |
| idle | 2 | 小さい呼吸、片手でカップを支える | プレイヤーを見つめる薄い笑み | ストローを口元へ。両目領域を隠さない | 毛先・耳先がsource 1px程度だけ動く | 必要なら既存の弱点明滅 |
| closed | 1 | 肩・腕を内側へ閉じ、防御的な形 | 両目を閉じ、口を小さく結ぶ | カップを外側へ下げる。顔を覆わない | 耳が前へ落ち、髪が寄る。ただし目の帯は空ける | 新規FXなし |
| cast | 2 | カップ側の肘を上げ、空いた手を開く | 閉眼、口元だけ笑う | カップを画面右上へ。空いた手は召喚を示す | 耳が少し外へ開き、毛先が持ち上がる | 既存cast表示を後で併用可能。sheetには描かない |
| attack | 2 | 空いた手を前下方へ伸ばす。castより開いた形 | 閉眼、口を少し開く | カップは右側、腕の輪郭を明確にする | 毛先・耳が外へ張る | 現行攻撃描画のみ。弾・beamを描かない |
| damage | 1 | 肩を引き、空いた手を短くすくめる | 開眼のまま口元を歪める | カップを保持。落とさない | 耳が反動で跳ねた形 | 実bossHit時だけ短い既存flash。全時間白くしない |
| rage | 2 | 両腕を大きく開き、肩を高くする | 張り詰めた笑み。開始演出中の目は閉じる | カップを高く外側へ保持 | 耳・巻き髪を逆立て、外形を通常と変える | 既存tint等のみ。炎やオーラ画像を追加しない |
| dead | 3 | 腕が下がる→耳と髪が垂れる→力が抜ける | 閉眼、口の力が抜ける | 手の中でカップを傾ける。独立落下させない | 下側へ垂れる。顔anchorは動かさない | 既存の退場fade等。破片・背景を焼き込まない |

計14 body frames。dormant/closed/damageは静止1枚で十分。idle/髪先は4〜6fpsを開始案、cast/attackは状態タイマーへ追従する短い動きとし、アニメーション待ちで攻撃を遅らせない。deadも現在の終了タイミングを変えない。

全フレームで顔・eye anchorは固定。呼吸は肩や服、髪先の差分で表現し、顔だけがweak regionから上下にずれないようにする。deadも腕とフードの崩れで表現する。髪や手がweak regionを隠すポーズは不可。

現在のpose='damage'はopen window中に一度ダメージを受けると継続し得る。1枚の身構えは保持できるが、DAMAGE eyeの白flashは実ヒット時だけの短い表示であり、その間ずっと点滅・閉眼するものではない。

## 4. B: Two-eye overlay

bodyの肌面に重ねる左右一対の人間の目だけを描く。両目は同時に変化する。フードの犬の目はこのsheetに含めない。

| overlay | frames | visual | gameplay上の接続 |
|---|---:|---|---|
| OPEN | 2 | 左右同時に開いた目。明るい白目、小さい赤茶の瞳。2枚とも開眼を維持 | dormant / eyeOpen |
| CLOSED | 1 | 両目の明瞭な閉じ線、落ちたまぶた | eyeClosing / prep / attack / recovery / transition / dead |
| DAMAGE_OPEN | 1 | 開眼輪郭を保つ短い白桃色highlight | 受理された弱点hit直後のみ、その後OPENへ |
| RAGE_OPEN | 2 | 開いた両目、瞳と縁の強い赤桃色highlight | rageActiveかつeyeOpen |
| RAGE_CLOSED | 1 | 閉じ線のまま暗赤い縁。白目や開眼形を見せない | finalRage導入、およびrageActive中の閉眼状態 |

計7 eye frames。RAGEを1種類の開眼画像にしない。eyeOpenがfalseなら見た目も必ず閉眼とする。dormantは最初の射撃で戦闘が始まるためOPENである。

適用順は、dead→CLOSED、eyeOpen=false→CLOSED/RAGE_CLOSED、実hit flash→DAMAGE_OPEN、rageActive→RAGE_OPEN、それ以外→OPEN。DAMAGE flash中にclosedへ移ったら即座に閉眼表示へ切り替える。

発光は目の中・直近の数pixelに限定。独立した周辺オーラや攻撃予告を生成しない。左右それぞれにtarget ringを置かず、両目と眉間を含む顔中央が一つの狙い所として見えるようにする。実regionには目の間も含まれる。

## 5. C: Clone / Shade

Boss画像の縮小禁止。各24×24 source cellを前提とした専用dot絵。犬フード・茶髪・人間の顔・小カップという記号を少数pixelへ整理する。分身の両目はbodyへ含めてよい。Boss用weak-point overlayは使わず、分身にeye弱点を追加しない。

| 種類 | frames | 形 | 顔/色 | gameplay |
|---|---:|---|---|---|
| nimushiClone | 2 | 丸い垂れ耳、柔らかい上縁・下縁、小さい丸い手。棘なし | ベージュ/茶、普通の暗い目、小さな穏やかな表情 | shootable / stompable、既存normal敵 |
| nimushiShade | 2 | 犬フードの共通形＋鋭い棘。上部だけでなく下縁・側面にも角を設ける | 暗い紫茶、赤い目、明るい棘先。暗い背景でも輪郭が消えない | shootable / unstompable、既存分類のまま |

各2枚の微小な髪/耳の揺れだけ。攻撃・召喚の新動作は作らない。HP1のため生存中damage animationを増やさず、被弾・撃破は現行flash/particle/corpse経路を維持する。stomp可否は色を消してもシルエットで見分けられること。棘を増やしてもcollisionは拡大しない。

## 6. Technical spec

logicalは450×800のゲーム内部座標。sourceはassetのpixel格子。v1はsource 1pxをlogical 2pxへnearest-neighborで整数拡大する。レスポンシブなページ上の縮尺まで整数になるという意味ではなく、CSSの最終縮尺は現行と別途確認する。

| 項目 | A: BODY | B: EYE | C: CLONE / SHADE |
|---|---|---|---|
| source cell | 128×112 px | 36×24 px | 各24×24 px |
| logical cell | 256×224 px | 72×48 px | 各48×48 px |
| scale | 2× nearest | 2× nearest | 2× nearest |
| source pivot | (64,40) | (18,12) | (12,12) |
| origin比率 | (0.5, 5/14) | (0.5,0.5) | (0.5,0.5) |
| pivotの接続先 | (boss.x,boss.y) | 現行eye矩形中心 | (enemy.x,enemy.y) |
| transparent padding | セル内各辺2 source px以上 | 各辺2 source px以上 | 各辺2 source px以上 |
| sourceの目安輪郭 | 推奨108×108以内（x=10〜118）。collisionとは別 | 32×20以内。弱点の可視中心は中央 | 20×20以内、中心の体幅13px≒26logical |

RGBA PNG、背景alpha=0。背景色・チェック柄・接地影・光の矩形を入れない。輪郭の半透明AAを避ける。フレームごとのauto-trim禁止、pivot固定。固定グリッドの画像自体にはgutterを追加せず、セル内paddingで分離する。将来atlasへpackする場合のextrusionは別工程。

現在の攻撃側band=0.12／反撃側band=0.28の両位置で確認する。装飾の張り出しが側壁と重なっても顔・両目・攻撃予告を隠さないこと。画面端での余白のためにbody collisionや移動範囲を変えない。

### 弱点anchorの登録

現在のsign=-1について、Aのsource座標では：

- body collisionの参照矩形：(22,12)〜(106,68)。これはガイドであり画像に描かない。
- 単一eye region：(49,68)〜(79,86)。logicalでは60×36。
- eye overlay anchor：(64,77)。logical cellでは(128,154)。
- B overlayの左上はA上の(46,65)。Bの中心(18,12)をAの(64,77)へ合わせる。
- B内の左右の目中心目安：(10,12) / (26,12)。両方を上記単一regionの中へ納める。
- body上の顔の鼻・口はこの帯の下、髪は側面。目の帯は同色の肌面で空ける。

eyeはbody矩形の下側にあるという現コードに合わせて、フードを大きく、顔を低く配置する。顔を上へ動かしたい場合はこのart specの範囲を超えるgameplay判断になるため、今回は行わない。仮に今後signが変わる場合はeye矩形中心を再取得し、現在用assetを無条件に転用しない。

### 手持ちcup anchor

v1では小カップ/ストローをbody各frameへ統合する。独立cup生成はしない。後でレイヤー分離する場合の基準点として、カップ中心のsource座標を次で指定する（logicalは2倍）。

| state | cup center source |
|---|---|
| dormant | (104,91) |
| idle | (92,92) |
| closed | (104,91) |
| cast | (108,64) |
| attack | (108,80) |
| damage | (106,92) |
| rage | (110,65) |
| dead | (106,96) |

小カップの目安16×20 source px。idleのストローは目の帯を横切らず、その下の口へつなぐ。各frameの最終anchorは絵の検品時に記録するが、eye anchorは動かさない。cupの絵・中心に新規collisionはない。

## 7. Sheet arrangement

A：4列×8行、512×896 source px。読み順は左→右、上→下。行順を固定。

| 行 | state | 有効列 | 残り |
|---|---|---|---|
| 1 | dormant | 1 | 2〜4透明 |
| 2 | idle | 1〜2 | 3〜4透明 |
| 3 | closed | 1 | 2〜4透明 |
| 4 | cast | 1〜2 | 3〜4透明 |
| 5 | attack | 1〜2 | 3〜4透明 |
| 6 | damage | 1 | 2〜4透明 |
| 7 | rage | 1〜2 | 3〜4透明 |
| 8 | dead | 1〜3 | 4透明 |

B：2列×5行、72×120 source px。
1 OPEN(2)、2 CLOSED(1)、3 DAMAGE_OPEN(1)、4 RAGE_OPEN(2)、5 RAGE_CLOSED(1)。各1枚行の列2は透明。

C：4列×2行、96×48 source px。
行1 CLONE、行2 SHADE。各行の列1〜2だけ有効。列3〜4は透明。

完成PNGは合計3枚、有効frameは14+7+4=25枚。別JSON/作業仕様へframeCount、row、pivot、eye/cup anchor、scaleを記録し、sprite上へ文字を書かない。今回はJSONもproduct codeへ追加しない。

## 8. Image generation plan / prompts

生成は今後の別作業。予定する生成単位はA/B/C各1sheet＝3枚。モデルの制約や修正が必要な場合は単位を分けて再生成してよいが、初回計画は3単位。ピクセル寸法やフレーム登録は生成だけで保証できないため、生成出力をそのままproduction assetとして扱わない。

まずAを生成・検品して同一キャラクターのmasterを確定。そのAのidleと最初のコンセプトをB/Cへ参照として渡す。B/Cを別の人間・別のフードへ変えない。縮小してCを作ることは禁止。

下記は各単位へ渡す英文prompt。元の画像はidentityの参照であり、絵やレイアウトを切り取る対象ではない。数値は最終pixel-gridの目標。生成サービスが小さな正確サイズを出せない場合は拡大版から後処理で正規化し、単純な補間縮小で済ませない。

### A. NIMUSHI body state sheet

生成数：1sheet、14有効frame。参照：NIMUSHI concept board。

```text
Create an ORIGINAL game-ready pixel-art BODY animation sheet for NIMUSHI, the final boss of DEEP DROP. Use the supplied NIMUSHI concept board ONLY as a visual identity reference. Redraw for a small game sprite; do not crop, trace the poster layout, or reproduce its text or background.

Identity: a cute but unsettling HUMAN woman with brown curled hair, a beige/brown DOG hood with floppy dog ears and a small decorative dog face, warm brown clothing, dark plum-brown shadows, a small handheld bubble-tea cup and straw. She has a human face, not an animal muzzle. The hood's tiny dark eyes are purely decorative and never glow. Front-facing upper-body boss, barely three-quarter, consistent anatomy and costume in every frame. Keep the cup on screen-right. Keep the full silhouette, including hands and cup, within approximately x=10..118 and y=2..110 of each source cell. No legs or full-body portrait are needed.

Render only the BODY, nose, mouth, cheeks, hood, hair, arms, hands and the small personal drink. DO NOT draw human eyeballs, pupils, eyelids, eyelashes or eyebrows. Leave a clean matching skin-colour band for a separately composited pair of human eyes. Do not leave a transparent hole in the face. Do not cover this band with hair, hands, cup or straw.

Final pixel grid: 4 columns by 8 rows. Each cell 128x112 source pixels, total 512x896. All cells have a fixed pivot at (64,40), and the paired-eye overlay will be centred at (64,77). The eye target guide is x=49..79, y=68..86; never draw guides. Keep the face low beneath the large dog hood so the eye registration remains identical in every pose. At least 2 transparent source pixels inside each cell edge. No auto-trimming, no cell borders, no labels, no grid lines. Empty cells must be entirely transparent.

Rows, left to right within each row:
1 DORMANT: 1 frame, shoulders low, small quiet smile, cup held low at the right chest; remaining 3 cells empty.
2 IDLE: 2 frames, tiny shoulder breathing and hair-tip motion, a restrained smile, sipping through a straw below the eye band; last 2 cells empty.
3 CLOSED: 1 frame, protective inward shoulders, restrained mouth, cup lowered outside the face; remaining 3 empty. Human closed eyes will be added separately.
4 CAST: 2 frames, cup raised to screen-right, free hand opening, ears spreading slightly; last 2 empty.
5 ATTACK: 2 frames, free hand reaching forwards and down, mouth slightly open, hair and hood spreading; last 2 empty. NO emitted attack objects.
6 DAMAGE: 1 frame, shoulders recoil and mouth grimaces, keeps holding the cup; remaining 3 empty. No baked-in white flash.
7 RAGE: 2 frames, wider raised shoulders and arms, tense smile, more angular flared hair/ears, cup raised outside the face; last 2 empty. No aura.
8 DEAD: 3 frames, arms weaken, ears and hair droop, final exhausted slack pose. Keep the facial eye anchor fixed and cup in the hand; final cell empty. No dismemberment, particles, ghost or dropped cup.

Crisp intentional pixel clusters, maximum 24 opaque colours plus transparency, hard edges, no anti-aliasing, no blur, no gradients, no painted checkerboard. Real transparent background. Readable silhouette at 2x nearest-neighbour display. No giant attack cup, floating tapioca, projectiles, beams, attack telegraphs, walls, abyss background, UI, title, dialogue, cut-in, logo or watermark. This is a body sheet, not an illustration poster.
```

後処理：顔位置の一致、目の肌面、各frameの縮尺、指・耳・犬フードの一貫性を修正。透明背景、palette、pixel格子、セル境界、空セルを検品。必要に応じて手描きpixel cleanup。cup anchorsを登録。新しいcollisionを作らない。

### B. Eye overlay sheet

生成数：1sheet、7有効frame。参照：Aの確定idleとコンセプト。Aの顔に合う目だけを生成。

```text
Create a pixel-art EYE OVERLAY sheet matching the supplied approved NIMUSHI BODY sprite. Render TWO HUMAN EYES TOGETHER in every active cell, with synchronized expression. They are one paired visual feature for ONE central facial weak-point region. Never create two target markers, independent weak-point icons, a third eye or glowing dog-hood eyes.

Only human eyes, eyelids, lashes and eyebrows, with tiny local pixel highlights. Everything else transparent: no head, no face-shaped skin patch, no hood, no body, no cup. Match the reference face, palette and pixel density. The body underneath already provides the skin.

Final grid: 2 columns by 5 rows. Each cell 36x24 source pixels; total sheet 72x120. Fixed pivot (18,12). Approximate eye centres (10,12) and (26,12). Keep both eyes and all highlights inside a common central 30x18 guide region; do not draw the guide. At least 2 transparent pixels inside every cell edge. Identical eye registration in all frames.

Row 1 OPEN: 2 frames, both eyes visibly open, readable pale whites and dark red-brown pupils; small highlight variation, NOT a blink.
Row 2 CLOSED: 1 frame in the left cell, two unmistakably closed eyelids, no exposed white or open pupils. Right cell transparent.
Row 3 DAMAGE_OPEN: 1 left-cell frame, both eyes still visibly open with a brief white-pink hit highlight. Right cell transparent.
Row 4 RAGE_OPEN: 2 frames, both eyes open, intense crimson-pink pupils and tightly confined hard-pixel highlights. No surrounding aura.
Row 5 RAGE_CLOSED: 1 left-cell frame, two unmistakably closed eyelids with restrained dark-red edging. No open-eye shapes. Right cell transparent.

Real alpha transparency, crisp pixel clusters, no anti-aliasing, blur, gradients, background or checkerboard. No labels, text, cell outlines, UI reticles, projectiles, attack effects or extra facial features. The two-eye pair must composite at the same location on every approved body pose. OPEN and CLOSED must remain readable without relying only on colour.
```

後処理：Aへ全状態を重ねて両目の位置・肌の継ぎ目を確認。左右目の高さ、幅、閉眼線をpixel単位で補正。DAMAGEを半透明の大きな顔パッチにしない。OPEN/RAGE_OPENだけが開眼形を持つことを確認。

### C. Clone / Shade sheet

生成数：1sheet、4有効frame。参照：コンセプトとAのidentity。専用小型spriteとして描き起こす。

```text
Create ORIGINAL tiny pixel-art enemy sprites for DEEP DROP: NIMUSHI CLONE and NIMUSHI SHADE. Use the supplied NIMUSHI references only for identity. Design directly for a 24x24 source-pixel cell. Do NOT shrink, crop or resample the large boss sprite.

Shared identity: little human face under a floppy DOG hood, simplified brown hair, a tiny personal bubble-tea cup, compact readable floating silhouette. The face eyes are part of these small sprites; there is NO separate eye weak point and no target mark.

Final sheet: 4 columns by 2 rows, cells 24x24, total 96x48 source pixels. Pivot (12,12), fixed in every frame. Use only columns 1 and 2 in each row; columns 3 and 4 are completely transparent. At least 2 transparent pixels inside every cell edge. Roughly 13 source pixels for the central body width. Intended display is 2x nearest-neighbour, 48x48 logical canvas.

Row 1 CLONE: 2 gentle idle frames. Soft rounded hood and silhouette, floppy ears, warm beige/brown palette, ordinary dark human eyes, small calm face. Smooth upper AND lower edges, no spikes or sharp crown. This is the normal stompable enemy.

Row 2 SHADE: 2 gentle idle frames. Recognisably the same dog-hood creature, but a dark plum-brown body, sharp silhouette barbs on the crown AND lower/side edges, bright readable thorn tips, small red human eyes. It must read as unsafe to stomp even in grayscale and when approached from below. Do not rely only on red colour. Keep it readable against a dark background; no black-on-black disappearing outline.

No new attack poses, weapon, projectile, glow cloud, smoke, beam, floor, wall, UI, title, labels, grid outlines or watermark. Real alpha transparency, no checkerboard. Crisp hand-authored-looking pixel clusters, no anti-aliasing, gradients or blur. Both variants keep the same central scale and registration. No giant cup or large boss portrait.
```

後処理：実表示48×48と縮小画面で識別性を確認。grayscaleでCLONE/SHADEを判別できるか検品。棘の描画によって既存hitboxを拡大しない。余白・pivot・列3/4の透明を整理する。

## 9. 受入条件

1. A/B/Cの3系統以外を制作していない。
2. Aの14枚すべてでBのanchorが一致し、カップ・髪が目を隠さない。
3. VISUAL TWO EYES / GAMEPLAY ONE REGIONが維持される。目の間も単一領域の一部。
4. dormantは開眼、rage導入は閉眼。閉眼中にopen pupilを残さない。
5. フードの犬の目は装飾として暗く小さい。
6. 8つのbody poseが大きなFXなしで見分けられる。
7. clone/shadeはBossの縮小ではなく、小型専用の絵。stomp可否を輪郭で識別できる。
8. alpha、pixel格子、palette、padding、sheet行列を後処理で保証する。
9. sprite silhouetteからcollisionを生成・拡大しない。
10. 攻撃・移動・hit window・死亡待ち時間をanimation都合で変更しない。

## 10. Repository evidence

- [NIMUSHIのstateと寸法](/Users/shun/Desktop/落ちゲー/src/data/nimushi.ts:43)
- [eyeOpen・pose・body・eye geometry](/Users/shun/Desktop/落ちゲー/src/systems/NimushiBossSystem.ts:99)
- [単一weak-pointのhitTest](/Users/shun/Desktop/落ちゲー/src/systems/NimushiBossSystem.ts:170)
- [既存procedural body/eyes](/Users/shun/Desktop/落ちゲー/src/scenes/GameScene.ts:790)
- [clone/shade分類](/Users/shun/Desktop/落ちゲー/src/data/enemies.ts:103)
- [clone/shade描画](/Users/shun/Desktop/落ちゲー/src/scenes/GameScene.ts:937)

この文書の寸法・枚数・レイアウトは制作提案。既存gameplayの定数変更を意味しない。

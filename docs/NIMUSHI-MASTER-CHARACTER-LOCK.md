# NIMUSHI CHARACTER DESIGN — HUMAN APPROVED / LOCKED

## Latest decision: GAMEPLAY ALIGNMENT B — HUMAN APPROVED / LOCKED

2026-09-22：Humanは「Aだと物理的に近すぎるのでB」を選択し、その後「見えている目を撃ったのに当たらない」違和感も特に感じないと確認した。配置B（renderOffsetY = −16 logical px、上方向16px）を採用する。以下のalignment未承認という記述は、この確認前の履歴。

contact / weak point / physics / camera / MASTERは変更しない。上端空白16pxという測定自体は残るが、Humanの実プレイ評価を優先する。BODY/EYE別offsetによる補正は追加しない。

この確認は配置Bの承認。HIGH/LOWの解像度選択を別途承認したものとは扱わず、全frame制作はまだ開始しない。

## Master approval history

2026-09-22、ユーザー添付 `codex-clipboard-0c670789-eb7b-4fcc-89b3-93f7d94a99de.png` を正式MASTERとして承認。

保存先：`output/nimushi-boss-art-v1/master-alignment-v1/MASTER_NIMUSHI.png`。SHA-256は同ディレクトリmanifest.json。

犬フード、大きい垂れ耳、顔・両目、茶の巻き髪、骨飾り、衣装、タピオカカップ・ストロー、silhouette、palette、cute/unsettling balanceを変更しない。contactに合わせてデザインを描き直す方針を撤回。未コミットのalignment-pass-v1は不採用、今後のreferenceにしない。

MASTER→128×112 source / 256×224 displayの変換と描画配置のみを検討。geometry / physics / cameraは変更禁止。最新A/Bは `output/nimushi-boss-art-v1/master-alignment-v1/README.md`。上端差32→16pxの部分改善。alignment承認はまだ得ていない。

旧specの設計案より本記録を優先。BODY14/EYES7/CLONE/SHADEの制作はalignment承認後。巨大sheetの直接生成はしない。

## Resolution review update

2026-09-22：128×112 sourceは固定仕様ではない。MASTER fidelityを優先し、256×224 source / 同logical displayも比較する。`output/nimushi-boss-art-v1/resolution-review-v1/index.html` とdev専用 `live.html` が最新レビュー。128/256 × 配置A/Bを比較可能。MASTER原画・gameplay geometryは維持。解像度・配置の承認はまだ得ていない。

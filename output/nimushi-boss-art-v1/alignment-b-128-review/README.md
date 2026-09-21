# NIMUSHI IDLE — 128 / alignment B re-export

最新依頼の128×112 / display256×224を維持し、直前にHuman-approved / LOCKEDとなった配置Bを再出力。
既存MASTER由来の128版IDLEをbyte一致で再利用。修正対象は画像の形ではなく描画配置（renderOffsetY=-16）。描き足し・新規image generation・目の独立補正なし。

contact top160、visual top176、差16 logical px。旧配置Aの32pxから半減。contact168×82、weak60×72、両目anchor274、weak Y272–344。矩形全域とsilhouetteの一致を保証するものではない。残る空白と目の縁のずれは前回Human Reviewで違和感なしと確認済み。

plain / nearest enlarged / collision+weak overlay / desktop / mobile / PLAYER比較をindex.htmlへまとめた。再撮影は停止したdevゲームsceneで行い、モデルやgeometryを変えていない。今回product code変更なし、tests/tsc/buildの再実行なし。直前のproduct変更では907/907・tsc/build成功。

MASTER・geometry・physics・camera・main・他作業差分は変更なし。HIGH候補も維持。今回の寸法指定を解像度全体の追加承認とは扱わず、FULL SHEETへは進まない。

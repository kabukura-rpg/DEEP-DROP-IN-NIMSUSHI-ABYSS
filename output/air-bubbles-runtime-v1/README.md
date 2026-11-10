# DEEP DROP · AIR BUBBLES VISUAL DESIGN V1 — Runtime Integration

**判定: DEPLOYED / CLOSED（freeze、2026-11-10）。public baseline `b5becdd`（Pages run 42742780376）。公開検証は [deploy/README.md](deploy/README.md)。Canvas 割当増は PERFORMANCE DEBT として継続、実機 Mobile は未検証。**

- [Integration Report](AIR_BUBBLES_RUNTIME_INTEGRATION_V1.md)
- [Validation Report](AIR_BUBBLES_RUNTIME_VALIDATION_V1.md)
- [Performance Report](AIR_BUBBLES_PERFORMANCE_V1.md)
- [Release Preparation](AIR_BUBBLES_RELEASE_PREP_V1.md)

| フォルダ | 内容 |
|---|---|
| `harness/` | `build-review.mjs`（review build）、`serve.sh`/`serve.mjs`（5641–5645）、`smoke.mjs`、`visual.mjs`、`perf.mjs`、`sustained.mjs`、`alloc-profile.mjs`、`elements-kind.mjs`、`run-rest.sh`。Codex の `review-game.js`・`air-art.js`・audit fixture は byte 同一コピー |
| `builds/` | （commit 対象外、sha256 は `evidence/untracked-artifacts.sha256`）prod-base（公開と同一）、prod-cand、review-codex（Human Review と byte 一致）、review-base、review-cand |
| `evidence/` | test / build ログ、smoke・visual・perf・sustained の生データ、dist sha256 |
| `smoke/` | （commit 対象外）smoke の画面（prod-cand / prod-base × 4構成） |
| `deploy/` | 2026-11-10 の deploy 記録・公開検証 harness（`deploy/harness/`）・証跡。build コピー・公開ファイルの取得物・画像は commit 対象外（sha256 は `deploy/evidence/untracked-artifacts.sha256`） |
| `visual/` | （commit 対象外）renderer × viewport ごとの base / cand 画面と native ×4（Current / Codex A / Integrated A） |

Chrome は harness 専用（port 9640–9642、終了時に profile 削除）。既存の Human Review サーバ（:5397）と他セッションのプロセスは停止していない。

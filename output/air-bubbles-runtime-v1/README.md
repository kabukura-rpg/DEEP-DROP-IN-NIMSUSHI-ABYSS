# DEEP DROP · AIR BUBBLES VISUAL DESIGN V1 — Runtime Integration

**判定: READY FOR DEPLOY REVIEW（Final Human Review: CONDITIONAL GO、2026-11-09）。Canvas 割当増は PERFORMANCE DEBT として許容、実機 Mobile は未検証。未push・未deploy。公開 baseline `5969f37` 維持。**

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
| `visual/` | （commit 対象外）renderer × viewport ごとの base / cand 画面と native ×4（Current / Codex A / Integrated A） |

Chrome は harness 専用（port 9640–9642、終了時に profile 削除）。既存の Human Review サーバ（:5397）と他セッションのプロセスは停止していない。

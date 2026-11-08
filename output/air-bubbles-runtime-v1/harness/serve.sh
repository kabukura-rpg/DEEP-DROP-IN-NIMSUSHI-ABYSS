#!/bin/sh
# serve.sh: the five builds on 5641-5645 (from the worktree root: sh output/air-bubbles-runtime-v1/harness/serve.sh)
D="$(dirname "$0")/../builds"
exec node "$(dirname "$0")/serve.mjs" "$D/prod-base" 5641 "$D/prod-cand" 5642 "$D/review-codex" 5643 "$D/review-base" 5644 "$D/review-cand" 5645

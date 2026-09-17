#!/bin/zsh
# Double-click in Finder, or run ./start.command in Terminal.
cd -- "${0:A:h}" || exit 1
if ! node --version >/dev/null 2>&1; then
  task_node_dir="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
  if [[ -x "$task_node_dir/node" ]]; then
    export PATH="$task_node_dir:$PATH"
  else
    print "Node.js 22.12 以降をインストールしてから再実行してください。"
    exit 1
  fi
fi
if [[ ! -d node_modules ]]; then
  npm ci || exit 1
fi
print "DEEP DROP: 表示された Local URL をブラウザで開いてください。終了は Ctrl+C。"
exec npm run dev

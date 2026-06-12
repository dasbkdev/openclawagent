#!/usr/bin/env bash
set -euo pipefail

node_dir="$(find "$HOME/.local" -maxdepth 1 -type d -name 'node-v24.*-darwin-arm64' | sort -V | tail -n 1)"
if [[ -z "$node_dir" ]]; then
  echo "Node v24 is not installed under $HOME/.local" >&2
  exit 1
fi

export PATH="$node_dir/bin:$PATH"

node --version
corepack --version
corepack enable
corepack prepare pnpm@11.2.2 --activate
pnpm --version

cd "$HOME/agent/openclaw"
chmod +x scripts/package-starlab-mac-dist.sh
git status --short

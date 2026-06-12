#!/usr/bin/env bash
set -euo pipefail

mkdir -p "$HOME/.local/src"
cd "$HOME/.local/src"

file="$(/usr/bin/curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk '/darwin-arm64.tar.xz/ {print $2; exit}')"
if [[ -z "$file" ]]; then
  echo "Node darwin-arm64 archive not found" >&2
  exit 1
fi

dir="${file%.tar.xz}"
if [[ ! -d "$HOME/.local/$dir" ]]; then
  /usr/bin/curl -fLO "https://nodejs.org/dist/latest-v24.x/$file"
  tar -xJf "$file" -C "$HOME/.local"
fi

"$HOME/.local/$dir/bin/node" --version
"$HOME/.local/$dir/bin/corepack" --version
echo "$HOME/.local/$dir/bin"

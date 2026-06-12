#!/usr/bin/env bash
set -euo pipefail

node_dir="$(find "$HOME/.local" -maxdepth 1 -type d -name 'node-v24.*-darwin-arm64' | sort -V | tail -n 1)"
export PATH="$node_dir/bin:$PATH"

cd "$HOME/agent/openclaw"

export ALLOW_ADHOC_SIGNING=1
export SKIP_NOTARIZE=1
export SKIP_DSYM=1
export BUILD_ARCHS=arm64
export SKIP_PNPM_INSTALL=1

pnpm install --frozen-lockfile --config.node-linker=hoisted --fetch-timeout=600000 --network-concurrency=4
pnpm starlab:mac:package

ls -lh dist/OpenClaw.app dist/*.dmg 2>/dev/null || true

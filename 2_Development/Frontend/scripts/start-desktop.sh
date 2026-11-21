#!/bin/sh
set -eu

frontend_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$frontend_dir"

exec node scripts/desktop-dev.mjs

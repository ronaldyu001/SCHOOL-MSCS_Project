#!/bin/sh
set -eu

frontend_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$frontend_dir"

if ! command -v docker >/dev/null 2>&1 && [ "$(uname -s)" = Darwin ]; then
    for docker_dir in "${HOME:-}/.docker/bin" "/Applications/Docker.app/Contents/Resources/bin"; do
        if [ -x "$docker_dir/docker" ]; then
            PATH="$docker_dir:$PATH"
            export PATH
            break
        fi
    done
fi

if ! command -v docker >/dev/null 2>&1; then
    printf '%s\n' 'Docker CLI not found. Install Docker and add its CLI directory to PATH.' >&2
    exit 1
fi

exec node scripts/desktop-dev.mjs

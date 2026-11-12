#!/bin/sh
set -eu

frontend_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$frontend_dir"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is unavailable. Start Docker Desktop, then retry." >&2
  exit 1
fi

# Vite serves the desktop UI; the Compose frontend would conflict on port 5173.
docker compose -f ../Deployment/docker-compose.yaml up -d --build --wait backend qdrant

# Containers remain available after the desktop app closes.
exec npm run dev

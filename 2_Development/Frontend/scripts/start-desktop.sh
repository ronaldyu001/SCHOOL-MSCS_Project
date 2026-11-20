#!/bin/sh
set -eu

frontend_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$frontend_dir"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is unavailable. Start Docker Desktop, then retry." >&2
  exit 1
fi

start_services() {
  set -- -f ../Deployment/docker-compose.yaml
  gpu_override=../Deployment/docker-compose.gpu.yaml
  docker compose "$@" build backend

  # Probe with the same image and GPU reservation the backend would use.
  if docker compose "$@" -f "$gpu_override" run --rm --no-deps -T backend \
    python -c 'import sys; import torch; sys.exit(0 if torch.cuda.is_available() else 1)' \
    >/dev/null 2>&1; then
    echo "CUDA available. Starting the backend with GPU access."
    set -- "$@" -f "$gpu_override"
  else
    echo "CUDA unavailable. Starting the backend in CPU mode."
  fi

  docker compose "$@" up -d --wait backend qdrant
}

# Start Vite while Docker builds so Tauri can load the window promptly.
start_services &
exec npm run dev -- --host 127.0.0.1 --port 5174 --clearScreen false

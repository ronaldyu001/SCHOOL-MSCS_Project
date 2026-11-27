# Memory Query Rewriter

Run the research console, Python API, and Qdrant database from a fresh clone.

## 1. Install prerequisites

- [Git](https://git-scm.com/downloads).
- [Node.js 24](https://nodejs.org/en/download) (includes npm).
- [Rust](https://rustup.rs/) **1.90 or newer**, including Cargo.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (includes Docker Compose). Start it before launching the app. On Linux, Docker Engine with the Compose plugin also works.
- [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/): macOS needs Xcode Command Line Tools (`xcode-select --install`); Linux needs the build tools and WebKit/GTK libraries listed for your distribution. Windows needs Visual Studio C++ Build Tools and WebView2; use the browser option below for the stack's Unix-based launcher.

Restart your terminal after installation. Ensure `git`, `node`, `npm`, `rustc`,
`cargo`, and `docker` are on your `PATH`. If Rust or Docker is not found on
macOS/Linux, add their installed locations to your shell profile (e.g. `~/.zshrc`):

```sh
export PATH="$HOME/.cargo/bin:$HOME/.docker/bin:$PATH"
```

Docker Desktop on macOS also provides its CLI in
`/Applications/Docker.app/Contents/Resources/bin`; add that directory if needed.
Check that `node --version`, `rustc --version`, `docker compose version`, and
`docker info` succeed. Internet access and free disk space are needed for the
initial dependency, image, and model downloads.

## 2. Clone and install frontend dependencies

```sh
git clone https://github.com/ronaldyu001/SCHOOL-MSCS_Project.git
cd SCHOOL-MSCS_Project/2_Development/Frontend
npm install
```

## 3. Launch the desktop stack

From `2_Development/Frontend`, run:

```sh
npm run tauri dev
```

The desktop window opens, and the launcher starts Vite, the backend, and Qdrant.
Allow several minutes for the first build. Python dependencies are installed
inside Docker; no local Python or `.env` setup is required for this route.
The API is available at [localhost:8000/docs](http://localhost:8000/docs).
Stop with **Ctrl+C** in the terminal; the launcher cleans up services it started.

## 4. Load the benchmark data

In **Set up benchmark data**, use `/data/locomo10.json`. The file is included in
the clone at `2_Development/.data/locomo10.json`; Docker maps that folder to
`/data`. Saved datasets and training runs go to `2_Development/.artifacts`;
Qdrant data and downloaded models persist in Docker volumes.

**Optional Apple GPU:** install native ARM64 Python 3.12+ and follow the
[backend's MPS setup](2_Development/Backend/README.md#use-the-apple-gpu-on-macos)
before launching. Otherwise, the Docker backend uses CPU, or CUDA when available.

## Browser option (Docker only)

Only Git and Docker with Compose are required. After cloning, run these commands
from the repository root; Docker installs the Node and Python dependencies:

```sh
cd 2_Development/Deployment
docker compose up --build -d
```

Open [localhost:5173](http://localhost:5173) once the containers are ready, then
follow step 4. Stop from the same directory with `docker compose down`.

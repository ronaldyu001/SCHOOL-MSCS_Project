# Frontend

Console for the Memory Query Rewriter harness. React 19 + TypeScript + Vite, no UI
framework — the design system in `src/styles/` and `src/components/ui/` is the whole
dependency surface beyond React and the router.

## Commands

```bash
npm install
npm run dev          # Vite on :5173, proxying /api to the backend on :8000
npm run build        # tsc -b && vite build
npm run preview      # serve the production build locally
npm run typecheck    # types only
npm run lint         # eslint, including the React compiler rules
npm run format       # prettier --write over src
```

The backend has to be running for anything on the pipeline, retrieval, rewards or
training pages to work. Either:

```bash
docker compose -f ../Deployment/docker-compose.yaml up
```

or run it directly from `../Backend` with `uvicorn main:app --reload`. If it is not up,
the header shows **API DOWN** and the page says what to start.

To point the dev server at a backend somewhere else, set `BACKEND_URL` before
`npm run dev`.

## Desktop development

With Docker Desktop running, use `npx tauri dev` (or `npm run tauri dev`).
The Tauri dev hook runs `scripts/start-desktop.sh`. It starts desktop Vite on
port 5174 while Docker Compose builds and starts the backend and Qdrant.
The desktop can open while the API is still starting. Browser development uses
port 5173.
It adds the GPU Compose override if a test container can use CUDA. Otherwise it
starts the backend in CPU mode.
Rust and the platform's Tauri build prerequisites must be installed.
The dev launcher stops and removes the containers it started when Tauri exits,
including after an app crash. It keeps the Qdrant and model cache volumes.
The backend image is built at each launch, and Compose picks up image changes.
If the backend or Qdrant was already running when Tauri opened, it stays up
when the desktop closes.
This hook is for development; packaged apps do not start Docker automatically.

## Sections

| Route | What it drives | Backend routes |
| --- | --- | --- |
| `/` | Load LoCoMo, split by conversation, prepare the partitions, index into Qdrant | `POST /data/load`, `/data/{id}/splits`, `/data/{id}/prepare`, `/data/{id}/index` |
| `/retrieval` | Ask a question, compare it against the rewriter's versions, and read an answer out of what came back | `POST /retrieval/search`, `POST /model/rewrite`, `POST /model/answer`, `GET /data/prepared/{id}/questions` |
| `/rewards` | The four scorers, and a small probe of one of them | `GET /rewards`, `POST /training/reward-datasets` |
| `/training` | Build training data for any subset of R0–R3 and download it in the command-line builder's file layout | `POST /training/reward-datasets`, `GET /data/prepared`, `GET /model/info` |
| `/evaluation` | Not built. Renders its proposal scope; the backend has no evaluation use case yet | — |

The pipeline's state lives in the shell (`AppShell` calls `usePipeline`, passing it
through the router's outlet context) rather than inside the pipeline page, because the
ids it produces are what the later sections run against: retrieval needs a conversation
id from the indexed partition and the reward build needs the prepared id. A page that
owned that state would drop it the moment the user navigated to the section consuming
it. Those ids also live in backend app state, so every harness page offers what the
backend still holds (`GET /data/prepared`) as a fallback for a browser reload, and the
conversation-id field stays typeable because the Qdrant collection outlives both.

### Keeping the screens quiet

An earlier version of these pages explained the method next to every control. It read
like documentation and buried the two or three things you actually came to do. The rules
now:

- **Three fields, then a button.** A search needs a conversation and a question. Depth,
  context sizes, sampling and model overrides all have working defaults and live under
  *Options*.
- **Hide what you cannot use.** A pipeline step that is blocked shows why, not a form
  that does nothing. A finished one folds its form away so the result is what you see.
- **One line, not a paragraph.** Panels get a short description only when the title is
  not enough. Fields get a hint only when it stops a mistake.
- **Plain words where there is one.** "Memories to pull", not "retrieval depth".
  "Context size", not "token budget". Terms the project is actually about — the scorer
  names, recall — stay.

Three things survived the cut because they are honest rather than decorative: `/training`
says in one line that nothing trains a model yet, the scorers report what they threw out
as well as what they kept, and `MetricBar` prints every value as text so no reading
depends on a bar's width.

## Startup gate

The desktop window opens the moment Vite is serving, which on a cold start is many
minutes before Compose has built an image and started a container. `BootGate` wraps the
router in `src/main.tsx`, so nothing — not even the 404 page — renders until the stack
behind it can serve.

It waits on two independent sources, because neither alone is enough:

| Source | Knows | Blind to |
| --- | --- | --- |
| `GET /boot` — the desktop launcher's feed | Docker, the image build, the GPU probe, the containers | whether the API inside them works |
| `GET /api/ready` — the API itself | whether it is serving and can reach Qdrant | anything before its own container existed |

Both have to agree. A warm backend left over from a previous session answers `/ready`
immediately, but the launcher is on its way to recreating that container with a freshly
built image — handing over then would drop the user into a console whose backend is
about to restart underneath it.

The launcher starts `scripts/boot-status.mjs` on a local port and passes its URL to
Vite. Vite forwards `/boot` to that feed. Plain `npm run dev`, or an unavailable
feed, returns a 503 JSON response and the frontend falls back to API readiness.
Under nginx, `/boot` falls through to `index.html`, so the frontend checks the
content type before parsing.

The gate **never times out on its own**: a first desktop build downloads PyTorch, and
treating that as a failure would be wrong. Two things can end the wait early —

- the launcher reporting a failed phase, which shows the error and a retry;
- 45 seconds elapsing, which adds *Open the console anyway*. Without it, anyone running
  `npm run dev` with no backend would be locked out of their own UI indefinitely. The
  button says plainly that every request will fail.

`index.html` also carries a small inline splash inside `#root`, replaced as soon as
React mounts, so the desktop window is never a blank rectangle while the bundle loads.
It is inline because a stylesheet request would defeat the point.

## One API origin everywhere

The browser always calls `/api/...`, in every environment:

| Environment | What serves `/api` |
| --- | --- |
| `npm run dev` | the Vite proxy in `vite.config.ts`, rewriting to `http://localhost:8000` |
| docker-compose | nginx in `nginx.conf`, proxying to `http://backend:8000` |

`/boot` reports container progress through Vite during desktop development.
See **Startup gate**.

So the base URL is never environment-dependent, requests stay same-origin, and CORS
never enters the picture. `VITE_API_BASE` can override it if a deployment ever needs an
absolute URL.

## Layout

```
src/
  app/          persistent chrome and routing — AppShell, router, route table,
                and BootGate, the startup gate in front of all of it
  components/ui/ design-system primitives; no project knowledge in here
  features/     one folder per feature:
                  pipeline/  the four dataset phases
                  retrieval/ search, budget sweep, packed context, reader
                  rewards/   catalogue, winner rule, reward build (hook + panels)
                  training/  the full build, plus JSONL/manifest export
                  harness/   the frozen-configuration panel, shared by the above
  lib/          API client, formatters, hooks that are not feature-specific
  styles/       tokens.css (the design system) and base.css (element defaults)
```

Imports use the `@/` alias for `src/` (`vite.config.ts` + `tsconfig.app.json`), so
moving a file does not rewrite a chain of `../../..`.

### Routing

`src/app/routes.ts` is the single source of truth. The navigator, the router and the
planned-section pages all read that one array, so a section cannot exist in the menu
and not in the router. Each entry carries a `status`: `built` renders its real page,
`planned` renders `PlannedPage` with the scope taken from the proposal. The navigator
marks planned sections with a hollow dot, which keeps it honest about what exists.

To add a section: add an entry to `ROUTES`, and if it is `built`, point the router at
its page component.

## Design system

Everything visual comes from `src/styles/tokens.css`. No component hard-codes a colour,
a font size or a spacing value.

**Four depths, and depth is carried by background plus a 1px border, not by stacked
shadows:**

| Token | Used for |
| --- | --- |
| `--canvas` | the page behind everything |
| `--raised` | panels sitting on the canvas |
| `--sunken` | wells recessed into a panel — where measured values live |
| `--overlay` | sticky chrome |

The rule the pipeline page follows: **controls sit on raised surfaces, results sit on
sunken ones.** That is what lets a reader tell an input from an output at a glance.

**Colour has two jobs and they never mix.** `--accent` is the one interactive/brand hue.
The semantic trio `--running` / `--done` / `--failed` is reserved for pipeline state.
State is always rendered with colour *and* a glyph *and* a word, so it survives
greyscale and colour blindness.

**Type.** System sans for prose, `--mono` for every number, identifier, path and model
name, always with tabular figures so values do not jitter as they change.

Dark mode is the OS preference unless the user pins a theme; `useTheme` writes
`data-theme` on `<html>` and `tokens.css` treats its absence as "follow the system".

### Styling

CSS Modules, colocated with the component (`Panel.tsx` + `Panel.module.css`). Scoped by
default, no runtime, no class-name soup in the markup, and it keeps the token layer as
the only global CSS. Inline `style` is only for a computed value — a flex basis derived
from a proportion, for instance.

## Conventions

**State.** Pick the smallest thing that works. The pipeline uses a `useReducer` in
`usePipeline.ts` because the four phases chain — each hands an id to the next — and the
reducer is where the invalidation rule lives: **running a phase clears every phase after
it**, since the backend holds those ids in its own app state and a stale downstream
result would describe something that no longer exists. That rule is the reason this is a
reducer and not four `useState`s.

Single requests outside the pipeline use `lib/useAsyncRun.ts`, which is the same four
states with a generation counter: a run the user has superseded cannot overwrite the
newer one's result when it finally returns.

**Data fetching.** `lib/api.ts` mirrors the FastAPI routes one-to-one. It flattens
FastAPI's two `detail` shapes (a string from `HTTPException`, a list from request
validation) into one sentence, and turns a bare gateway status into a message that says
the backend is not running rather than "502". Anything that loads or runs a model has no
timeout — indexing, rewriting, answering, searching and the reward build all run
synchronously on CPU behind a process lock, and the first call also downloads weights.

**Every async surface shows all four states** — idle, running, complete, failed. A phase
that cannot run yet says *why* instead of presenting a dead button.

**Accessibility is part of done, not a pass afterwards:**

- `Field.tsx` owns label/hint/error wiring, so no caller can forget `aria-describedby`.
- One `:focus-visible` treatment, defined once in `base.css`.
- Each phase has a polite live region announcing its outcome; the running timer is kept
  out of it so screen readers are not read a counter.
- Disclosures are `<details>`, so expand/collapse, keyboard support and in-page find all
  come from the platform.
- `prefers-reduced-motion` is honoured globally.

**Before calling a change done:** `npm run lint && npm run build`, then look at the page
at 375px and 1280px, in both themes, with the backend both up and down.

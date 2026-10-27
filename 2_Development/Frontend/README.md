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

The backend has to be running for anything on the pipeline page to work. Either:

```bash
docker compose -f ../Deployment/docker-compose.yaml up
```

or run it directly from `../Backend` with `uvicorn main:app --reload`. If it is not up,
the header shows **API DOWN** and the page says what to start.

To point the dev server at a backend somewhere else, set `BACKEND_URL` before
`npm run dev`.

## One API origin everywhere

The browser always calls `/api/...`, in every environment:

| Environment | What serves `/api` |
| --- | --- |
| `npm run dev` | the Vite proxy in `vite.config.ts`, rewriting to `http://localhost:8000` |
| docker-compose | nginx in `nginx.conf`, proxying to `http://backend:8000` |

So the base URL is never environment-dependent, requests stay same-origin, and CORS
never enters the picture. `VITE_API_BASE` can override it if a deployment ever needs an
absolute URL.

## Layout

```
src/
  app/          persistent chrome and routing — AppShell, router, route table
  components/ui/ design-system primitives; no project knowledge in here
  features/     one folder per feature; `pipeline/` owns the four dataset phases
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

**Data fetching.** `lib/api.ts` mirrors the FastAPI routes one-to-one. It flattens
FastAPI's two `detail` shapes (a string from `HTTPException`, a list from request
validation) into one sentence, and turns a bare gateway status into a message that says
the backend is not running rather than "502". Indexing deliberately has no timeout: the
first run downloads the encoder and embeds on CPU behind a process lock.

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

/**
 * Publishes the desktop launcher's startup progress for the loading screen.
 *
 * The window opens as soon as Vite is serving, which is long before Compose
 * has built an image and started a container. Only the launcher knows what is
 * happening in that gap, so it reports here and Vite forwards `/boot` to this
 * server (see vite.config.ts).
 *
 * Nothing else may depend on this being up. Plain `npm run dev` has no
 * launcher, and the Compose deployment serves the built frontend through
 * nginx, which does not proxy `/boot` at all — in both cases the loading
 * screen falls back to polling the API's own readiness.
 */

import { createServer } from 'node:http'

/** The launcher's phases, in the order they run. */
const STEPS = [
  { id: 'docker', label: 'Docker engine', pending: 'Waiting to check Docker' },
  { id: 'build', label: 'Backend runtime', pending: 'Waiting to prepare the backend' },
  { id: 'gpu', label: 'Compute device', pending: 'Waiting to check GPU support' },
  { id: 'services', label: 'Backend and Qdrant', pending: 'Waiting to start' },
]

const state = {
  source: 'desktop-launcher',
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  phase: 'starting',
  error: null,
  steps: STEPS.map((step) => ({
    id: step.id,
    label: step.label,
    status: 'pending',
    detail: step.pending,
  })),
}

function step(id) {
  return state.steps.find((item) => item.id === id)
}

/** Mark a step active, and everything before it done. */
export function begin(id, detail) {
  const index = state.steps.findIndex((item) => item.id === id)
  state.steps.forEach((item, position) => {
    if (position < index && item.status === 'active') item.status = 'done'
  })
  const current = step(id)
  if (current) {
    current.status = 'active'
    if (detail) current.detail = detail
  }
  state.phase = id
  state.updatedAt = new Date().toISOString()
}

export function finish(id, detail) {
  const current = step(id)
  if (current) {
    current.status = 'done'
    if (detail) current.detail = detail
  }
  state.updatedAt = new Date().toISOString()
}

export function progress(id, detail) {
  const current = step(id)
  if (current && current.status === 'active' && detail) {
    current.detail = detail
    state.updatedAt = new Date().toISOString()
  }
}

/** Everything is up; the loading screen may hand over to the app. */
export function ready() {
  for (const item of state.steps) {
    if (item.status !== 'failed') item.status = 'done'
  }
  state.phase = 'ready'
  state.error = null
  state.updatedAt = new Date().toISOString()
}

export function fail(message) {
  const active = state.steps.find((item) => item.status === 'active')
  if (active) {
    active.status = 'failed'
    active.detail = message
  }
  state.phase = 'failed'
  state.error = message
  state.updatedAt = new Date().toISOString()
}

/**
 * Reduce a chunk of Docker output to the last meaningful line.
 *
 * BuildKit redraws progress with carriage returns and ANSI cursor moves, so
 * the raw tail of the stream is mostly control codes. What survives is the
 * line a person would read — "Downloading torch (885 MB)" — which is the whole
 * point of showing it.
 */
export function lastLine(chunk) {
  const text = String(chunk)
    .replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\r/g, '\n')
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const line = lines.at(-1)
  if (!line) return null
  return line.length > 160 ? `${line.slice(0, 159)}…` : line
}

/**
 * Serve the state on the loopback interface only.
 *
 * Let the OS pick a port unless BOOT_STATUS_PORT is set. Return the bound
 * address before Vite starts so it connects to this session's feed.
 */
export async function serve(port = Number(process.env.BOOT_STATUS_PORT ?? 0)) {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    response.end(JSON.stringify(state))
  })
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
  } catch (error) {
    console.error(`Boot status server unavailable: ${error.message}`)
    return null
  }
  server.unref()
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => server.close(),
  }
}

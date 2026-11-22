import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as boot from './boot-status.mjs'

const compose = ['compose', '-f', '../Deployment/docker-compose.yaml']
const gpuOverride = '../Deployment/docker-compose.gpu.yaml'
const owner = `com.ms-project.desktop-session=${randomUUID()}`

function launcherPids() {
  const ancestors = []
  let pid = process.ppid
  while (pid > 1 && !ancestors.includes(pid)) {
    ancestors.push(pid)
    try {
      pid = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }))
    } catch {
      break
    }
  }
  return ancestors
}

function start(command, args, output = 'inherit', onLine, env = process.env) {
  // 'tee' keeps Docker's output on the terminal and reports each line to the
  // loading screen; 'pipe' captures stdout for the caller as before.
  const piped = output === 'pipe' || output === 'tee'
  const stdio = piped ? ['ignore', 'pipe', 'pipe'] : ['ignore', output, output]
  const child = spawn(command, args, { detached: true, stdio, env })
  let stdout = ''
  let stderr = ''
  if (piped) {
    child.stdout.on('data', (chunk) => { stdout += chunk })
    if (output === 'tee') child.stdout.pipe(process.stdout, { end: false })
    if (output === 'tee') child.stderr.on('data', (chunk) => { stderr += chunk })
    child.stderr.pipe(process.stderr, { end: false })
    if (onLine) {
      for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', (chunk) => {
          const line = boot.lastLine(chunk)
          if (line) onLine(line)
        })
      }
    }
  }
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve({ code, stdout, stderr }))
  })
  return { child, done }
}

function signalGroup(job, signal) {
  if (job?.child.pid) {
    try {
      process.kill(-job.child.pid, signal)
    } catch (error) {
      if (error.code !== 'ESRCH') console.error(error.message)
    }
  }
}

async function checked(job, message) {
  const { code, stdout } = await job.done
  if (code !== 0) throw new Error(message)
  return stdout
}

let dockerJob
let viteJob
let stopping = false
let mayHaveContainers = false
let overrideDirectory
let exitCode = 0
const stopRequested = Promise.withResolvers()

function requestStop(code = 0) {
  if (stopping) return
  stopping = true
  exitCode = code
  signalGroup(dockerJob, 'SIGINT')
  signalGroup(viteJob, 'SIGTERM')
  stopRequested.resolve()
}

async function startupCommand(args, output = 'inherit', onLine) {
  if (stopping) throw new Error('Desktop is shutting down.')
  const job = start('docker', args, output, onLine)
  dockerJob = job
  try {
    return await job.done
  } finally {
    dockerJob = undefined
  }
}

async function startServices() {
  boot.begin('docker', 'Asking the Docker engine for its status.')
  const info = await startupCommand(['info'], 'ignore')
  if (info.code !== 0) throw new Error('Docker is unavailable. Start Docker Desktop, then retry.')
  boot.finish('docker', 'Docker is running.')

  const active = await startupCommand(
    [...compose, 'ps', '--status', 'running', '--status', 'restarting',
      '--status', 'paused', '--services'],
    'pipe',
  )
  if (active.code !== 0) throw new Error('Could not check which Compose services are running.')
  const running = new Set(active.stdout.split(/\s+/))
  const ownedServices = ['backend', 'qdrant'].filter((service) => !running.has(service))

  console.log('Building the desktop backend.')
  boot.begin('build', 'Building the backend image. A first build downloads PyTorch and can take a while.')
  const build = await startupCommand(
    [...compose, 'build', 'backend'],
    'tee',
    (line) => boot.progress('build', line),
  )
  if (build.code !== 0) {
    const output = `${build.stdout}\n${build.stderr}`
    const registryUnavailable = output.includes('failed to resolve source metadata') &&
      /registry-1\.docker\.io[^\r\n]*(?:timeout|no such host|connection refused|network is unreachable)/i.test(output)
    if (!registryUnavailable) throw new Error('Could not build the desktop backend.')

    const config = await startupCommand([...compose, 'config', '--format', 'json'], 'pipe')
    if (config.code !== 0) throw new Error('Docker Hub is unreachable and the local backend image could not be checked.')
    const project = JSON.parse(config.stdout)
    const backendImage = project.services.backend.image ?? `${project.name}-backend`
    const cached = await startupCommand(['image', 'inspect', backendImage], 'ignore')
    if (cached.code !== 0) {
      throw new Error('Docker Hub is unreachable and no local backend image is available. Restore the connection and retry.')
    }
    const message = 'Docker Hub is unreachable. Using the last built backend image.'
    console.warn(message)
    boot.finish('build', message)
  } else {
    boot.finish('build', 'Image ready.')
  }

  mayHaveContainers = true
  boot.begin('gpu', 'Checking whether this host can give the container a GPU.')
  const gpu = await startupCommand(
    [...compose, '-f', gpuOverride, 'run', '--pull', 'never', '--rm', '--no-deps', '-T',
      '--label', owner, 'backend', 'python', '-c',
      'import sys; import torch; sys.exit(0 if torch.cuda.is_available() else 1)'],
    'ignore',
  )
  const files = [...compose]
  if (gpu.code === 0) files.push('-f', gpuOverride)
  if (!stopping) console.log(gpu.code === 0 ? 'Starting backend with CUDA.' : 'Starting backend on CPU.')
  boot.finish('gpu', gpu.code === 0 ? 'CUDA available; the backend will use the GPU.' : 'No CUDA; the backend will run on CPU.')

  if (ownedServices.length) {
    // Only label services that were inactive at launch. A running backend can
    // receive the new image without becoming owned by the desktop.
    overrideDirectory = mkdtempSync(join(tmpdir(), 'ms-project-desktop-'))
    const override = join(overrideDirectory, 'compose.json')
    writeFileSync(override, JSON.stringify({
      services: Object.fromEntries(ownedServices.map((service) => [
        service, { labels: [owner], restart: 'no' },
      ])),
    }))
    files.push('-f', override)
  }

  const services = running.has('qdrant') ? ['backend'] : ['backend', 'qdrant']
  boot.begin('services', `Starting ${services.join(' and ')}, then waiting for the health check.`)
  const up = await startupCommand(
    [...files, 'up', '-d', '--no-build', '--no-deps', '--wait', ...services],
    'tee',
    (line) => boot.progress('services', line),
  )
  if (up.code !== 0) throw new Error('Could not start the desktop services.')
  boot.finish('services', 'Containers are up and healthy.')
  // The window still confirms this against the API's own /ready before it
  // shows the app: Compose reporting healthy and the API being able to reach
  // Qdrant are two different claims.
  boot.ready()
}

async function stopServices() {
  if (!mayHaveContainers) return
  const found = await checked(
    start('docker', ['ps', '-aq', '--filter', `label=${owner}`], 'pipe'),
    'Could not find the containers started by the desktop.',
  )
  const ids = found.trim().split(/\s+/).filter(Boolean)
  if (!ids.length) return
  await checked(start('docker', ['stop', ...ids]), 'Could not stop the desktop containers.')
  await checked(start('docker', ['rm', ...ids]), 'Could not remove the desktop containers.')
}

const ancestors = launcherPids()
const watchLauncher = setInterval(() => {
  for (const pid of ancestors) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error.code === 'ESRCH') requestStop()
    }
  }
}, 500)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => requestStop())
}

const bootStatus = await boot.serve()
const startup = startServices().catch((error) => {
  if (!stopping) {
    boot.fail(error.message)
    console.error(error.message)
    requestStop(1)
  }
})
if (!stopping) {
  viteJob = start(
    'npm',
    ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5174', '--clearScreen', 'false'],
    'inherit',
    undefined,
    { ...process.env, BOOT_STATUS_URL: bootStatus?.url ?? '' },
  )
}
viteJob?.done.then(
  ({ code }) => requestStop(code ?? 1),
  (error) => {
    console.error(error.message)
    requestStop(1)
  },
)

await stopRequested.promise
clearInterval(watchLauncher)
try {
  // Let Compose finish cancelling startup before looking for containers to remove.
  await startup
  await stopServices()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  bootStatus?.close()
  if (overrideDirectory) rmSync(overrideDirectory, { recursive: true, force: true })
}
process.exitCode ||= exitCode

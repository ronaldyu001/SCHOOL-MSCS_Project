import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

// Exercise the actual API client without a browser or another test framework.
const source = readFileSync(
  new URL('../src/lib/api.ts', import.meta.url),
  'utf8',
).replace('import.meta.env.VITE_API_BASE', 'undefined')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { buildRewardDatasets, findRewardBuild, watchRewardBuild, deleteArtifact } =
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
  )
const input = { preparedId: 'prepared', rewards: ['r0'], tokenBudget: 512 }
const running = {
  id: 'build-id',
  status: 'running',
  attempted: { r0: 0 },
  result: null,
}
const result = { results: [{ reward: 'r0', dataset_id: 'dataset-id' }] }
const completed = { ...running, status: 'completed', result }

async function withResponses(responses, run) {
  const originalFetch = globalThis.fetch
  const originalTimeout = globalThis.setTimeout
  const originalStorage = globalThis.localStorage
  const saved = new Map()
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  }
  const calls = []
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options })
    assert.ok(responses.length, 'unexpected request')
    const next = responses.shift()
    return new Response(next.body, { status: next.status ?? 200 })
  }
  globalThis.setTimeout = (callback, ms, ...args) =>
    originalTimeout(callback, ms === 2000 ? 0 : ms, ...args)
  try {
    await run(calls)
  } finally {
    globalThis.localStorage = originalStorage
    globalThis.fetch = originalFetch
    globalThis.setTimeout = originalTimeout
  }
}
const json = (value) => ({ body: JSON.stringify(value) })

test('empty, null, HTML and malformed initial responses explain the failure', async () => {
  for (const response of [
    { body: '' },
    json(null),
    { body: '<html>proxy</html>' },
    json({}),
  ]) {
    await withResponses([response, json({ job: null })], async (calls) => {
      await assert.rejects(
        buildRewardDatasets(input, () => {}),
        /backend returned.*(response|status)/i,
      )
      assert.ok(calls.length <= 2)
    })
  }
})
test('polling recovers from a missing response without starting a duplicate build', async () => {
  await withResponses([json(running), json(null), json(completed)], async (calls) => {
    assert.deepEqual(await buildRewardDatasets(input, () => {}), result)
    assert.equal(calls.filter((c) => c.options.method === 'POST').length, 1)
    assert.equal(JSON.parse(calls[0].options.body).token_budget, 512)
  })
})
test('polling stays attached through a prolonged connection outage', async () => {
  await withResponses(
    [json(running), json(null), json(null), json(null), json(completed)],
    async (calls) => {
      assert.deepEqual(await buildRewardDatasets(input, () => {}), result)
      assert.equal(calls.length, 5)
    },
  )
})
test('completion requires a dataset result and cancellation returns null', async () => {
  await withResponses([json({ ...completed, result: null })], async () => {
    await assert.rejects(
      buildRewardDatasets(input, () => {}),
      /invalid dataset build status/,
    )
  })
  await withResponses([json({ ...running, status: 'cancelled' })], async () => {
    assert.equal(await buildRewardDatasets(input, () => {}), null)
  })
})
test('validation errors retain the backend explanation', async () => {
  await withResponses(
    [
      {
        status: 422,
        body: JSON.stringify({
          detail: [{ loc: ['body', 'token_budget'], msg: 'must be at most 8192' }],
        }),
      },
    ],
    async () => {
      await assert.rejects(
        buildRewardDatasets(input, () => {}),
        /token_budget: must be at most 8192/,
      )
    },
  )
})

test('discovers an existing build after reload without posting', async () => {
  await withResponses([json({ job: running }), json(completed)], async (calls) => {
    const job = await findRewardBuild()
    assert.equal(job.id, running.id)
    assert.deepEqual(await watchRewardBuild(job, () => {}), result)
    assert.ok(calls.every((call) => call.options.method === 'GET'))
    assert.equal(globalThis.localStorage.getItem('memory-rewriter.reward-build'), null)
  })
})
test('restores a remembered completion and forgets stale IDs after a backend restart', async () => {
  await withResponses([json(completed)], async () => {
    globalThis.localStorage.setItem('memory-rewriter.reward-build', running.id)
    const job = await findRewardBuild()
    assert.equal(job.status, 'completed')
    assert.deepEqual(await watchRewardBuild(job, () => {}), result)
  })
  await withResponses(
    [
      { status: 404, body: '{"detail":"Reward build not found."}' },
      json({ job: null }),
    ],
    async () => {
      globalThis.localStorage.setItem('memory-rewriter.reward-build', running.id)
      assert.equal(await findRewardBuild(), null)
      assert.equal(
        globalThis.localStorage.getItem('memory-rewriter.reward-build'),
        null,
      )
    },
  )
})
test('a start conflict reattaches to existing work', async () => {
  await withResponses(
    [
      { status: 409, body: '{"detail":"Build in progress"}' },
      json({ job: running }),
      json(completed),
    ],
    async (calls) => {
      assert.deepEqual(await buildRewardDatasets(input, () => {}), result)
      assert.equal(calls.filter((call) => call.options.method === 'POST').length, 1)
    },
  )
})

test('successful artifact deletion accepts the empty HTTP 204 response', async () => {
  await withResponses([{ status: 204, body: null }], async (calls) => {
    await deleteArtifact('datasets', 'dataset-id')
    assert.equal(calls[0].options.method, 'DELETE')
  })
})

test('restored benchmark preparation is recognized without a previous reward artifact', async () => {
  const benchmarkSource = readFileSync(
    new URL('../src/features/pipeline/benchmark.ts', import.meta.url),
    'utf8',
  )
  const benchmarkCode = ts
    .transpileModule(benchmarkSource, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    })
    .outputText.replace(
      "'@/lib/api'",
      `'data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}'`,
    )
  const { isPreparedBenchmark } = await import(
    `data:text/javascript;base64,${Buffer.from(benchmarkCode).toString('base64')}`
  )
  const benchmark = JSON.parse(
    readFileSync(
      new URL(
        '../../Backend/infrastructure/benchmarks/locomo-signal-v1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const handle = {
    prepared_id: 'restored',
    partitions: { train: { indexed: true } },
    provenance: {
      corpus_sha256: benchmark.corpus_sha256,
      split: benchmark.split,
      categories: benchmark.categories,
    },
  }
  assert.equal(isPreparedBenchmark(handle, benchmark), true)
  assert.equal(
    isPreparedBenchmark(
      { ...handle, partitions: { train: { indexed: false } } },
      benchmark,
    ),
    false,
  )
  assert.equal(
    isPreparedBenchmark(
      { ...handle, provenance: { ...handle.provenance, corpus_sha256: 'different' } },
      benchmark,
    ),
    false,
  )
})

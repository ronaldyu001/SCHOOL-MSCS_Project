/*
 * Typed client for the Memory Rewriter API.
 *
 * Every response type here mirrors a return value in
 * Backend/presentation/routes_dataset.py. Keep them in step: the insight panels
 * report these fields verbatim, so a drifted type shows up as a blank metric
 * rather than a crash, which is easy to miss.
 */

const BASE = import.meta.env.VITE_API_BASE ?? '/api'

/** LoCoMo question categories, as mapped in infrastructure/dataset/locomo_adapter.py. */
export const QA_CATEGORIES = [
  'single_hop',
  'multi_hop',
  'temporal',
  'open_domain',
  'adversarial',
] as const

export type QACategory = (typeof QA_CATEGORIES)[number]

export const PARTITIONS = ['train', 'validation', 'test'] as const

export type Partition = (typeof PARTITIONS)[number]

export type LoadDatasetResponse = {
  dataset_id: string
  conversation_count: number
  qa_count: number
  conversation_ids: string[]
}

export type CreateSplitResponse = {
  dataset_id: string
  split_id: string
  seed: number
  train_conversation_ids: string[]
  validation_conversation_ids: string[]
  test_conversation_ids: string[]
}

export type PartitionCounts = {
  conversation_count: number
  qa_count: number
}

export type PrepareDatasetResponse = {
  dataset_id: string
  split_id: string
  prepared_id: string
  validation_status: string
  categories: QACategory[] | null
  partitions: Record<Partition, PartitionCounts>
}

export type IndexDatasetResponse = {
  dataset_id: string
  prepared_id: string
  partition: Partition
  conversation_count: number
  indexed_memory_count: number
  collection: string
  embedding_model: string
  embedding_revision: string
  vector_size: number
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type FastApiValidationIssue = {
  loc?: (string | number)[]
  msg?: string
}

/**
 * FastAPI reports `detail` as a string for raised HTTPExceptions and as a list
 * of issues for request-validation failures. Flatten both into one sentence so
 * the UI never shows `[object Object]`.
 */
function readDetail(body: unknown, status: number): string {
  if (typeof body !== 'object' || body === null || !('detail' in body)) {
    // A gateway status with no body is the proxy answering, not the API: in
    // development that is the Vite proxy when nothing is listening on 8000, and
    // in the container it is nginx when the backend is not up yet. A bare
    // "status 502" sends people looking in the wrong place.
    return status === 502 || status === 503 || status === 504
      ? 'No response from the backend. The proxy is up but nothing answered on port 8000 — check that the API is running.'
      : `Request failed with status ${status}.`
  }
  const { detail } = body as { detail: unknown }
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const issues = (detail as FastApiValidationIssue[])
      .map((issue) => {
        const field = issue.loc?.filter((part) => part !== 'body').join('.')
        return field ? `${field}: ${issue.msg ?? 'invalid'}` : (issue.msg ?? 'invalid')
      })
      .filter(Boolean)
    if (issues.length > 0) return issues.join('; ')
  }
  return `Request failed with status ${status}.`
}

type RequestOptions = {
  /** Milliseconds before the request is aborted. Omit to wait indefinitely. */
  timeoutMs?: number
}

async function request<T>(
  path: string,
  init: RequestInit,
  { timeoutMs }: RequestOptions = {},
): Promise<T> {
  const controller = new AbortController()
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { ...init, signal: controller.signal })
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError(`The backend did not respond within ${timeoutMs}ms.`, 0)
    }
    throw new ApiError('Could not reach the backend. Is it running on port 8000?', 0)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(readDetail(body, response.status), response.status)
  }
  return body as T
}

function postJson<T>(path: string, payload: unknown, options?: RequestOptions) {
  return request<T>(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options,
  )
}

export function checkHealth() {
  return request<{ status: string }>('/health', { method: 'GET' }, { timeoutMs: 4000 })
}

export function loadDataset(path: string) {
  return postJson<LoadDatasetResponse>('/data/load', { path }, { timeoutMs: 60_000 })
}

export type CreateSplitInput = {
  trainSize: number
  validationSize: number
  testSize: number
  seed: number
}

export function createSplit(datasetId: string, input: CreateSplitInput) {
  return postJson<CreateSplitResponse>(
    `/data/${encodeURIComponent(datasetId)}/splits`,
    {
      train_size: input.trainSize,
      validation_size: input.validationSize,
      test_size: input.testSize,
      seed: input.seed,
    },
    { timeoutMs: 30_000 },
  )
}

export function prepareDataset(
  datasetId: string,
  input: { splitId: string; categories: QACategory[] | null },
) {
  return postJson<PrepareDatasetResponse>(
    `/data/${encodeURIComponent(datasetId)}/prepare`,
    { split_id: input.splitId, categories: input.categories },
    { timeoutMs: 60_000 },
  )
}

export function indexDataset(
  datasetId: string,
  input: { preparedId: string; partition: Partition; batchSize: number },
) {
  // No timeout: the first call downloads the encoder and embeds on CPU, and the
  // backend serialises indexing behind a lock, so this legitimately runs long.
  return postJson<IndexDatasetResponse>(
    `/data/${encodeURIComponent(datasetId)}/index`,
    {
      prepared_id: input.preparedId,
      partition: input.partition,
      batch_size: input.batchSize,
    },
  )
}

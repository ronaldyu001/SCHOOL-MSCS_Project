/*
 * Typed client for the Memory Rewriter API.
 *
 * Every response type here mirrors a return value in Backend/presentation:
 * routes_dataset, routes_model, routes_retrieval, routes_rewards,
 * routes_reward_datasets, routes_training, routes_evaluation and routes_system. Keep them in step: the insight panels
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

export type DatasetSplit = {
  train_conversation_ids: string[]
  validation_conversation_ids: string[]
  test_conversation_ids: string[]
}

export type CreateSplitResponse = DatasetSplit & {
  dataset_id: string
  split_id: string
  seed: number
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

  if (response.status === 204) return undefined as T

  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(readDetail(body, response.status), response.status)
  }
  if (body === null) {
    throw new ApiError(
      `The backend returned an empty or invalid JSON response for ${path}. Check the API connection and backend logs.`,
      502,
    )
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

/* ------------------------------------------------------------------ *
 * System
 * ------------------------------------------------------------------ */

export type MemorySnapshot = {
  total_bytes: number
  available_bytes: number
}

export function getSystemMemory() {
  return request<MemorySnapshot>(
    '/system/memory',
    { method: 'GET' },
    { timeoutMs: 6000 },
  )
}

/* ------------------------------------------------------------------ *
 * Dataset handles the backend still holds
 * ------------------------------------------------------------------ */

export type PreparedPartition = PartitionCounts & {
  conversation_ids: string[]
  indexed?: boolean
  turn_count?: number
}

export type PreparedHandle = {
  prepared_id: string
  dataset_id: string | null
  provenance?: DatasetProvenance
  partitions: Record<Partition, PreparedPartition>
}

/**
 * Prepared handles and provenance are restored from the durable backend
 * workspace. Each partition reports whether its Qdrant index is verified.
 */
export function listPrepared() {
  return request<PreparedHandle[]>(
    '/data/prepared',
    { method: 'GET' },
    { timeoutMs: 10_000 },
  )
}

/* ------------------------------------------------------------------ *
 * The frozen harness: reader model, encoder, collection
 * ------------------------------------------------------------------ */

export type ModelInfo = {
  default_model_id: string
  default_revision: string
  loaded_model_id: string | null
  loaded_revision: string | null
  context_window: number | null
  llm_device: string
  embedding_model: string
  embedding_revision: string
  embedding_device: string
  embedding_max_length: number
  embedding_query_instruction: string
  qdrant_collection: string
  index_batch_size: number
  dataset_split_seed: number
  rewrite_prompt_version: string
}

export function getModelInfo() {
  return request<ModelInfo>('/model/info', { method: 'GET' }, { timeoutMs: 10_000 })
}

export type Checkpoint = {
  modelId?: string | null
  revision?: string | null
}

function checkpoint({ modelId, revision }: Checkpoint = {}) {
  return {
    model_id: modelId?.trim() ? modelId.trim() : null,
    revision: revision?.trim() ? revision.trim() : null,
  }
}

export type GenerateResponse = { text: string }

export function generateText(
  input: Checkpoint & {
    prompt: string
    maxNewTokens: number
    temperature: number
    seed?: number | null
  },
) {
  // No timeout on anything that generates: the first call downloads the
  // checkpoint and decoding runs on CPU by default.
  return postJson<GenerateResponse>('/model/generate', {
    ...checkpoint(input),
    prompt: input.prompt,
    max_new_tokens: input.maxNewTokens,
    temperature: input.temperature,
    seed: input.seed ?? null,
  })
}

export type TokenCountResponse = {
  token_count: number
  context_window: number | null
  max_new_tokens: number
  fits: boolean
  characters: number
}

export function countTokens(
  input: Checkpoint & { text: string; maxNewTokens?: number },
) {
  return postJson<TokenCountResponse>('/model/tokens', {
    ...checkpoint(input),
    text: input.text,
    max_new_tokens: input.maxNewTokens ?? 0,
  })
}

export type RewriteResponse = {
  prompt: string
  prompt_version: string
  queries: string[]
  requested: number
  model_id: string
  revision: string | null
}

export function rewriteQuery(
  input: Checkpoint & {
    text: string
    inputId: string
    seed: number
    count: number
    temperature: number
    maxNewTokens: number
  },
) {
  return postJson<RewriteResponse>('/model/rewrite', {
    ...checkpoint(input),
    text: input.text,
    input_id: input.inputId,
    seed: input.seed,
    count: input.count,
    temperature: input.temperature,
    max_new_tokens: input.maxNewTokens,
  })
}

export type AnswerResponse = {
  answer: string | null
  fits: boolean
  skip_reason: string | null
  abstained: boolean
  context_tokens: number
  context_window: number | null
}

export function answerQuestion(
  input: Checkpoint & { question: string; context: string; maxNewTokens: number },
) {
  return postJson<AnswerResponse>('/model/answer', {
    ...checkpoint(input),
    question: input.question,
    context: input.context,
    max_new_tokens: input.maxNewTokens,
  })
}

/* ------------------------------------------------------------------ *
 * Retrieval and budget harness
 * ------------------------------------------------------------------ */

export type MemoryMatch = {
  rank: number
  memory_id: string
  session_id: number
  source_turn_ids: string[]
  timestamp: string
  text: string
  score: number
  expected: boolean
}

export type BudgetResult = {
  token_budget: number
  included_count: number
  tokens_used: number
  context: string
  source_turn_ids: string[]
  evidence_recall: number | null
}

export type QueryResult = {
  index: number
  query: string
  match_count: number
  top_score: number | null
  first_expected_rank: number | null
  matches: MemoryMatch[]
  budgets: BudgetResult[]
}

export type SearchResponse = {
  conversation_id: string
  collection: string
  embedding_model: string
  vector_size: number
  context_window: number | null
  top_k: number
  token_budgets: number[]
  expected_turn_ids: string[]
  eligible_turn_count: number | null
  results: QueryResult[]
  selected_index: number | null
  selected_score: number | null
  selection_note: string
}

export function searchMemories(
  input: Checkpoint & {
    conversationId: string
    queries: string[]
    topK: number
    tokenBudgets: number[]
    expectedTurnIds?: string[]
    eligibleTurnIds?: string[] | null
  },
) {
  return postJson<SearchResponse>('/retrieval/search', {
    ...checkpoint(input),
    conversation_id: input.conversationId,
    queries: input.queries,
    top_k: input.topK,
    token_budgets: input.tokenBudgets,
    expected_turn_ids: input.expectedTurnIds ?? [],
    eligible_turn_ids: input.eligibleTurnIds ?? null,
  })
}

/* ------------------------------------------------------------------ *
 * Reward bank
 * ------------------------------------------------------------------ */

export const REWARD_IDS = ['r0', 'r1', 'r2', 'r3'] as const

export type RewardId = (typeof REWARD_IDS)[number]

export type RewardDef = {
  id: RewardId
  title: string
  summary: string
  signal: string
  label_free: boolean
  needs_questions: boolean
  needs_evidence_labels: boolean
  skip_reasons: string[]
}

export function listRewards() {
  return request<RewardDef[]>('/rewards', { method: 'GET' }, { timeoutMs: 10_000 })
}

export type SelectResponse = {
  index: number | null
  score: number | null
  tied_winners: number
  reason: string | null
}

export function selectRewrite(scores: number[]) {
  return postJson<SelectResponse>('/rewards/select', { scores }, { timeoutMs: 10_000 })
}

export type EvidenceResponse = {
  recall: number
  expected_count: number
  matched_turn_ids: string[]
}

export function scoreEvidence(expectedTurnIds: string[], actualTurnIds: string[]) {
  return postJson<EvidenceResponse>(
    '/rewards/evidence',
    { expected_turn_ids: expectedTurnIds, actual_turn_ids: actualTurnIds },
    { timeoutMs: 10_000 },
  )
}

/* ------------------------------------------------------------------ *
 * Candidate factory: reward datasets
 * ------------------------------------------------------------------ */

export type TrainingExample = {
  prompt: string
  completion: string
}

export type InputOutcome = {
  input_id: string
  candidate_count: number
  skip_reason: string | null
  winning_score: number | null
  top_ties: number
  tied_score?: number | null
  kept_all_one_tie?: boolean
}

export type RewardResult = {
  reward: RewardId
  dataset_id: string
  attempted: number
  kept: number
  skipped: Record<string, number>
  tied_winners: number
  kept_all_one_ties?: number
  examples: TrainingExample[]
  outcomes: InputOutcome[]
}

export type RewardBuildSettings = {
  seed: number
  candidates: number
  temperature: number
  rewrite_max_tokens: number
  top_k: number
  token_budget: number
  max_inputs_per_reward: number | null
  keep_all_one_ties?: boolean
  answer_max_tokens: number
  r2_prior_turns: number
  r3_max_tokens: number
}

export type RewardDatasetResponse = {
  prepared_id: string
  partition: Partition
  conversation_count: number
  qa_count: number
  collection: string
  model_id: string
  model_revision: string | null
  embedding_model: string
  rewrite_prompt_version: string
  reward_pipeline_version: number
  settings: RewardBuildSettings
  results: RewardResult[]
  elapsed_seconds: number
}

export type RewardBuildInput = Checkpoint & {
  preparedId: string
  rewards: RewardId[]
  maxInputsPerReward: number | null
  keepAllOneTies: boolean
  seed: number
  candidates: number
  temperature: number
  rewriteMaxTokens: number
  topK: number
  tokenBudget: number
  answerMaxTokens: number
  r2PriorTurns: number
  r3MaxTokens: number
}

export type RewardBuildProgress = Partial<Record<RewardId, number>>

export type RewardBuildStatus = {
  id: string
  attempted: RewardBuildProgress
} & (
  | { status: 'running' | 'cancelling' | 'cancelled' | 'saving'; result: null }
  | { status: 'completed'; result: RewardDatasetResponse }
)

export type RewardBuildUpdate = Pick<RewardBuildStatus, 'id' | 'status' | 'attempted'>

function validateRewardBuildStatus(job: RewardBuildStatus): RewardBuildStatus {
  if (
    !job ||
    typeof job !== 'object' ||
    typeof job.id !== 'string' ||
    !job.id ||
    !['running', 'cancelling', 'cancelled', 'saving', 'completed'].includes(
      job.status,
    ) ||
    !job.attempted ||
    typeof job.attempted !== 'object' ||
    (job.status === 'completed' && (!job.result || !Array.isArray(job.result.results)))
  ) {
    throw new ApiError(
      'The backend returned an invalid dataset build status. Check that the frontend and backend are running the same version.',
      502,
    )
  }
  return job
}

export function cancelRewardBuild(id: string) {
  return request<RewardBuildStatus>(
    `/rewards/builds/${encodeURIComponent(id)}/cancel`,
    { method: 'POST' },
    { timeoutMs: 10_000 },
  )
}

const REWARD_JOB_KEY = 'memory-rewriter.reward-build'

function rememberRewardBuild(id: string | null) {
  try {
    if (id) localStorage.setItem(REWARD_JOB_KEY, id)
    else localStorage.removeItem(REWARD_JOB_KEY)
  } catch {
    /* Storage may be unavailable; server discovery still works. */
  }
}

export async function findRewardBuild(): Promise<RewardBuildStatus | null> {
  let remembered: string | null = null
  try {
    remembered = localStorage.getItem(REWARD_JOB_KEY)
  } catch {
    /* optional */
  }
  if (remembered) {
    try {
      return validateRewardBuildStatus(
        await request<RewardBuildStatus>(
          `/rewards/builds/${encodeURIComponent(remembered)}`,
          { method: 'GET' },
          { timeoutMs: 15_000 },
        ),
      )
    } catch (error) {
      if (error instanceof ApiError && error.status === 503) rememberRewardBuild(null)
      if (!(error instanceof ApiError) || error.status !== 404) throw error
      rememberRewardBuild(null)
    }
  }
  const response = await request<{ job: RewardBuildStatus | null }>(
    '/rewards/builds',
    { method: 'GET' },
    { timeoutMs: 15_000 },
  )
  if (response.job == null) return null
  const job = validateRewardBuildStatus(response.job)
  rememberRewardBuild(job.id)
  return job
}

export async function watchRewardBuild(
  initial: RewardBuildStatus,
  onProgress: (progress: RewardBuildUpdate) => void,
  signal?: AbortSignal,
) {
  let job = validateRewardBuildStatus(initial)
  rememberRewardBuild(job.id)
  while (!signal?.aborted) {
    const { id, status, attempted } = job
    onProgress({ id, status, attempted })
    if (status === 'completed' || status === 'cancelled') {
      rememberRewardBuild(null)
      return job.result
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
    if (signal?.aborted) break
    try {
      job = validateRewardBuildStatus(
        await request<RewardBuildStatus>(
          `/rewards/builds/${encodeURIComponent(id)}`,
          { method: 'GET' },
          { timeoutMs: 15_000 },
        ),
      )
    } catch (error) {
      // Network/proxy outages do not end the server job. Keep following it.
      if (error instanceof ApiError && [0, 502, 504].includes(error.status)) continue
      if (error instanceof ApiError && [404, 503].includes(error.status))
        rememberRewardBuild(null)
      throw error
    }
  }
  return null
}

export async function buildRewardDatasets(
  input: RewardBuildInput,
  onProgress: (progress: RewardBuildUpdate) => void,
  signal?: AbortSignal,
) {
  let job: RewardBuildStatus
  try {
    job = await postJson<RewardBuildStatus>(
      '/rewards/builds',
      {
        ...checkpoint(input),
        prepared_id: input.preparedId,
        rewards: input.rewards,
        max_inputs_per_reward: input.maxInputsPerReward,
        keep_all_one_ties: input.keepAllOneTies,
        seed: input.seed,
        candidates: input.candidates,
        temperature: input.temperature,
        rewrite_max_tokens: input.rewriteMaxTokens,
        top_k: input.topK,
        token_budget: input.tokenBudget,
        answer_max_tokens: input.answerMaxTokens,
        r2_prior_turns: input.r2PriorTurns,
        r3_max_tokens: input.r3MaxTokens,
      },
      { timeoutMs: 10_000 },
    )
  } catch (error) {
    // A conflict or lost POST response may mean a job already exists.
    if (error instanceof ApiError && [0, 409, 502, 504].includes(error.status)) {
      const existing = await findRewardBuild()
      if (existing) return watchRewardBuild(existing, onProgress, signal)
    }
    throw error
  }
  return watchRewardBuild(job, onProgress, signal)
}

export type ArtifactKind = 'datasets' | 'runs' | 'evaluations'
export type ArtifactMetadata = { name: string; notes: string }

type SavedArtifact = ArtifactMetadata & {
  id: string
  reward: RewardId
  created_at: string
  dataset_sha256: string
}

type BenchmarkEmbedding = {
  embedding_model: string
  embedding_revision: string
  embedding_max_length: number
  embedding_query_instruction: string
  embedding_device: string
  memory_format_version: number
}

export type DatasetProvenance = Partial<BenchmarkEmbedding> & {
  partition?: Partition
  corpus_sha256?: string | null
  split?: DatasetSplit
  split_seed?: number
  categories?: QACategory[] | null
  model_id?: string
  model_revision?: string | null
  prepared_id?: string
  train_conversation_ids?: string[]
  settings?: Partial<RewardBuildSettings>
  reward_pipeline_version?: number
  rewrite_prompt_version?: string
}

export type SavedRewardDataset = SavedArtifact & {
  build_id: string
  row_count: number
  summary: Pick<RewardResult, 'attempted' | 'skipped' | 'kept_all_one_ties'>
  provenance: DatasetProvenance
}

type RunStatus = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted'

type ModelRuntime = {
  platform?: string
  architecture?: string
  torch_version?: string
  base_weight_dtype?: string
  mixed_precision?: string
  gpu_name?: string
  gpu_total_memory_bytes?: number
}

export type TrainingRuntime = ModelRuntime & { training_device?: string }

export type TrainingRunSettings = {
  seed: number
  epochs: number
  learning_rate: number
  batch_size: number
  gradient_accumulation_steps: number
  max_length: number
  lora_rank: number
  lora_alpha: number
}

export type TrainingRun = SavedArtifact & {
  dataset_id: string
  model_id: string
  model_revision: string | null
  requested_revision: string | null
  status: RunStatus
  settings: TrainingRunSettings
  dataset_provenance?: DatasetProvenance
  adapter_sha256?: Record<string, string>
  runtime?: TrainingRuntime
  progress: { phase?: string; step?: number; total_steps?: number; loss?: number }
  metrics: Record<string, number>
  error: string | null
}

const artifactPaths: Record<ArtifactKind, string> = {
  datasets: '/rewards/datasets',
  runs: '/training/runs',
  evaluations: '/evaluation/runs',
}

function artifactPath(kind: ArtifactKind, id: string) {
  return `${artifactPaths[kind]}/${encodeURIComponent(id)}`
}

export function listSavedRewardDatasets() {
  return request<SavedRewardDataset[]>(
    artifactPaths.datasets,
    { method: 'GET' },
    { timeoutMs: 10_000 },
  )
}

export function listTrainingRuns() {
  return request<TrainingRun[]>(
    artifactPaths.runs,
    { method: 'GET' },
    { timeoutMs: 10_000 },
  )
}

/**
 * Every knob `TrainingSettingsRequest` accepts, with the bounds its dataclass
 * enforces. Mirrored here so the form can state them and reject a value before
 * a round trip rather than after — keep them in step with
 * application/use_cases/training/training_run.py.
 *
 * All but the learning rate must be whole numbers: the backend checks the type
 * as well as the range, so 2.5 epochs is a 422 rather than a rounding.
 */
export type TrainingSettings = {
  seed: number
  epochs: number
  learningRate: number
  batchSize: number
  gradientAccumulationSteps: number
  maxLength: number
  loraRank: number
  loraAlpha: number
}

export const TRAINING_DEFAULTS: TrainingSettings = {
  seed: 123,
  epochs: 1,
  learningRate: 0.0002,
  batchSize: 1,
  gradientAccumulationSteps: 4,
  maxLength: 512,
  loraRank: 8,
  loraAlpha: 16,
}

export const TRAINING_LIMITS: Record<keyof TrainingSettings, [number, number]> = {
  seed: [0, 2 ** 32 - 1],
  epochs: [1, 20],
  // Exclusive at the bottom; the form uses a step small enough to express it.
  learningRate: [0, 1],
  batchSize: [1, 32],
  gradientAccumulationSteps: [1, 128],
  maxLength: [32, 32768],
  loraRank: [1, 256],
  loraAlpha: [1, 512],
}

export function startTrainingRun(
  input: Checkpoint & {
    datasetId: string
    settings: TrainingSettings
    name?: string
    notes?: string
  },
) {
  const { settings } = input
  return postJson<TrainingRun>(
    artifactPaths.runs,
    {
      ...checkpoint(input),
      dataset_id: input.datasetId,
      settings: {
        seed: settings.seed,
        epochs: settings.epochs,
        learning_rate: settings.learningRate,
        batch_size: settings.batchSize,
        gradient_accumulation_steps: settings.gradientAccumulationSteps,
        max_length: settings.maxLength,
        lora_rank: settings.loraRank,
        lora_alpha: settings.loraAlpha,
      },
      name: input.name || undefined,
      notes: input.notes || undefined,
    },
    { timeoutMs: 10_000 },
  )
}

export function updateArtifact(
  kind: ArtifactKind,
  id: string,
  metadata: ArtifactMetadata,
) {
  return request<SavedRewardDataset | TrainingRun | EvaluationRun>(
    artifactPath(kind, id),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    },
    { timeoutMs: 10_000 },
  )
}

export function deleteArtifact(kind: ArtifactKind, id: string) {
  return request<void>(
    artifactPath(kind, id),
    { method: 'DELETE' },
    { timeoutMs: 10_000 },
  )
}

export function artifactDownloadUrl(kind: ArtifactKind, id: string) {
  return `${BASE}${artifactPath(kind, id)}/download`
}

/* ------------------------------------------------------------------ *
 * Held-out signal evaluation
 * ------------------------------------------------------------------ */

export type EvaluationMode = 'pilot' | 'official'
export type EvaluationCategory = QACategory | 'all'
export type EvaluationVariant =
  'raw' | 'prompted' | RewardId | 'gold_query' | 'best_of_three'

export type EvaluationBenchmark = {
  version: string
  corpus_sha256: string
  split: DatasetSplit
  split_seed: number
  seeds: number[]
  categories: QACategory[]
  model_id: string
  model_revision: string
  embedding: BenchmarkEmbedding
  reward_pipeline_version: number
  rewrite_prompt_version: string
  top_k: number
  token_budgets: number[]
  build: Omit<RewardBuildSettings, 'seed' | 'keep_all_one_ties'> & {
    keep_all_one_ties: boolean
  }
  training: Omit<TrainingRunSettings, 'seed'>
  hardware: {
    training_device: string
    base_weight_dtype: string
    mixed_precision: string
    target_vram_gib: number
  }
}

type EvaluationMetrics = {
  mean_recall: number
  mean_tokens_used: number
  mean_first_hit_rank: number | null
  miss_rate: number
  blank_rewrites: number
  delta_vs_raw: number
  delta_vs_prompted: number
  recall_vs_r0?: number | null
  r0_gain_recovered?: number | null
}

type EvaluationScoreGroup = EvaluationMetrics & {
  variant: EvaluationVariant
  category: EvaluationCategory
  budget: number
}

export type EvaluationSeedResult = EvaluationScoreGroup & {
  seed: number
  questions: number
}

export type EvaluationCurve = EvaluationScoreGroup & {
  questions_per_seed: number
  seeds: number
} & {
  [Metric in keyof EvaluationMetrics as `${Metric}_seed_std`]: number | null
} & {
  [Metric in keyof EvaluationMetrics as `${Metric}_seed_count`]: number
}

export type EvaluationSummary = {
  excluded_questions: Partial<Record<QACategory, Record<string, number>>>
  per_seed: EvaluationSeedResult[]
  curves: EvaluationCurve[]
  failure_overlap: {
    seed: number
    category: EvaluationCategory
    budget: number
    zero_recall: Record<string, number>
  }[]
  rewrite_similarity: {
    seed: number
    category: EvaluationCategory
    variants: [Exclude<RewardId, 'r0'>, Exclude<RewardId, 'r0'>]
    questions: number
    exact_match_rate: number
    mean_token_jaccard: number
  }[]
}

type EvaluationAdapterSource = {
  run_id: string
  dataset_id: string
  dataset_sha256: string
  adapter_sha256: Record<string, string>
  model_id: string
  model_revision: string
  training_settings: TrainingRunSettings
  training_runtime: TrainingRuntime
  dataset_provenance: DatasetProvenance
}

export type EvaluationRun = ArtifactMetadata & {
  id: string
  status: RunStatus
  created_at: string
  updated_at: string
  error: string | null
  mode: EvaluationMode
  partition: 'validation' | 'test'
  pilot_limit: number | null
  benchmark: EvaluationBenchmark
  adapters: Partial<Record<number, Record<RewardId, EvaluationAdapterSource>>>
  progress: {
    phase?: 'preparing' | 'indexing' | 'scoring' | 'completed'
    partition?: 'validation' | 'test'
    variant?: EvaluationVariant
    seeds?: number[]
    completed?: number
    total?: number
  }
  summary?: EvaluationSummary
  runtime?: ModelRuntime & { evaluation_device?: string; collection?: string }
}

export type EvaluationAdapterSelection = Partial<
  Record<number, Record<RewardId, string>>
>

export type StartEvaluationInput = {
  adapters: EvaluationAdapterSelection
  mode: EvaluationMode
  pilotLimit?: number | null
}

export function getEvaluationBenchmark() {
  return request<EvaluationBenchmark>(
    '/evaluation/benchmark',
    { method: 'GET' },
    { timeoutMs: 10_000 },
  )
}

export function startEvaluationRun({
  adapters,
  mode,
  pilotLimit,
}: StartEvaluationInput) {
  return postJson<EvaluationRun>(
    artifactPaths.evaluations,
    { adapters, mode, pilot_limit: pilotLimit ?? null },
    { timeoutMs: 30_000 },
  )
}

export function listEvaluationRuns() {
  return request<EvaluationRun[]>(
    artifactPaths.evaluations,
    { method: 'GET' },
    { timeoutMs: 15_000 },
  )
}

export function getEvaluationRun(id: string) {
  return request<EvaluationRun>(
    artifactPath('evaluations', id),
    { method: 'GET' },
    { timeoutMs: 15_000 },
  )
}

export function evaluationDownloadUrl(id: string) {
  return artifactDownloadUrl('evaluations', id)
}

export type DatasetQuestion = {
  id: string
  conversation_id: string
  question: string
  category: QACategory
  answer: string | null
  evidence_turn_ids: string[]
}

export type QuestionsResponse = {
  prepared_id: string
  partition: Partition
  conversation_id: string | null
  total: number
  questions: DatasetQuestion[]
}

/**
 * Questions from a prepared partition, with the evidence turns that answer
 * them. Retrieval needs both to report recall, and R0 is scored against
 * exactly these annotations.
 */
export function listQuestions(
  preparedId: string,
  input: { partition: Partition; conversationId?: string | null; limit?: number },
) {
  const query = new URLSearchParams({ partition: input.partition })
  if (input.conversationId) query.set('conversation_id', input.conversationId)
  if (input.limit !== undefined) query.set('limit', String(input.limit))
  return request<QuestionsResponse>(
    `/data/prepared/${encodeURIComponent(preparedId)}/questions?${query}`,
    { method: 'GET' },
    { timeoutMs: 15_000 },
  )
}

/* ------------------------------------------------------------------ *
 * Startup readiness
 * ------------------------------------------------------------------ */

export type DependencyState = 'ok' | 'unavailable'

export type DependencyStatus = {
  name: string
  label: string
  status: DependencyState
  detail: string
}

export type ReadinessResponse = {
  ready: boolean
  checked_at: string
  dependencies: DependencyStatus[]
  facts: Record<string, unknown>
}

/**
 * Whether the API can actually do work, not merely whether it is listening.
 *
 * `/health` answers from the process alone; this one also reaches the memory
 * store, which is what the loading screen has to wait for.
 */
export function checkReady() {
  return request<ReadinessResponse>('/ready', { method: 'GET' }, { timeoutMs: 6000 })
}

export type BootStepStatus = 'pending' | 'active' | 'done' | 'failed'

export type BootStep = {
  id: string
  label: string
  status: BootStepStatus
  detail: string
}

export type BootStatus = {
  source: string
  startedAt?: string
  updatedAt?: string
  phase?: string
  error?: string | null
  steps?: BootStep[]
}

/**
 * The desktop launcher's Compose progress, when there is a launcher.
 *
 * This is NOT under the API base: it is served beside the frontend by
 * scripts/boot-status.mjs through the Vite proxy. Three things can come back
 * and only one of them is a feed —
 *
 *   - launcher JSON, under `npm run dev:desktop`;
 *   - a 503 stub from the proxy, under plain `npm run dev`;
 *   - index.html, under nginx, which routes unknown paths to the SPA.
 *
 * The last one is why the content type is checked before parsing: a loading
 * screen that treats a page of HTML as a status feed is worse than one that
 * admits it has no container visibility.
 */
export async function getBootStatus(): Promise<BootStatus | null> {
  try {
    const response = await fetch('/boot', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) return null
    if (!response.headers.get('content-type')?.includes('application/json')) return null
    const body = (await response.json()) as BootStatus
    return body?.source === 'desktop-launcher' ? body : null
  } catch {
    return null
  }
}

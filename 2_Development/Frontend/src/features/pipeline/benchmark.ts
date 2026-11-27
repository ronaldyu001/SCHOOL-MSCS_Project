import {
  PARTITIONS,
  type DatasetProvenance,
  type DatasetSplit,
  type EvaluationBenchmark,
  type PreparedHandle,
} from '@/lib/api'

function sameMembers(
  actual: readonly string[] | undefined,
  expected: readonly string[],
) {
  if (!actual || actual.length !== expected.length) return false
  const members = new Set(actual)
  return expected.every((value) => members.has(value))
}

export function matchesBenchmarkSplit(actual: DatasetSplit, expected: DatasetSplit) {
  return PARTITIONS.every((partition) => {
    const field = `${partition}_conversation_ids` as const
    return sameMembers(actual[field], expected[field])
  })
}

export function benchmarkSetupKey(benchmark: EvaluationBenchmark) {
  return JSON.stringify([
    benchmark.corpus_sha256,
    benchmark.split,
    benchmark.categories,
  ])
}

export function hasBenchmarkSource(
  provenance: DatasetProvenance | undefined,
  benchmark: EvaluationBenchmark,
) {
  return Boolean(
    provenance?.partition === 'train' &&
    provenance.corpus_sha256 === benchmark.corpus_sha256 &&
    provenance.split &&
    matchesBenchmarkSplit(provenance.split, benchmark.split) &&
    sameMembers(
      provenance.train_conversation_ids,
      benchmark.split.train_conversation_ids,
    ),
  )
}

export function hasBenchmarkCategories(
  provenance: DatasetProvenance,
  benchmark: EvaluationBenchmark,
) {
  return (
    provenance.categories?.length === benchmark.categories.length &&
    benchmark.categories.every(
      (category, at) => provenance.categories?.[at] === category,
    )
  )
}

export function isFrozenRewardBuild(
  provenance: DatasetProvenance | undefined,
  benchmark: EvaluationBenchmark,
  reward: string | undefined,
) {
  if (!provenance || !hasBenchmarkSource(provenance, benchmark)) return false

  function matches<T extends object>(actual: Partial<T> | undefined, expected: T) {
    return (Object.keys(expected) as (keyof T)[]).every(
      (key) => actual?.[key] === expected[key],
    )
  }

  return (
    hasBenchmarkCategories(provenance, benchmark) &&
    (provenance.rewrite_generator?.provider ?? 'local') === 'local' &&
    (reward !== 'r1' || (provenance.r1_teacher?.provider ?? 'local') === 'local') &&
    !provenance.settings?.keep_single_rewrite &&
    !provenance.settings?.keep_tied_rewrite &&
    provenance.model_id === benchmark.model_id &&
    provenance.model_revision === benchmark.model_revision &&
    provenance.reward_pipeline_version === benchmark.reward_pipeline_version &&
    provenance.rewrite_prompt_version === benchmark.rewrite_prompt_version &&
    matches<EvaluationBenchmark['embedding']>(provenance, benchmark.embedding) &&
    matches<EvaluationBenchmark['build']>(provenance.settings, benchmark.build)
  )
}

/** A restored preparation is usable without an earlier reward artifact. */
export function matchesPreparedBenchmark(
  handle: PreparedHandle,
  benchmark: EvaluationBenchmark,
) {
  const provenance = handle.provenance
  return Boolean(
    provenance &&
    provenance.corpus_sha256 === benchmark.corpus_sha256 &&
    provenance.split &&
    matchesBenchmarkSplit(provenance.split, benchmark.split) &&
    hasBenchmarkCategories(provenance, benchmark),
  )
}

export function isPreparedBenchmark(
  handle: PreparedHandle,
  benchmark: EvaluationBenchmark,
) {
  return Boolean(
    handle.partitions.train.indexed && matchesPreparedBenchmark(handle, benchmark),
  )
}

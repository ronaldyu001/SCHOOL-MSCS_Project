import { hasBenchmarkSource, isFrozenRewardBuild } from '@/features/pipeline/benchmark'
import type {
  EvaluationBenchmark,
  EvaluationMode,
  SavedRewardDataset,
  TrainingRun,
} from '@/lib/api'

export function eligibleAdapter(
  run: TrainingRun,
  seed: number,
  benchmark: EvaluationBenchmark,
  mode: EvaluationMode,
  datasets: SavedRewardDataset[],
) {
  if (
    run.status !== 'completed' ||
    run.model_id !== benchmark.model_id ||
    run.model_revision !== benchmark.model_revision ||
    run.settings?.seed !== seed
  )
    return false

  // Older training runs may only retain the reference to their saved dataset.
  const recorded = run.dataset_provenance
  const source = datasets.find((item) => item.id === run.dataset_id)
  const provenance =
    recorded && Object.keys(recorded).length
      ? recorded
      : source?.dataset_sha256 === run.dataset_sha256
        ? source?.provenance
        : undefined

  if (
    !provenance ||
    !hasBenchmarkSource(provenance, benchmark) ||
    provenance.settings?.seed !== seed
  ) {
    return false
  }
  if (mode === 'pilot') return true

  const { runtime, metrics, settings } = run
  const peakMemory = metrics.peak_device_memory_bytes
  return (
    isFrozenRewardBuild(provenance, benchmark, run.reward) &&
    Object.entries(benchmark.training).every(
      ([key, value]) => settings[key as keyof typeof settings] === value,
    ) &&
    runtime?.training_device === benchmark.hardware.training_device &&
    runtime.base_weight_dtype === benchmark.hardware.base_weight_dtype &&
    runtime.mixed_precision === benchmark.hardware.mixed_precision &&
    Number.isFinite(peakMemory) &&
    peakMemory <= benchmark.hardware.target_vram_gib * 1024 ** 3
  )
}

/** Object property order can differ even when run hardware and runtime agree. */
export function hardwareFingerprint(run: TrainingRun) {
  return JSON.stringify(
    Object.entries(run.runtime ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  )
}

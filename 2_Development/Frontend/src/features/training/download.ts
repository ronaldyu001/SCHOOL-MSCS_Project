import type { RewardDatasetResponse, RewardResult } from '@/lib/api'

function save(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  // Revoke on the next frame: Safari needs the object to outlive the click.
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

function jsonLines(rows: unknown[]): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '')
}

/**
 * The same file layout the command-line builder writes.
 *
 * `<reward>.jsonl` holds prompt/completion pairs and
 * `<reward>.diagnostics.jsonl` holds one outcome per attempted input, so a file
 * exported from this page can be concatenated with one produced by
 * `presentation/build_reward_datasets.py` without any reshaping.
 *
 * The bytes are not identical to that builder's: Python's `json.dumps` puts a
 * space after `:` and `,` where `JSON.stringify` does not. Same keys, same
 * order, same values, and every line parses to the same record — so a textual
 * diff between a UI export and a CLI export shows that spacing, not content.
 */
export function downloadExamples(reward: RewardResult) {
  save(`${reward.reward}.jsonl`, jsonLines(reward.examples), 'application/x-ndjson')
}

export function downloadDiagnostics(reward: RewardResult) {
  save(
    `${reward.reward}.diagnostics.jsonl`,
    jsonLines(reward.outcomes),
    'application/x-ndjson',
  )
}

/**
 * A manifest describing the run, in the builder's shape where the fields exist.
 *
 * The command-line builder records the corpus hash and the full split because
 * it owns the corpus; this route works from a prepared id the backend already
 * holds, so those are replaced by the id itself. The distinction is recorded in
 * `source` rather than papered over, because a manifest that implies a corpus
 * hash it never computed is worse than one that admits the gap.
 */
export function downloadManifest(result: RewardDatasetResponse) {
  const manifest = {
    source: 'POST /rewards/datasets',
    prepared_id: result.prepared_id,
    partition: result.partition,
    conversation_count: result.conversation_count,
    qa_count: result.qa_count,
    collection: result.collection,
    model_id: result.model_id,
    model_revision: result.model_revision,
    embedding_model: result.embedding_model,
    reward_pipeline_version: result.reward_pipeline_version,
    rewrite_prompt_version: result.rewrite_prompt_version,
    settings: result.settings,
    elapsed_seconds: result.elapsed_seconds,
    exported_at: new Date().toISOString(),
    rewards: Object.fromEntries(
      result.results.map((reward) => [
        reward.reward,
        {
          attempted: reward.attempted,
          kept: reward.kept,
          skipped: reward.skipped,
          tied_winners: reward.tied_winners,
        },
      ]),
    ),
  }
  save('manifest.json', JSON.stringify(manifest, null, 2) + '\n', 'application/json')
}

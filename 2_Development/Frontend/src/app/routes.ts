import type { IconName } from '@/components/ui'

/**
 * The route table, as data.
 *
 * The navigator, the router and the roadmap panel all read this one array, so a
 * new section is added in a single place and cannot drift out of step. The five
 * entries map onto the five components named in the proposal's Approach
 * section; `status` says which of them is actually built, which keeps the
 * navigator honest about where the project stands.
 */
export type RouteStatus = 'built' | 'planned'

export type RouteDef = {
  path: string
  /** Header navigation text; kept to one word where possible. */
  label: string
  title: string
  icon: IconName
  status: RouteStatus
  /** One sentence, used as the page lede and the nav tooltip. */
  summary: string
  /** What this section will own once built. Rendered as the planned checklist. */
  scope: string[]
  /** Which part of the proposal this section implements. */
  proposalRef: string
}

export const ROUTES: RouteDef[] = [
  {
    path: '/',
    label: 'Pipeline',
    title: 'Dataset and memory pipeline',
    icon: 'layers',
    status: 'built',
    summary:
      'Load LoCoMo, split it by conversation, prepare the partitions, and index them into the frozen memory store.',
    scope: [],
    proposalRef: 'Approach — Dataset, Memory pipeline',
  },
  {
    path: '/retrieval',
    label: 'Retrieval',
    title: 'Retrieval and budget harness',
    icon: 'filter',
    status: 'planned',
    summary:
      'Run a query against the indexed store, return memories up to a fixed token budget, and score what came back.',
    scope: [
      'Embed a query with the frozen encoder and search one conversation',
      'Truncate the retrieved set at a fixed token budget',
      'Report evidence recall, rank of the first needed memory, and budget used',
      'Sweep several budget sizes to produce a curve rather than one number',
    ],
    proposalRef: 'Approach — Retrieval and budget harness; Evaluation',
  },
  {
    path: '/rewards',
    label: 'Rewards',
    title: 'Reward bank',
    icon: 'split',
    status: 'planned',
    summary:
      'Three label-free scorers plus the supervised ceiling, behind one interface, so the training signal is a config change.',
    scope: [
      'R1 — full-context teacher: agreement between a retrieval-grounded answer and a whole-conversation answer',
      'R2 — masked-turn prediction: how much the retrieved set helps predict a hidden message',
      'R3 — synthetic evidence: questions generated from a message, scored against that message',
      'R0 — supervised ceiling: overlap with the annotated evidence turns, the only scorer that reads labels',
    ],
    proposalRef: 'Approach — Reward bank',
  },
  {
    path: '/training',
    label: 'Training',
    title: 'Candidate factory and training loop',
    icon: 'refresh',
    status: 'planned',
    summary:
      'Generate several rewrites per question, score them, keep the winners, and fine-tune on those with LoRA.',
    scope: [
      'Sample candidate rewrites with randomised decoding so they differ from each other',
      'Score every candidate with the selected reward',
      'Assemble the kept rewrites into a fine-tuning set',
      'Run the LoRA fine-tune and record the config and seed',
    ],
    proposalRef: 'Approach — Candidate factory and training loop',
  },
  {
    path: '/evaluation',
    label: 'Evaluation',
    title: 'Evaluation ladder',
    icon: 'arrow',
    status: 'planned',
    summary:
      'Six configurations on the held-out test split, reported per question category over a range of token budgets.',
    scope: [
      'Budget curves for all six ladder steps on the held-out test split',
      'Per-category breakdown: single-hop, multi-hop, temporal, open-domain',
      'Repeat runs across seeds, so a small gap is not read as a real one',
      'Label-free results expressed as a fraction of the supervised ceiling',
    ],
    proposalRef: 'Evaluation',
  },
]

/** The six configurations compared in the evaluation ladder. */
export const LADDER = [
  { step: 0, name: 'Raw message', note: 'Embedded as-is. The status quo.' },
  { step: 1, name: 'Prompted rewrite', note: 'Small model, no training.' },
  { step: 2, name: 'Trained on R1', note: 'Full-context teacher.' },
  { step: 3, name: 'Trained on R2', note: 'Masked-turn prediction.' },
  { step: 4, name: 'Trained on R3', note: 'Synthetic evidence.' },
  { step: 5, name: 'Trained on R0', note: 'Gold labels. Supervised ceiling.' },
] as const

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
  /** What this section owns. Rendered as the planned checklist when unbuilt. */
  scope: string[]
  /** Which part of the proposal this section implements. */
  proposalRef: string
}

export const ROUTES: RouteDef[] = [
  {
    path: '/',
    label: 'Pipeline',
    title: 'Pipeline',
    icon: 'layers',
    status: 'built',
    summary: 'Load the dataset, split it, and index it so it can be searched.',
    scope: [],
    proposalRef: 'Approach — Dataset, Memory pipeline',
  },
  {
    path: '/retrieval',
    label: 'Search',
    title: 'Search',
    icon: 'filter',
    status: 'built',
    summary: 'Ask a question and see which memories come back.',
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
    label: 'Scoring',
    title: 'Scoring',
    icon: 'split',
    status: 'built',
    summary: 'Four ways to judge whether a rewrite found the right memories.',
    scope: [
      'R1 — full-context teacher: agreement between a retrieval-grounded answer and a whole-conversation answer',
      'R2 — masked-turn prediction: how much the retrieved set helps predict a hidden message',
      'R3 — synthetic evidence: questions generated from a message, scored against that message',
      'R0 — supervised ceiling: overlap with the annotated evidence turns, the only scorer that reads labels',
    ],
    proposalRef: 'Approach — Reward bank',
  },
  {
    path: '/training-data',
    label: 'Training data',
    title: 'Training data',
    icon: 'refresh',
    status: 'built',
    summary: 'Write rewrites, score them, and keep the best ones to train on.',
    scope: [
      'Sample candidate rewrites with randomised decoding so they differ from each other',
      'Score every candidate with the selected reward',
      'Assemble the kept rewrites into a fine-tuning set',
    ],
    proposalRef: 'Approach — Candidate factory and training loop',
  },
  {
    path: '/evaluation',
    label: 'Evaluation',
    title: 'Evaluation ladder',
    icon: 'arrow',
    status: 'planned',
    summary: 'Compare every setup on the held-out test split.',
    scope: [
      'Budget curves for all six ladder steps on the held-out test split',
      'Per-category breakdown: single-hop, multi-hop, temporal, open-domain',
      'Repeat runs across seeds, so a small gap is not read as a real one',
      'Label-free results expressed as a fraction of the supervised ceiling',
    ],
    proposalRef: 'Evaluation',
  },
]

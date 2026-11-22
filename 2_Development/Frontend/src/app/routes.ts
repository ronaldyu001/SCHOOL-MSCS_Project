import type { IconName } from '@/components/ui'

export type RouteStatus = 'built' | 'planned'

/** What has to exist before a section can do anything. */
export type Requirement = 'data' | 'training-data' | 'adapter'

/**
 * The artifact a requirement stands for, mid-sentence, named without repeating
 * the tab that produces it — the two appear in the same breath.
 */
export const REQUIREMENT_LABEL: Record<Requirement, string> = {
  data: 'Index the conversations in Setup to continue.',
  'training-data': 'Build a reward dataset with at least one kept rewrite, or use one already saved.',
  adapter: 'Finish a fine-tuning run to get an adapter to evaluate.',
}

/** Which tab you go to in order to satisfy it. */
export const REQUIREMENT_SOURCE: Record<Requirement, { path: string; label: string }> =
  {
    data: { path: '/setup', label: 'Setup' },
    'training-data': { path: '/training', label: 'Training data' },
    adapter: { path: '/fine-tuning', label: 'Fine-tuning' },
  }

export type RouteDef = {
  path: string
  /** Header navigation text. */
  label: string
  title: string
  icon: IconName
  status: RouteStatus
  /** One sentence, used as the page lede and the nav tooltip. */
  summary: string
  /** What this section will own once built. Shown when it is not. */
  scope: string[]
  /** Which part of the proposal this section implements. */
  proposalRef: string
  /** Stated in the navigation and on the page while it is unmet. */
  requires?: Requirement[]
  /** Hidden from the main navigation, but still a real page. */
  secondary?: boolean
}

export const ROUTES: RouteDef[] = [
  {
    path: '/setup',
    label: 'Setup',
    title: 'Set up the data',
    icon: 'layers',
    status: 'built',
    summary: 'Load the dataset and index it so it can be searched.',
    scope: [],
    proposalRef: 'Approach — Dataset, Memory pipeline',
  },
  {
    path: '/training',
    label: 'Training data',
    title: 'Training data',
    icon: 'refresh',
    status: 'built',
    summary: 'Write rewrites, score them, and keep the best ones to train on.',
    scope: [],
    proposalRef: 'Approach — Reward bank; Candidate factory and training loop',
    requires: ['data'],
  },
  {
    path: '/fine-tuning',
    label: 'Fine-tuning',
    title: 'Fine-tuning',
    icon: 'split',
    status: 'built',
    summary: 'Train an adapter with a saved reward dataset.',
    scope: [],
    proposalRef: 'Approach — Candidate factory and training loop',
    requires: ['training-data'],
  },
  {
    path: '/evaluation',
    label: 'Results',
    title: 'Results',
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
    requires: ['adapter', 'data'],
  },
  {
    path: '/search',
    label: 'Search',
    title: 'Search',
    icon: 'filter',
    status: 'built',
    summary: 'Experiment with queries and inspect the retrieved memories.',
    scope: [],
    proposalRef: 'Approach — Retrieval and budget harness',
    requires: ['data'],
    secondary: true,
  },
  {
    path: '/artifacts',
    label: 'Artifacts',
    title: 'Artifacts',
    icon: 'layers',
    status: 'built',
    summary: 'View and manage saved reward datasets and adapters.',
    scope: [],
    proposalRef: 'Deliverables',
    secondary: true,
  },
]

/** Everything the main navigation shows. */
export const PRIMARY_ROUTES = ROUTES.filter((route) => !route.secondary)
export const TOOL_ROUTES = ROUTES.filter((route) => route.secondary)

export const SETUP_ROUTE = ROUTES.find((route) => route.path === '/setup') as RouteDef

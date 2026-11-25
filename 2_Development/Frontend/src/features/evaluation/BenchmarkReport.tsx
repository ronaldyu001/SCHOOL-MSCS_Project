import { useState } from 'react'
import {
  DataTable,
  Disclosure,
  Panel,
  PanelHeader,
  PanelSection,
  SelectField,
} from '@/components/ui'
import type {
  EvaluationCategory,
  EvaluationCurve,
  EvaluationSummary,
  EvaluationVariant,
} from '@/lib/api'
import { categoryLabel, count } from '@/lib/format'
import { RecallPlot } from './RecallPlot'
import styles from './ResultsPage.module.css'

const VARIANTS = ['raw', 'prompted', 'r1', 'r2', 'r3', 'r0'] as const

const LABELS: Record<EvaluationVariant, string> = {
  raw: 'Raw query',
  prompted: 'Prompted baseline',
  r1: 'R1',
  r2: 'R2',
  r3: 'R3',
  r0: 'R0 supervised',
  gold_query: 'Gold-evidence query',
  best_of_three: 'Best of R1–R3',
}

function percent(value: number | null | undefined) {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`
}

function percentagePoints(value: number, signed = false) {
  return `${signed && value > 0 ? '+' : ''}${(value * 100).toFixed(1)} pp`
}

function average(value: number | null) {
  return value === null
    ? '—'
    : Number.isInteger(value)
      ? count(value)
      : value.toFixed(1)
}

function withSpread(row: EvaluationCurve) {
  return row.mean_recall_seed_std == null
    ? percent(row.mean_recall)
    : `${percent(row.mean_recall)} ± ${percentagePoints(row.mean_recall_seed_std)}`
}

function Diagnostics({
  summary,
  category,
  budget,
  budgetRows,
}: {
  summary: EvaluationSummary
  category: EvaluationCategory
  budget: number
  budgetRows: EvaluationCurve[]
}) {
  const perSeed = summary.per_seed.filter(
    (row) =>
      row.category === category &&
      row.budget === budget &&
      VARIANTS.some((variant) => variant === row.variant),
  )
  const failures = summary.failure_overlap
    .filter((row) => row.category === category && row.budget === budget)
    .flatMap((row) =>
      Object.entries(row.zero_recall).map(([group, questions]) => ({
        seed: row.seed,
        group,
        questions,
      })),
    )
  const similarity = summary.rewrite_similarity.filter(
    (row) => row.category === category,
  )
  const exclusions = Object.entries(summary.excluded_questions).flatMap(
    ([group, reasons]) =>
      category === 'all' || group === category
        ? Object.entries(reasons ?? {}).map(([reason, questions]) => ({
            group,
            reason,
            questions,
          }))
        : [],
  )
  const oracle = budgetRows.filter(
    (row) => row.variant === 'gold_query' || row.variant === 'best_of_three',
  )

  return (
    <div className={styles.stack}>
      {oracle.length ? (
        <Disclosure summary="Oracle comparisons">
          <p className={styles.hint}>
            The gold-evidence query uses the annotations. Best of R1–R3 picks the
            highest recall per question at this budget.
          </p>
          <DataTable
            caption={`Headroom at ${count(budget)} tokens`}
            rowHeader="Diagnostic"
            columns={['Mean recall']}
            rows={oracle.map((row) => ({
              key: row.variant,
              header: LABELS[row.variant],
              cells: [withSpread(row)],
            }))}
          />
        </Disclosure>
      ) : null}
      {perSeed.length ? (
        <Disclosure summary="Results by seed">
          <DataTable
            caption={`Per-seed scores at ${count(budget)} tokens`}
            rowHeader="Configuration"
            columns={[
              'Seed',
              'Questions',
              'Recall',
              'Misses',
              'Mean tokens',
              'Blank rewrites',
            ]}
            rows={perSeed.map((row) => ({
              key: `${row.seed}-${row.variant}`,
              header: LABELS[row.variant],
              cells: [
                row.seed,
                count(row.questions),
                percent(row.mean_recall),
                percent(row.miss_rate),
                average(row.mean_tokens_used),
                count(row.blank_rewrites),
              ],
            }))}
          />
        </Disclosure>
      ) : null}
      {failures.length ? (
        <Disclosure summary="Which signals missed together">
          <DataTable
            caption={`Zero recall overlap at ${count(budget)} tokens`}
            rowHeader="Signals with zero recall"
            columns={['Seed', 'Questions']}
            rows={failures.map((row) => ({
              key: `${row.seed}-${row.group}`,
              header:
                row.group === 'none'
                  ? 'None'
                  : row.group.toUpperCase().replaceAll('+', ' + '),
              cells: [row.seed, count(row.questions)],
            }))}
          />
        </Disclosure>
      ) : null}
      {similarity.length ? (
        <Disclosure summary="Rewrite similarity">
          <DataTable
            caption="Pairwise agreement between label-free rewrites"
            rowHeader="Signals"
            columns={['Seed', 'Questions', 'Exact match', 'Token overlap (Jaccard)']}
            rows={similarity.map((row) => ({
              key: `${row.seed}-${row.variants.join('-')}`,
              header: row.variants.join(' / ').toUpperCase(),
              cells: [
                row.seed,
                count(row.questions),
                percent(row.exact_match_rate),
                percent(row.mean_token_jaccard),
              ],
            }))}
          />
        </Disclosure>
      ) : null}
      <Disclosure
        summary="Excluded questions"
        count={count(exclusions.reduce((total, row) => total + row.questions, 0))}
      >
        {exclusions.length ? (
          <DataTable
            caption="Questions without scorable gold evidence"
            rowHeader="Category"
            columns={['Reason', 'Questions']}
            rows={exclusions.map((row) => ({
              key: `${row.group}-${row.reason}`,
              header: categoryLabel(row.group),
              cells: [row.reason.replaceAll('_', ' '), count(row.questions)],
            }))}
          />
        ) : (
          <p>No questions in this category were excluded.</p>
        )}
      </Disclosure>
    </div>
  )
}

export function BenchmarkReport({ summary }: { summary: EvaluationSummary }) {
  const [category, setCategory] = useState<EvaluationCategory>('all')
  const [pickedBudget, setPickedBudget] = useState<number | null>(null)
  const categories = [...new Set(summary.curves.map((row) => row.category))]
  const curves = summary.curves.filter((row) => row.category === category)
  const budgets = [...new Set(curves.map((row) => row.budget))].sort((a, b) => a - b)
  const budget =
    pickedBudget !== null && budgets.includes(pickedBudget)
      ? pickedBudget
      : budgets.at(-1)
  const budgetRows = curves.filter((row) => row.budget === budget)
  const lineSeries = VARIANTS.map((variant) => ({
    variant,
    label: LABELS[variant],
    points: budgets.map((item) =>
      curves.find((row) => row.variant === variant && row.budget === item),
    ),
  }))
  const selectedRows = VARIANTS.flatMap((variant) =>
    budgetRows.filter((row) => row.variant === variant),
  )
  const maxQuestions = selectedRows[0]?.questions_per_seed
  const seeds = selectedRows[0]?.seeds

  if (budget === undefined) return null

  return (
    <Panel>
      <PanelHeader
        title="Evidence recall by token budget"
        description={
          maxQuestions !== undefined && seeds !== undefined
            ? `${count(maxQuestions)} questions per seed · ${count(seeds)} ${seeds === 1 ? 'seed' : 'seeds'}`
            : undefined
        }
      />
      <PanelSection className={styles.fields}>
        <SelectField
          label="Question category"
          value={category}
          onChange={(event) => {
            const selected = categories.find((item) => item === event.target.value)
            if (selected) setCategory(selected)
          }}
        >
          {categories.map((item) => (
            <option value={item} key={item}>
              {item === 'all' ? 'All categories' : categoryLabel(item)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Budget for detailed metrics"
          value={budget}
          onChange={(event) => setPickedBudget(Number(event.target.value))}
        >
          {budgets.map((item) => (
            <option value={item} key={item}>
              {count(item)} tokens
            </option>
          ))}
        </SelectField>
      </PanelSection>
      <PanelSection sunken className={styles.stack}>
        <RecallPlot series={lineSeries} budgets={budgets} selectedBudget={budget} />
        <Disclosure summary="Recall values for every budget">
          <DataTable
            caption="Mean recall by configuration and budget"
            rowHeader="Configuration"
            columns={budgets.map((item) => `${count(item)} tokens`)}
            rows={lineSeries.map(({ variant, label, points }) => ({
              key: variant,
              header: label,
              cells: points.map((point) => (point ? withSpread(point) : '—')),
            }))}
          />
        </Disclosure>
      </PanelSection>
      <PanelSection className={styles.stack}>
        <DataTable
          caption={`Detailed metrics at ${count(budget)} tokens`}
          rowHeader="Configuration"
          columns={[
            'Mean recall',
            'Δ vs raw',
            'Δ vs prompted',
            'First hit rank',
            'Misses',
            'Mean tokens',
            'Recall vs R0',
            'R0 gain recovered',
          ]}
          rows={selectedRows.map((row) => ({
            key: row.variant,
            header: LABELS[row.variant],
            cells: [
              withSpread(row),
              percentagePoints(row.delta_vs_raw, true),
              percentagePoints(row.delta_vs_prompted, true),
              average(row.mean_first_hit_rank),
              percent(row.miss_rate),
              average(row.mean_tokens_used),
              percent(row.recall_vs_r0),
              percent(row.r0_gain_recovered),
            ],
          }))}
        />
        <p className={styles.hint}>
          First hit rank averages questions with an evidence hit. Where shown, ± is
          standard deviation across seeds. R0 gain recovered uses the prompted baseline
          as its reference and is available when R0 improves on that baseline.
        </p>
        <Diagnostics
          summary={summary}
          category={category}
          budget={budget}
          budgetRows={budgetRows}
        />
      </PanelSection>
    </Panel>
  )
}

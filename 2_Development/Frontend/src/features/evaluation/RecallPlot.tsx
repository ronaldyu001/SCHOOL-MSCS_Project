import type { EvaluationCurve, EvaluationVariant } from '@/lib/api'
import { count } from '@/lib/format'
import styles from './ResultsPage.module.css'

type Series = {
  variant: EvaluationVariant
  label: string
  points: (EvaluationCurve | undefined)[]
}

const LEVELS = [1, 0.75, 0.5, 0.25, 0]
const PLOT = { left: 58, top: 20, width: 620, height: 194 }
const DASHES: Partial<Record<EvaluationVariant, string>> = {
  raw: '2 5',
  prompted: '7 5',
  r2: '12 5',
  r3: '7 3 2 3',
}

export function RecallPlot({
  series,
  budgets,
  selectedBudget,
}: {
  series: Series[]
  budgets: number[]
  selectedBudget: number
}) {
  const position = (index: number) =>
    PLOT.left +
    (budgets.length === 1
      ? PLOT.width / 2
      : (index * PLOT.width) / (budgets.length - 1))
  const y = (recall: number) => PLOT.top + (1 - recall) * PLOT.height
  const selectedX = position(budgets.indexOf(selectedBudget))

  return (
    <figure className={styles.figure} aria-hidden="true">
      <div className={styles.plotScroll}>
        <svg className={styles.plot} viewBox="0 0 716 274">
          {LEVELS.map((level) => (
            <g key={level}>
              <line
                className={styles.gridLine}
                x1={PLOT.left}
                x2={PLOT.left + PLOT.width}
                y1={y(level)}
                y2={y(level)}
              />
              <text
                className={styles.tick}
                x={PLOT.left - 12}
                y={y(level) + 4}
                textAnchor="end"
              >
                {Math.round(level * 100)}%
              </text>
            </g>
          ))}
          <line
            className={styles.budgetMarker}
            x1={selectedX}
            x2={selectedX}
            y1={PLOT.top}
            y2={PLOT.top + PLOT.height}
          />
          {budgets.map((budget, index) => (
            <text
              className={budget === selectedBudget ? styles.selectedTick : styles.tick}
              key={budget}
              x={position(index)}
              y={PLOT.top + PLOT.height + 24}
              textAnchor="middle"
            >
              {count(budget)}
            </text>
          ))}
          <text
            className={styles.tick}
            x={PLOT.left + PLOT.width / 2}
            y={265}
            textAnchor="middle"
          >
            Token budget
          </text>
          {series.map(({ variant, label, points }) => {
            const plotted = points.flatMap((row, index) =>
              row ? [{ x: position(index), y: y(row.mean_recall), row }] : [],
            )
            return (
              <g data-variant={variant} key={variant} className={styles.series}>
                <polyline
                  fill="none"
                  points={plotted.map((point) => `${point.x},${point.y}`).join(' ')}
                  strokeDasharray={DASHES[variant]}
                  vectorEffect="non-scaling-stroke"
                />
                {plotted.map((point) => (
                  <circle
                    key={point.row.budget}
                    cx={point.x}
                    cy={point.y}
                    r={point.row.budget === selectedBudget ? 4 : 2.5}
                  >
                    <title>{`${label} · ${count(point.row.budget)} tokens · ${(point.row.mean_recall * 100).toFixed(1)}%`}</title>
                  </circle>
                ))}
              </g>
            )
          })}
        </svg>
      </div>
      <ul className={styles.legend}>
        {series.map(({ variant, label }) => (
          <li key={variant} data-variant={variant}>
            <span className={styles.swatch} />
            {label}
          </li>
        ))}
      </ul>
    </figure>
  )
}

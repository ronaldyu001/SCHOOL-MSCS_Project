import { SETUP_STEPS } from '@/features/pipeline/steps'
import styles from './StepRail.module.css'

type StepRailProps = {
  /** Steps finished. */
  done: number
  /** 1-based place of the step running now, or null. */
  position: number | null
  className?: string
}

/**
 * The setup run as one row of segments — filled, running, to come.
 *
 * Decoration beside a "step 2 of 4" that already says it in words, which is
 * why it is aria-hidden: it exists so the state can be taken in without
 * reading, not as a second source of the same fact.
 */
export function StepRail({ done, position, className }: StepRailProps) {
  return (
    <span
      className={[styles.rail, className].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {SETUP_STEPS.map((step, index) => {
        const state =
          index < done ? styles.done : index + 1 === position ? styles.now : ''
        return <span key={step.key} className={`${styles.step} ${state}`} />
      })}
    </span>
  )
}

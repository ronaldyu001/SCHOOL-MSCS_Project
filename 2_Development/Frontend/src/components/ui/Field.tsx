import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react'
import { Icon } from './Icon'
import styles from './Field.module.css'

type FieldShellProps = {
  label: string
  labelNote?: ReactNode
  hint?: ReactNode
  error?: string
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode
}

/**
 * Owns the label/hint/error wiring so no caller has to remember it: the control
 * gets a generated id, `aria-describedby` points at whichever of hint and error
 * is present, and the error is announced politely as it appears.
 */
function FieldShell({ label, labelNote, hint, error, children }: FieldShellProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {labelNote ? <span className={styles.labelNote}>{labelNote}</span> : null}
      </label>
      {children({ id, describedBy })}
      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} id={errorId} role="alert">
          <Icon name="alert" size={13} />
          {error}
        </p>
      ) : null}
    </div>
  )
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string
  labelNote?: ReactNode
  hint?: ReactNode
  error?: string
  /** Mark the control invalid without attaching a message to it, for a group of
   *  fields that share one error stated elsewhere. */
  invalid?: boolean
  /** Id of the element holding that shared error message. */
  errorId?: string
}

export function TextField({
  label,
  labelNote,
  hint,
  error,
  invalid,
  errorId,
  ...rest
}: TextFieldProps) {
  const numeric = rest.type === 'number'
  const flagged = Boolean(error) || invalid === true
  return (
    <FieldShell label={label} labelNote={labelNote} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <input
          id={id}
          className={[
            styles.control,
            numeric && styles.numeric,
            flagged && styles.invalid,
          ]
            .filter(Boolean)
            .join(' ')}
          aria-describedby={
            [describedBy, invalid ? errorId : null].filter(Boolean).join(' ').trim() ||
            undefined
          }
          aria-invalid={flagged || undefined}
          {...rest}
        />
      )}
    </FieldShell>
  )
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string
  labelNote?: ReactNode
  hint?: ReactNode
  error?: string
  children: ReactNode
}

export function SelectField({
  label,
  labelNote,
  hint,
  error,
  children,
  ...rest
}: SelectFieldProps) {
  return (
    <FieldShell label={label} labelNote={labelNote} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <select
          id={id}
          className={`${styles.control} ${styles.select}`}
          aria-describedby={describedBy}
          {...rest}
        >
          {children}
        </select>
      )}
    </FieldShell>
  )
}

export type CheckOption<T extends string> = {
  value: T
  label: string
  tag?: string
}

type CheckGroupProps<T extends string> = {
  legend: string
  hint?: ReactNode
  options: CheckOption<T>[]
  selected: T[]
  disabled?: boolean
  onToggle: (value: T) => void
}

export function CheckGroup<T extends string>({
  legend,
  hint,
  options,
  selected,
  disabled,
  onToggle,
}: CheckGroupProps<T>) {
  const hintId = useId()
  return (
    <fieldset className={styles.field} style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className={styles.label} style={{ padding: 0 }}>
        {legend}
      </legend>
      <ul className={styles.checkList} aria-describedby={hint ? hintId : undefined}>
        {options.map((option) => (
          <li key={option.value}>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                disabled={disabled}
                onChange={() => onToggle(option.value)}
              />
              {option.label}
              {option.tag ? (
                <span className={styles.checkTag}>{option.tag}</span>
              ) : null}
            </label>
          </li>
        ))}
      </ul>
      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
    </fieldset>
  )
}

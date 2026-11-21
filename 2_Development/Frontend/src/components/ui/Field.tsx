import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
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

type TextAreaFieldProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> & {
  label: string
  labelNote?: ReactNode
  hint?: ReactNode
  error?: string
  /** Render in the monospace face, for prompts and packed contexts. */
  mono?: boolean
}

export function TextAreaField({
  label,
  labelNote,
  hint,
  error,
  mono,
  rows = 3,
  ...rest
}: TextAreaFieldProps) {
  return (
    <FieldShell label={label} labelNote={labelNote} hint={hint} error={error}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          rows={rows}
          className={[
            styles.control,
            styles.textarea,
            mono && styles.mono,
            error && styles.invalid,
          ]
            .filter(Boolean)
            .join(' ')}
          aria-describedby={describedBy}
          aria-invalid={Boolean(error) || undefined}
          {...rest}
        />
      )}
    </FieldShell>
  )
}

export type ChipOption = {
  value: string
  label?: string
  note?: string
}

type OptionChipsProps = {
  legend: string
  hint?: ReactNode
  options: ChipOption[]
  selected?: string
  disabled?: boolean
  onPick: (value: string) => void
  /** Shown in place of the chips when there is nothing to offer. */
  empty?: ReactNode
}

/**
 * One-tap values for a field the user may also type into. Buttons rather than a
 * select, because the list is short, each entry is self-describing, and the
 * field underneath stays authoritative.
 */
export function OptionChips({
  legend,
  hint,
  options,
  selected,
  disabled,
  onPick,
  empty,
}: OptionChipsProps) {
  const hintId = useId()
  return (
    <fieldset className={styles.field} style={{ border: 0, margin: 0, padding: 0 }}>
      <legend className={styles.label} style={{ padding: 0 }}>
        {legend}
      </legend>
      {options.length === 0 ? (
        <p className={styles.hint}>{empty ?? 'Nothing to choose from yet.'}</p>
      ) : (
        <ul className={styles.chipRow} aria-describedby={hint ? hintId : undefined}>
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={option.value === selected}
                className={[
                  styles.chipButton,
                  option.value === selected && styles.chipButtonOn,
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onPick(option.value)}
                title={option.note}
              >
                {option.label ?? option.value}
              </button>
            </li>
          ))}
        </ul>
      )}
      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}
    </fieldset>
  )
}

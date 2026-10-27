import type { ElementType, HTMLAttributes, ReactNode } from 'react'
import styles from './Panel.module.css'

function join(...values: (string | false | undefined)[]) {
  return values.filter(Boolean).join(' ')
}

type PanelProps = HTMLAttributes<HTMLElement> & {
  as?: ElementType
  /** Drop the radius and side borders, for a panel that spans the viewport. */
  flush?: boolean
}

export function Panel({ as: Tag = 'section', flush, className, ...rest }: PanelProps) {
  return (
    <Tag className={join(styles.panel, flush && styles.flush, className)} {...rest} />
  )
}

type PanelHeaderProps = {
  eyebrow?: ReactNode
  title: ReactNode
  /** Rendered as <h2> by default; pass 'h3' for a panel nested in a section. */
  titleAs?: 'h2' | 'h3'
  description?: ReactNode
  aside?: ReactNode
  id?: string
}

export function PanelHeader({
  eyebrow,
  title,
  titleAs: Heading = 'h2',
  description,
  aside,
  id,
}: PanelHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.headingGroup}>
        {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        <Heading id={id}>{title}</Heading>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {aside ? <div className={styles.aside}>{aside}</div> : null}
    </header>
  )
}

export function PanelBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={join(styles.body, className)} {...rest} />
}

type PanelSectionProps = HTMLAttributes<HTMLDivElement> & {
  /** Recess the band. Use for measured results, not for controls. */
  sunken?: boolean
}

export function PanelSection({ sunken, className, ...rest }: PanelSectionProps) {
  return (
    <div
      className={join(styles.section, sunken && styles.sunken, className)}
      {...rest}
    />
  )
}

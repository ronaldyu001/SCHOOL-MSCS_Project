import type { HTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import styles from './Callout.module.css'

type CalloutTone = 'info' | 'warn' | 'error' | 'done'

const ICONS: Record<CalloutTone, IconName> = {
  info: 'dot',
  warn: 'alert',
  error: 'alert',
  done: 'check',
}

type CalloutProps = HTMLAttributes<HTMLDivElement> & {
  tone?: CalloutTone
  title?: ReactNode
  icon?: IconName
  children: ReactNode
}

export function Callout({
  tone = 'info',
  title,
  icon,
  children,
  className,
  ...rest
}: CalloutProps) {
  return (
    <div
      className={[styles.callout, styles[tone], className].filter(Boolean).join(' ')}
      {...rest}
    >
      <Icon
        name={icon ?? ICONS[tone]}
        size={15}
        strokeWidth={(icon ?? ICONS[tone]) === 'dot' ? 3 : 1.75}
        className={styles.icon}
      />
      <div className={styles.content}>
        {title ? <p className={styles.title}>{title}</p> : null}
        {children}
      </div>
    </div>
  )
}

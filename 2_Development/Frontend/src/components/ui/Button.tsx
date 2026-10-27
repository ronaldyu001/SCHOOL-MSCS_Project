import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import styles from './Button.module.css'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  icon?: IconName
  /** Swaps the icon for a spinner and blocks the click without going disabled,
   *  so focus is never dropped mid-request. */
  busy?: boolean
  children?: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  busy = false,
  disabled,
  type = 'button',
  className,
  children,
  onClick,
  ...rest
}: ButtonProps) {
  const glyph = busy ? 'spinner' : icon
  return (
    <button
      type={type}
      disabled={disabled}
      aria-busy={busy || undefined}
      className={[styles.button, styles[variant], styles[size], className]
        .filter(Boolean)
        .join(' ')}
      onClick={busy ? undefined : onClick}
      {...rest}
    >
      {glyph ? (
        <Icon
          name={glyph}
          size={size === 'sm' ? 13 : 15}
          className={busy ? styles.spin : undefined}
        />
      ) : null}
      {children}
    </button>
  )
}

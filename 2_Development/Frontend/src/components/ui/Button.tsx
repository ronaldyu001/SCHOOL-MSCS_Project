import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router'
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

type ButtonLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'sm' | 'md'
  icon?: IconName
  /** An app route, navigated client-side. */
  to?: string
  /** An external or backend URL, such as an artifact download. */
  href?: string
  children?: ReactNode
}

/**
 * An action that happens to be a link.
 *
 * Downloading an artifact and starting a build are the same kind of thing to
 * the person clicking, and they were not the same kind of thing to look at:
 * one was a button, the other bare underlined text wherever a page happened to
 * need it. This is the anchor that wears the button's clothes. It imports the
 * router so that an in-app destination still navigates client-side rather than
 * reloading the window.
 */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  icon,
  to,
  href,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  const classes = [styles.button, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(' ')
  const content = (
    <>
      {icon ? <Icon name={icon} size={size === 'sm' ? 13 : 15} /> : null}
      {children}
    </>
  )

  return to ? (
    <Link to={to} className={classes} {...rest}>
      {content}
    </Link>
  ) : (
    <a href={href} className={classes} {...rest}>
      {content}
    </a>
  )
}

import type { SVGProps } from 'react'

/* A hand-picked set rather than an icon dependency: eleven glyphs, one stroke
 * weight, drawn on the same 24px grid so they align optically at any size. */
const PATHS = {
  dot: 'M12 12h.01',
  check: 'M4 12.5 9.5 18 20 6.5',
  spinner: 'M12 3a9 9 0 1 0 9 9',
  alert: 'M12 8v5M12 16.5v.01M12 3.8 2.6 20h18.8L12 3.8Z',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5.5 11h13v9.5h-13z',
  copy: 'M9 9h10.5v10.5H9zM15 5.5H4.5V16',
  chevron: 'M6 9.5 12 15.5l6-6',
  layers: 'M12 3 3 7.8l9 4.7 9-4.7L12 3ZM3 12.4l9 4.7 9-4.7M3 16.8l9 4.7 9-4.7',
  split: 'M4 6h5l5 12h6M20 6h-6l-2 4.8',
  filter: 'M3 5h18l-7 8.2V21l-4-2.4v-5.4L3 5Z',
  arrow: 'M4 12h15m-6-6.5L19.5 12 13 18.5',
  refresh:
    'M20 5.5v5h-5M4 18.5v-5h5M19.3 14a7.5 7.5 0 0 1-12.6 3.2L4 13.5M4.7 10A7.5 7.5 0 0 1 17.3 6.8L20 10.5',
  sun: 'M12 5.5V3M12 21v-2.5M5.5 12H3M21 12h-2.5M7.4 7.4 5.6 5.6M18.4 18.4l-1.8-1.8M7.4 16.6l-1.8 1.8M18.4 5.6l-1.8 1.8M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z',
  monitor: 'M3.5 4.5h17v11h-17zM9 20h6M12 15.5V20',
} as const

export type IconName = keyof typeof PATHS

type IconProps = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: IconName
  size?: number
}

export function Icon({ name, size = 16, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}

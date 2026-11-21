import type { SVGProps } from 'react'

/** A query leaving for a field of memories. */
export function BrandMark({
  size = 22,
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      aria-hidden="true"
      {...rest}
    >
      <circle cx="5.5" cy="12" r="2.25" fill="currentColor" stroke="none" />
      <path d="M11 6.5a7.5 7.5 0 0 1 0 11" />
      <path d="M15.5 3.5a12 12 0 0 1 0 17" opacity="0.55" />
      <path d="M19.75 1.5a16.5 16.5 0 0 1 0 21" opacity="0.28" />
    </svg>
  )
}

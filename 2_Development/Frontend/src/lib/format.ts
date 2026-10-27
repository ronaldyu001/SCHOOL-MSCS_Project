const integer = new Intl.NumberFormat('en-US')

export function count(value: number): string {
  return integer.format(value)
}

export function ratio(numerator: number, denominator: number, digits = 1): string {
  if (denominator === 0) return '—'
  return (numerator / denominator).toFixed(digits)
}

export function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return '0%'
  return `${Math.round((numerator / denominator) * 100)}%`
}

/** Approximate on-disk size of a float32 vector set, for index footprint. */
export function bytes(value: number): string {
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`
}

export function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.round(seconds % 60)}s`
}

/** `conv-26` from a UUID, for inline references that must stay scannable. */
export function shortId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`
}

export function categoryLabel(category: string): string {
  return category
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('-')
}

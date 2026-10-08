// Pure helpers for the band: the small usage bars, reset countdowns and paths.

export const BAR_CELLS = 10

const GREEN = [34, 197, 94]
const YELLOW = [234, 179, 8]
const RED = [239, 68, 68]

function mix(a: number[], b: number[], t: number): string {
  const hex = a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * t).toString(16).padStart(2, '0'))
  return `#${hex.join('')}`
}

/** A colour sliding green → yellow (50%) → red (100%) with the value. */
export function colorFor(percent: number): string {
  const value = Math.max(0, Math.min(100, percent))
  return value <= 50 ? mix(GREEN, YELLOW, value / 50) : mix(YELLOW, RED, (value - 50) / 50)
}

/**
 * A BAR_CELLS-wide bar drawn as a thin line, in half cells: heavy `━` for the
 * filled part (`╸` for a half), light `─` for the rest.
 */
export function bar(percent: number, cells = BAR_CELLS): { filled: string; empty: string } {
  const value = Math.max(0, Math.min(100, percent))
  const halves = Math.round((value / 100) * cells * 2)
  const full = Math.floor(halves / 2)
  const half = halves % 2 === 1 ? '╸' : ''
  return { filled: '━'.repeat(full) + half, empty: '─'.repeat(cells - full - half.length) }
}

/** "2h10m", "3d4h", "now"; undefined without a reset time. */
export function untilReset(resetsAt: string | undefined, now: number): string | undefined {
  if (!resetsAt) return undefined
  const left = Math.floor((Date.parse(resetsAt) - now) / 1000)
  if (Number.isNaN(left)) return undefined
  if (left <= 0) return 'now'
  const days = Math.floor(left / 86400)
  const hours = Math.floor((left % 86400) / 3600)
  const minutes = Math.floor((left % 3600) / 60)
  if (days > 0) return `${days}d${hours}h`
  return `${hours}h${minutes}m`
}

export function basename(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** `cwd` relative to `root` ("." at the root), or the folder's name outside it. */
export function folderIn(cwd: string, root: string | undefined): string {
  if (!root) return basename(cwd)
  const base = root.replace(/\/+$/, '')
  if (cwd === base) return '.'
  if (cwd.startsWith(`${base}/`)) return cwd.slice(base.length + 1)
  return basename(cwd)
}

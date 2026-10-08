// The status line as plain spans, fitted to the width it has: the richest
// level whose text fits, dropping details one step at a time.

import type { Snapshot } from '../types'
import { bar, colorFor, untilReset } from './gauge'

export type Span = { text: string; color?: string; dim?: boolean; bold?: boolean }
export type Part = Span[]

export const SEPARATOR = ' │ '

type Level = {
  barCells: number
  showEffort: boolean
  showTokens: boolean
  showReset: boolean
  showCost: boolean
  showFolder: boolean
  showRepo: boolean
  shortLabels: boolean
}

const FULL: Level = {
  barCells: 10,
  showEffort: true,
  showTokens: true,
  showReset: true,
  showCost: true,
  showFolder: true,
  showRepo: true,
  shortLabels: false,
}

/** From the richest to the leanest; each step gives up one more detail. */
export const LEVELS: Level[] = [
  FULL,
  { ...FULL, showCost: false },
  { ...FULL, showCost: false, showTokens: false },
  { ...FULL, showCost: false, showTokens: false, barCells: 6 },
  { ...FULL, showCost: false, showTokens: false, barCells: 6, shortLabels: true },
  { ...FULL, showCost: false, showTokens: false, barCells: 6, shortLabels: true, showReset: false },
  { ...FULL, showCost: false, showTokens: false, barCells: 4, shortLabels: true, showReset: false, showEffort: false },
  { ...FULL, showCost: false, showTokens: false, barCells: 4, shortLabels: true, showReset: false, showEffort: false, showFolder: false },
  { ...FULL, showCost: false, showTokens: false, barCells: 0, shortLabels: true, showReset: false, showEffort: false, showFolder: false },
  { ...FULL, showCost: false, showTokens: false, barCells: 0, shortLabels: true, showReset: false, showEffort: false, showFolder: false, showRepo: false },
]

function compact(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`
}

function meter(label: string, percent: number | undefined, cells: number, suffix?: string): Part {
  if (percent === undefined) return [{ text: `${label} --`, dim: true }]
  const color = colorFor(percent)
  const spans: Part = [{ text: `${label} `, dim: true }]
  if (cells > 0) {
    const { filled, empty } = bar(percent, cells)
    spans.push({ text: filled, color }, { text: `${empty} `, dim: true })
  }
  spans.push({ text: `${Math.round(percent)}%`, color })
  if (suffix) spans.push({ text: ` ${suffix}`, dim: true })
  return spans
}

export function partsAt(data: Snapshot, now: number, level: Level): Part[] {
  const parts: Part[] = []

  const model: Part = [{ text: data.model, color: 'suggestion', bold: true }]
  if (level.showEffort && data.effort) model.push({ text: ` ${data.effort}`, color: 'warning' })
  if (level.showEffort && data.isThinking) model.push({ text: ' thinking', color: 'warning' })
  parts.push(model)

  if (data.repo || data.branch) {
    const repo: Part = []
    if (level.showRepo && data.repo) repo.push({ text: data.repo, bold: true })
    if (data.branch) repo.push({ text: `${repo.length ? ' ' : ''}⎇ ${data.branch}`, color: 'claude' })
    if (repo.length) parts.push(repo)
  }

  if (level.showFolder) parts.push([{ text: data.folder === '.' ? './' : data.folder }])

  const tokens =
    level.showTokens && data.contextTokens !== undefined
      ? `${compact(data.contextTokens)}/${compact(data.contextWindow)}`
      : undefined
  const reset = (at?: string) => (level.showReset ? untilReset(at, now) : undefined)
  parts.push(meter('ctx', data.contextPercent, level.barCells, tokens))
  parts.push(meter(level.shortLabels ? 'S' : 'session', data.session?.percent, level.barCells, reset(data.session?.resetsAt)))
  parts.push(meter(level.shortLabels ? 'W' : 'week', data.weekly?.percent, level.barCells, reset(data.weekly?.resetsAt)))

  if (level.showCost && data.costUsd !== undefined) parts.push([{ text: `$${data.costUsd.toFixed(2)}`, dim: true }])

  return parts
}

export function widthOf(parts: Part[]): number {
  const text = parts.reduce((sum, part) => sum + part.reduce((n, span) => n + [...span.text].length, 0), 0)
  return text + Math.max(0, parts.length - 1) * SEPARATOR.length
}

/** The richest line that fits in `columns`; the leanest when none does. */
export function fit(data: Snapshot, now: number, columns: number): Part[] {
  for (const level of LEVELS) {
    const parts = partsAt(data, now, level)
    if (widthOf(parts) <= columns) return parts
  }
  return partsAt(data, now, LEVELS[LEVELS.length - 1] ?? FULL)
}

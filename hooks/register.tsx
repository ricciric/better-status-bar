import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Container, Containers, Snapshot, Window } from '../types'
import { openCommands, parsePs } from './docker'
import { basename, folderIn } from './gauge'
import { SEPARATOR, fit } from './layout'

const snapshot = atom({ plugin: 'better-status-bar', key: 'snapshot' } as const, null)
const tick = atom({ plugin: 'better-status-bar', key: 'tick' } as const, 0)
const isDockerOpen = atom({ plugin: 'better-status-bar', key: 'isDockerOpen' } as const, false)
const containers = atom({ plugin: 'better-status-bar', key: 'containers' } as const, null)

/** How often the bar re-reads its figures and redraws, whatever else happens. */
const REFRESH_MS = 30_000

const DOCKER_LABEL = '🐳 Containers'
/** Room the containers button takes at the end of the line: the separator, a two-cell glyph and the word. */
const DOCKER_COLUMNS = SEPARATOR.length + 2 + ' Containers'.length

function windowOf(usage: Pick<SessionUsage, 'rateLimits'>, kind: string): Window | undefined {
  const limit = usage.rateLimits.find(r => r.kind === kind)
  return limit ? { percent: limit.percentUsed, resetsAt: limit.resetsAt } : undefined
}

async function branchOf($: EngineInterface): Promise<string | undefined> {
  try {
    const current = await $.process.run(['git', 'branch', '--show-current'], { timeoutMs: 3000 })
    const name = current.stdout.trim()
    if (current.exitCode === 0 && name) return name
    const sha = await $.process.run(['git', 'rev-parse', '--short', 'HEAD'], { timeoutMs: 3000 })
    return sha.exitCode === 0 ? `@${sha.stdout.trim()}` : undefined
  } catch {
    return undefined
  }
}

/** `promise`'s value, or `fallback` when it rejects: one failing read never empties the bar. */
async function orElse<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise
  } catch {
    return fallback
  }
}

async function measure($: EngineInterface, usage: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>) {
  const [model, cwd, settings, repo] = await Promise.all([
    orElse($.session.model(), 'Claude'),
    orElse($.session.cwd(), ''),
    orElse($.settings.read(), {} as Awaited<ReturnType<EngineInterface['settings']['read']>>),
    orElse($.session.repo(), null),
  ])
  const next: Snapshot = {
    model,
    effort: typeof settings.effortLevel === 'string' ? settings.effortLevel : undefined,
    isThinking: settings.alwaysThinkingEnabled === true,
    repo: repo ? basename(repo.root) : undefined,
    branch: repo ? await branchOf($) : undefined,
    folder: folderIn(cwd, repo?.root),
    contextPercent: usage.context.percent,
    contextTokens: usage.context.tokens,
    contextWindow: usage.context.window,
    costUsd: usage.cost?.usd,
    session: windowOf(usage, 'five_hour'),
    weekly: windowOf(usage, 'seven_day'),
  }
  await update($, snapshot, () => next)
}

/** Re-reads every figure and redraws the bar, also after a draw the engine dropped. */
async function refresh($: EngineInterface) {
  try {
    await measure($, await $.session.usage())
    await update($, tick, n => n + 1)
  } catch {
    // Next period tries again.
  }
  $.ui.invalidate('ui.render')
}

/** Opens `url` in the browser with the first command this system has that works. */
async function openInBrowser($: EngineInterface, url: string) {
  const uname = await $.process
    .run(['uname', '-sr'], { timeoutMs: 2000 })
    .then(r => (r.exitCode === 0 ? r.stdout.trim() : undefined))
    .catch(() => undefined)
  for (const argv of openCommands(uname, url)) {
    try {
      const run = await $.process.run(argv, { timeoutMs: 10_000 })
      // explorer.exe exits 1 even when it opened the page.
      if (run.exitCode === 0 || argv[0]?.startsWith('explorer')) return
    } catch {
      // Not on this system: try the next one.
    }
  }
  $.ui.toast(`Couldn't open ${url} in a browser`)
}

/** Whether `url` answers with an HTML page, or a redirect to one, within `ms`. */
async function servesPage($: EngineInterface, url: string, ms: number): Promise<boolean> {
  const probe = $.http
    .fetch(url)
    .then(
      r =>
        (r.status >= 300 && r.status < 400 && Boolean(r.headers.location)) ||
        (r.status < 500 && (r.headers['content-type'] ?? '').includes('text/html')),
    )
    .catch(() => false)
  const timeout = $.clock.sleep(ms).then(() => false)
  return Promise.race([probe, timeout])
}

async function listContainers($: EngineInterface): Promise<Containers> {
  let stdout: string
  try {
    const ps = await $.process.run(['docker', 'ps', '--format', '{{json .}}'], { timeoutMs: 5000 })
    if (ps.exitCode !== 0) return { error: ps.stderr.trim().split('\n')[0] || 'docker ps failed' }
    stdout = ps.stdout
  } catch {
    return { error: 'Docker is not installed or not running' }
  }

  const rows = parsePs(stdout)
  const items: Container[] = await Promise.all(
    rows.map(async row => {
      for (const port of row.ports) {
        const url = `http://localhost:${port}`
        if (await servesPage($, url, 1500)) return { ...row, url }
      }
      return row
    }),
  )
  return { items }
}

export const register: Register = on => {
  // One timer per load: a reload runs register again and stops the old one.
  let timer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)

    // A timer, not a sleep loop inside this hook: a hook's sleeps count against
    // its time limit, so a loop here died after a while and the bar stopped
    // redrawing (it vanished after the terminal sat idle or the machine slept).
    timer?.cancel()
    timer = $.clock.every(REFRESH_MS, () => void refresh($))

    return result
  })

  on('session.measure', async ($, e, next) => {
    await measure($, e)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const data = await read($, snapshot)
    if (e.props.hasSurvey || data === null) return next(e)
    await read($, tick)

    const now = await $.clock.now()
    const { Box, Button, Text } = $.ui.resolve(e)

    const parts = fit(data, now, e.props.bodyColumns - 1 - DOCKER_COLUMNS).map(part => (
      <Text>
        {part.map(span => (
          <Text color={span.color} dimColor={span.dim} bold={span.bold}>
            {span.text}
          </Text>
        ))}
      </Text>
    ))

    const refresh = async () => {
      await update($, containers, () => null)
      const found = await listContainers($)
      await update($, containers, () => found)
    }

    const toggle = async () => {
      const open = !(await read($, isDockerOpen))
      await update($, isDockerOpen, () => open)
      if (open) await refresh()
    }

    const line = (
      <Box flexDirection="row">
        <Box flexShrink={1}>
          <Text wrap="truncate-end">
            {' '}
            {parts.flatMap((part, i) => (i === 0 ? [part] : [<Text color="subtle">{SEPARATOR}</Text>, part]))}
          </Text>
        </Box>
        <Text color="subtle">{SEPARATOR}</Text>
        <Button key="docker" label={DOCKER_LABEL} plain onPress={toggle} />
      </Box>
    )

    // Other mods draw in this band too (progress plans, prompts to save a rule):
    // keep whatever they draw under the status line instead of replacing it.
    const below = await next(e)

    if (!(await read($, isDockerOpen))) {
      return (
        <Box flexDirection="column">
          {line}
          {below}
        </Box>
      )
    }

    const list = await read($, containers)
    const rows =
      list === null ? (
        <Text dimColor> Looking for containers…</Text>
      ) : 'error' in list ? (
        <Text color="error"> {list.error}</Text>
      ) : list.items.length === 0 ? (
        <Text dimColor> No running containers</Text>
      ) : (
        list.items.map(c => (
          <Box key={`row-${c.name}`} flexDirection="row">
            <Text> </Text>
            {c.url ? (
              <Button
                key={`open-${c.name}`}
                label={c.name}
                plain
                onPress={async () => {
                  if (c.url) await openInBrowser($, c.url)
                }}
              />
            ) : (
              <Text dimColor>{c.name}</Text>
            )}
            <Text dimColor wrap="truncate-end">
              {c.url ? `  ${c.url.replace('http://', '')}` : c.ports.length ? `  :${c.ports.join(', :')}` : ''}
              {`  ${c.status}`}
            </Text>
          </Box>
        ))
      )

    return (
      <Box flexDirection="column">
        {line}
        <Box flexDirection="column" borderStyle="round" borderColor="subtle">
          <Box flexDirection="row">
            <Text bold> Containers </Text>
            <Text dimColor>(click one with a page to open it) </Text>
            <Button key="docker-refresh" label="↻" plain dimColor onPress={refresh} />
            <Text> </Text>
            <Button key="docker-close" label="✕" plain dimColor onPress={() => update($, isDockerOpen, () => false)} />
          </Box>
          {rows}
        </Box>
        {below}
      </Box>
    )
  })
}

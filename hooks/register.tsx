import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionUsage } from 'claude-code'

import type { Container, Containers, Snapshot, Window } from '../types'
import { parsePs } from './docker'
import { basename, folderIn } from './gauge'
import { SEPARATOR, fit } from './layout'

const snapshot = atom({ plugin: 'better-status-bar', key: 'snapshot' } as const, null)
const tick = atom({ plugin: 'better-status-bar', key: 'tick' } as const, 0)
const isDockerOpen = atom({ plugin: 'better-status-bar', key: 'isDockerOpen' } as const, false)
const containers = atom({ plugin: 'better-status-bar', key: 'containers' } as const, null)

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

async function measure($: EngineInterface, usage: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>) {
  const [model, cwd, settings, repo] = await Promise.all([
    $.session.model(),
    $.session.cwd(),
    $.settings.read(),
    $.session.repo(),
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
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await measure($, await $.session.usage())

    // Keeps the reset countdowns current between measurements.
    void (async () => {
      try {
        for (;;) {
          await $.clock.sleep(60_000)
          await update($, tick, n => n + 1)
        }
      } catch {
        // The module was reloaded or the session ended.
      }
    })()

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

    if (!(await read($, isDockerOpen))) return line

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
                  if (c.url) await $.process.run(['open', c.url])
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
      </Box>
    )
  })
}

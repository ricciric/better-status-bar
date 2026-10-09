import { expect, mock, test } from 'claude-code/testing'

import type { On } from 'claude-code'

import type { Snapshot } from '../types'
import { hostPorts, openCommands, parsePs } from '../hooks/docker'
import { bar, colorFor, folderIn, untilReset } from '../hooks/gauge'
import { fit, widthOf } from '../hooks/layout'


/** Stands for the engine beneath the band, which draws nothing there by itself. */
function engineBand(on: On, text?: string) {
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    return text ? <Text>{text}</Text> : <Box />
  })
}

test('bars fill in half cells as a thin line', async () => {
  expect(bar(0)).toEqual({ filled: '', empty: '──────────' })
  expect(bar(50)).toEqual({ filled: '━━━━━', empty: '─────' })
  expect(bar(42)).toEqual({ filled: '━━━━', empty: '──────' })
  expect(bar(45)).toEqual({ filled: '━━━━╸', empty: '─────' })
  expect(bar(100)).toEqual({ filled: '━━━━━━━━━━', empty: '' })
  expect(bar(140).filled).toBe('━━━━━━━━━━')
})

test('the colour slides from green to red with the value', async () => {
  expect(colorFor(0)).toBe('#22c55e')
  expect(colorFor(50)).toBe('#eab308')
  expect(colorFor(100)).toBe('#ef4444')
  expect(colorFor(25)).not.toBe(colorFor(30))
})

test('folder is shown relative to the repository', async () => {
  expect(folderIn('/x/my-cool-repo/portal/frontend', '/x/my-cool-repo')).toBe('portal/frontend')
  expect(folderIn('/x/my-cool-repo', '/x/my-cool-repo')).toBe('.')
  expect(folderIn('/tmp/scratch', undefined)).toBe('scratch')
})

test('reset countdowns', async () => {
  const now = Date.parse('2026-10-09T10:00:00Z')
  expect(untilReset('2026-10-09T12:10:00Z', now)).toBe('2h10m')
  expect(untilReset('2026-10-12T14:00:00Z', now)).toBe('3d4h')
  expect(untilReset('2026-10-09T09:00:00Z', now)).toBe('now')
  expect(untilReset(undefined, now)).toBe(undefined)
})

test('the band shows repo, branch, folder and the usage bars', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-09T10:00:00Z') })
  engineBand(on)
  on('session.model', () => ({ value: 'Opus 5.5' }) as never)
  on('session.cwd', () => ({ value: '/x/my-cool-repo/portal' }) as never)
  on('session.repo', () => ({ value: { root: '/x/my-cool-repo', remote: null, internal: false, name: null } }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'main\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  on('settings.read', () => ({ value: { effortLevel: 'medium' } }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { percent: 30, tokens: 60000, window: 200000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-09T12:10:00Z' },
      { kind: 'seven_day', percentUsed: 81 },
    ],
    changed: ['context', 'rateLimits'],
  })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'better-status-bar',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 200 } as never,
    })
    const line = await ui.find({ type: 'Text', text: /^ Opus/ })
    expect(line?.text).toBe(
      ' Opus 5.5 medium │ my-cool-repo ⎇ main │ portal │ ctx ━━━─────── 30% 60k/200k │ session ━━━━────── 42% 2h10m │ week ━━━━━━━━── 81%',
    )
    await ui.unmount()
  }
})

const DATA: Snapshot = {
  model: 'Opus 5.5',
  effort: 'medium',
  isThinking: false,
  repo: 'my-cool-repo',
  branch: 'main',
  folder: 'portal/frontend',
  contextPercent: 30,
  contextTokens: 60000,
  contextWindow: 200000,
  costUsd: 1.23,
  session: { percent: 42, resetsAt: '2026-10-09T12:10:00Z' },
  weekly: { percent: 81, resetsAt: '2026-10-12T14:00:00Z' },
}
const NOW = Date.parse('2026-10-09T10:00:00Z')
const text = (columns: number) => fit(DATA, NOW, columns).map(p => p.map(s => s.text).join('')).join(' │ ')

test('a wide terminal gets every detail', async () => {
  expect(text(200)).toBe(
    'Opus 5.5 medium │ my-cool-repo ⎇ main │ portal/frontend │ ctx ━━━─────── 30% 60k/200k │ session ━━━━────── 42% 2h10m │ week ━━━━━━━━── 81% 3d4h │ $1.23',
  )
})

test('narrower terminals drop details but always fit when they can', async () => {
  let last = Infinity
  for (let columns = 200; columns >= 40; columns -= 1) {
    const width = widthOf(fit(DATA, NOW, columns))
    expect(width).toBeLessThanOrEqual(Math.max(columns, 45))
    expect(width).toBeLessThanOrEqual(last)
    last = width
  }
  expect(text(120)).toBe('Opus 5.5 medium │ my-cool-repo ⎇ main │ portal/frontend │ ctx ━━──── 30% │ S ━━╸─── 42% 2h10m │ W ━━━━━─ 81% 3d4h')
  expect(text(100)).toBe('Opus 5.5 │ my-cool-repo ⎇ main │ portal/frontend │ ctx ━─── 30% │ S ━╸── 42% │ W ━━━─ 81%')
  expect(text(60)).toBe('Opus 5.5 │ my-cool-repo ⎇ main │ ctx 30% │ S 42% │ W 81%')
  expect(text(50)).toBe('Opus 5.5 │ ⎇ main │ ctx 30% │ S 42% │ W 81%')
})

test('docker ps rows give names, status and published host ports', async () => {
  expect(hostPorts('0.0.0.0:54323->3000/tcp, [::]:54323->3000/tcp')).toEqual([54323])
  expect(hostPorts('8080/tcp')).toEqual([])
  expect(hostPorts('0.0.0.0:1->2/tcp, 0.0.0.0:3->4/udp, 0.0.0.0:5->6/tcp')).toEqual([1, 5])
  const rows = parsePs('{"Names":"web","Ports":"0.0.0.0:3000->80/tcp","Status":"Up 1h"}\n{"Names":"db","Ports":"0.0.0.0:5432->5432/tcp","Status":"Up 2h"}\nnot json\n')
  expect(rows).toEqual([
    { name: 'db', status: 'Up 2h', ports: [5432] },
    { name: 'web', status: 'Up 1h', ports: [3000] },
  ])
})

test('the containers button lists containers; only those with a page can be clicked, and open it', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-09T10:00:00Z') })
  engineBand(on)
  const opened: string[] = []
  const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('session.model', () => ({ value: 'Opus 5.5' }) as never)
  on('session.cwd', () => ({ value: '/x/my-cool-repo' }) as never)
  on('session.repo', () => ({ value: null }) as never)
  on('settings.read', () => ({ value: {} }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'docker') {
      return ok(
        '{"Names":"studio","Ports":"0.0.0.0:54323->3000/tcp","Status":"Up 6 days"}\n' +
          '{"Names":"db","Ports":"0.0.0.0:54322->5432/tcp","Status":"Up 6 days"}\n',
      ) as never
    }
    if (e.argv[0] === 'uname') return ok('Darwin 25.2.0\n') as never
    if (e.argv[0] === 'open') opened.push(e.argv[1] ?? '')
    return ok('') as never
  })
  on('http.fetch', (_$, e) =>
    (e.url.endsWith(':54323')
      ? { value: { status: 200, ok: true, headers: { 'content-type': 'text/html; charset=utf-8' }, text: '<html>' } }
      : { deny: 'connection refused' }) as never,
  )
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['context'] })

  const ui = await $.ui.mount({
    plugin: 'better-status-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /Containers/ })).toBeUndefined()
  await ui.press({ key: 'docker' })
  expect(await ui.find({ type: 'Button', key: 'open-studio' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'open-db' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^db$/ })).toBeDefined()
  await ui.press({ key: 'open-studio' })
  expect(opened).toEqual(['http://localhost:54323'])
  await ui.press({ key: 'docker-close' })
  expect(await ui.find({ type: 'Text', text: /Containers/ })).toBeUndefined()
  await ui.unmount()
})

test('the containers button reads "🐳 Containers" after a separator', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-09T10:00:00Z') })
  engineBand(on)
  on('session.model', () => ({ value: 'Opus 5.5' }) as never)
  on('session.cwd', () => ({ value: '/x' }) as never)
  on('session.repo', () => ({ value: null }) as never)
  on('settings.read', () => ({ value: {} }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({
    plugin: 'better-status-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120 } as never,
  })
  const drawn = JSON.stringify(await ui.drawn())
  expect(drawn).toContain('"label":"🐳 Containers"')
  expect(drawn).toMatch(/" │ "\]\},\{"type":"Button"/)
  await ui.unmount()
})

test('another mod drawing in the band stays visible under the status line', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-09T10:00:00Z') })
  engineBand(on, 'beneath row')
  on('session.model', () => ({ value: 'Opus 5.5' }) as never)
  on('session.cwd', () => ({ value: '/x' }) as never)
  on('session.repo', () => ({ value: null }) as never)
  on('settings.read', () => ({ value: {} }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({
    plugin: 'better-status-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /^ Opus/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /beneath row/ })).toBeDefined()
  await ui.unmount()
})

test('the browser is opened with the command each system has', async () => {
  const url = 'http://localhost:3000'
  expect(openCommands('Darwin 25.2.0', url)).toEqual([['open', url]])
  expect(openCommands('Linux 5.15.167.4-microsoft-standard-WSL2', url)).toEqual([
    ['wslview', url],
    ['cmd.exe', '/c', 'start', '', url],
    ['explorer.exe', url],
  ])
  expect(openCommands('Linux 6.8.0-45-generic', url)[0]).toEqual(['xdg-open', url])
  expect(openCommands(undefined, url)[0]).toEqual(['cmd', '/c', 'start', '', url])
})

test('on WSL without wslview, a container page opens through cmd.exe', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-09T10:00:00Z') })
  engineBand(on)
  const ran: string[] = []
  const result = (exitCode: number, stdout = '') => ({
    value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })
  on('session.model', () => ({ value: 'Opus 5.5' }) as never)
  on('session.cwd', () => ({ value: '/x' }) as never)
  on('session.repo', () => ({ value: null }) as never)
  on('settings.read', () => ({ value: {} }) as never)
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('process.run', (_$, e) => {
    ran.push(e.argv.join(' '))
    if (e.argv[0] === 'docker') return result(0, '{"Names":"web","Ports":"0.0.0.0:3000->80/tcp","Status":"Up"}\n') as never
    if (e.argv[0] === 'uname') return result(0, 'Linux 5.15.167.4-microsoft-standard-WSL2\n') as never
    if (e.argv[0] === 'wslview') return { deny: 'not found' } as never
    return result(0) as never
  })
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: { 'content-type': 'text/html' }, text: '' } }) as never)
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: ['context'] })
  const ui = await $.ui.mount({
    plugin: 'better-status-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120 } as never,
  })
  await ui.press({ key: 'docker' })
  await ui.press({ key: 'open-web' })
  expect(ran.filter(r => !r.startsWith('docker') && !r.startsWith('uname'))).toEqual([
    'wslview http://localhost:3000',
    'cmd.exe /c start  http://localhost:3000',
  ])
  await ui.unmount()
})

test('the bar refreshes on its own every 30 seconds, with no turn in between', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-09T10:00:00Z') })
  engineBand(on)
  let model = 'Opus 5.5'
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }) as never)
  on('session.model', () => ({ value: model }) as never)
  on('session.cwd', () => ({ value: '/x' }) as never)
  on('session.repo', () => ({ value: null }) as never)
  on('settings.read', () => ({ value: {} }) as never)
  await $.session.start({ cwd: '/x', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'better-status-bar',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 120 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /^Opus 5\.5/ })).toBeDefined()
  model = 'Sonnet 5.5'
  await clock.advance(30_000)
  expect(await ui.find({ type: 'Text', text: /^Sonnet 5\.5/ })).toBeDefined()
  await ui.unmount()
})

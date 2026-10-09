// Parsing `docker ps` output: container names, status and published ports.

type PsRow = { Names?: string; Ports?: string; Status?: string; Image?: string }

/** The host TCP ports a `docker ps` Ports column publishes, in order, once each. */
export function hostPorts(ports: string): number[] {
  const found = [...ports.matchAll(/:(\d+)->\d+\/tcp/g)].map(m => Number(m[1]))
  return [...new Set(found)]
}

export function parsePs(stdout: string): { name: string; status: string; ports: number[] }[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      try {
        const row = JSON.parse(line) as PsRow
        return [{ name: row.Names ?? '?', status: row.Status ?? '', ports: hostPorts(row.Ports ?? '') }]
      } catch {
        return []
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The commands that open `url` in the browser, to try in order, from what
 * `uname -sr` printed (undefined when it could not run: native Windows).
 *
 * WSL opens the page in the Windows browser: `wslview` (wslu) when it is
 * installed, else Windows' own `cmd.exe start` or `explorer.exe`.
 */
export function openCommands(uname: string | undefined, url: string): string[][] {
  const system = (uname ?? '').toLowerCase()
  if (system.startsWith('darwin')) return [['open', url]]
  if (system.includes('microsoft') || system.includes('wsl')) {
    return [['wslview', url], ['cmd.exe', '/c', 'start', '', url], ['explorer.exe', url]]
  }
  if (system.startsWith('linux') || system.includes('bsd')) return [['xdg-open', url], ['gio', 'open', url]]
  return [['cmd', '/c', 'start', '', url], ['explorer', url]]
}

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

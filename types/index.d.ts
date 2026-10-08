export type Window = { percent: number; resetsAt?: string }

export type Snapshot = {
  model: string
  effort?: string
  isThinking: boolean
  /** The repository's folder name, absent outside a git repository. */
  repo?: string
  /** The checked-out branch, or `@<sha>` when detached. */
  branch?: string
  /** The working folder: relative to the repository root inside one, else its name. */
  folder: string
  contextPercent?: number
  contextTokens?: number
  contextWindow: number
  costUsd?: number
  session?: Window
  weekly?: Window
}

/** A running container; `url` is set only when one of its ports serves an HTML page. */
export type Container = { name: string; status: string; ports: number[]; url?: string }

/** The last `docker ps` read: the containers, or why there are none. */
export type Containers = { items: Container[] } | { error: string }

declare module 'claude-code' {
  interface PluginState {
    'better-status-bar': {
      snapshot: Snapshot | null
      tick: number
      isDockerOpen: boolean
      containers: Containers | null
    }
  }
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = { status: TaskStatus; label: string }

/** The plan file progress is read from when there are no todos */
export type Plan = { path: string; tasks: Task[] }

/** Main-loop vitals, drawn like Flightdeck's main panel */
export type Main = {
  model: string
  effort: string
  mode: string
  steps: number
  isRunning: boolean
  pct: number | null
  tokens: number | null
  window: number
  compactions: number
  costUsd: number | null
  limits: Array<{ kind: string; pct: number }>
}

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { tasks: Record<string, Task>; main: Main; plan: Plan }
  }
}

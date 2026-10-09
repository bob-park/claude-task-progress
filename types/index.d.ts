export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/** `n`: the task's number when its source has one (plan `Task N`, TaskCreate id, `1.` step) */
export type Task = { status: TaskStatus; label: string; n?: string }

/** A subagent the model spawned, listed under the tasks */
export type AgentRun = { n: number; label: string; model: string; startedAt: number; endedAt?: number; ok?: boolean }

/** The plan file progress is read from when there are no todos */
export type Plan = { path: string; tasks: Task[] }

/** Main-loop vitals, drawn like Flightdeck's main panel */
export type Main = {
  model: string
  effort: string
  mode: string
  steps: number
  isRunning: boolean
  /** The main loop's latest tool call, shown when there are no tasks */
  activity: string
  pct: number | null
  tokens: number | null
  window: number
  compactions: number
  costUsd: number | null
  limits: Array<{ kind: string; pct: number }>
}

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { tasks: Record<string, Task>; main: Main; plan: Plan; agents: Record<string, AgentRun> }
  }
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/** `n`: the task's number when its source has one (plan `Task N`, TaskCreate id, `1.` step) */
export type Task = { status: TaskStatus; label: string; n?: string }

/** A subagent the model spawned, listed under the tasks */
export type AgentRun = { n: number; label: string; model: string; startedAt: number; endedAt?: number }

/** The plan file progress is read from when there are no todos; `finishing` once finishing-a-development-branch ran on it */
export type Plan = { path: string; tasks: Task[]; finishing?: boolean }

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
  /** When the shown tasks all became completed */
  doneAt: number | null
}

export type Stage = 'brainstorm' | 'spec' | 'plan' | 'worktree' | 'execute' | 'review' | 'finish'
export type SpPath = 'spike' | 'bounded' | 'architectural'
/** What superpowers dispatched an agent for: SDD's implementer, or any review */
export type Role = 'impl' | 'review'

/** The superpowers workflow so far; empty `stages` until a superpowers skill runs */
export type Sp = { path?: SpPath; stages: Stage[]; current?: Stage; extras: string[]; doneAt: number | null }

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { tasks: Record<string, Task>; main: Main; plan: Plan; agents: Record<string, AgentRun> }
  }
}

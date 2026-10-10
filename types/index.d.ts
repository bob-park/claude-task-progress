export type TaskStatus = 'pending' | 'in_progress' | 'completed'

/** `n`: the task's number when its source has one (plan `Task N`, TaskCreate id, `1.` step) */
export type Task = { status: TaskStatus; label: string; n?: string }

export type AgentStatus = 'running' | 'waiting' | 'done' | 'failed'

/** A subagent the model spawned; kept once it ends (`endedAt`), up to the latest 20 */
export type AgentRun = {
  n: number
  label: string
  model: string
  startedAt: number
  endedAt?: number
  status: AgentStatus
  /** Set when superpowers dispatched it; such an agent shows under SUPERPOWERS, not AGENTS */
  role?: Role
  taskN?: string
  /** A reviewer's report: approved, or issues to fix */
  verdict?: 'ok' | 'issues'
}

/** A skill the session ran, in order */
export type SkillUse = { name: string; at: number }

/** A main-loop tool call: `Bash · Run tests` */
export type Activity = { id: number; at: number; label: string; status: 'running' | 'ok' | 'error' }

/** The active plan: a superpowers plan shows under SUPERPOWERS, a plan-mode plan under TASKS */
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
  /** When the shown tasks all became completed */
  doneAt: number | null
}

export type Stage = 'brainstorm' | 'spec' | 'plan' | 'worktree' | 'execute' | 'review' | 'finish'
/** How big the work is: superpowers 7.0.0 sizes it; a spike skips the plan workflow */
export type SpPath = 'spike' | 'small' | 'project'
/** What superpowers dispatched an agent for: SDD's implementer, or any review */
export type Role = 'impl' | 'review'

/** The superpowers workflow so far; empty `stages` until a superpowers skill runs */
export type Sp = { path?: SpPath; stages: Stage[]; current?: Stage; extras: string[]; doneAt: number | null }

declare module 'claude-code' {
  interface PluginState {
    'task-progress': {
      tasks: Record<string, Task>
      main: Main
      plan: Plan
      agents: Record<string, AgentRun>
      skills: SkillUse[]
      activity: Activity[]
      sp: Sp
    }
  }
}

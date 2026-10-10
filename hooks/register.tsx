import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, Register, Timer } from 'claude-code'

import type { Activity, AgentRun, AgentStatus, Main, Plan, SkillUse, Task } from '../types'
import { isPlanPath, keepCompleted, ledgerOwns, ledgerPath, parsePlan } from './plan'
import { skillName } from './superpowers'
import { activityPanel, agentsPanel, FRAME_MS, mainPanel, skillsPanel, SPINNER, tasksPanel } from './view'

const tasks = atom({ plugin: 'task-progress', key: 'tasks' } as const, {} as Record<string, Task>)
const plan = atom({ plugin: 'task-progress', key: 'plan' } as const, { path: '', tasks: [] } as Plan)
const agents = atom({ plugin: 'task-progress', key: 'agents' } as const, {} as Record<string, AgentRun>)
const skills = atom({ plugin: 'task-progress', key: 'skills' } as const, [] as SkillUse[])
const activity = atom({ plugin: 'task-progress', key: 'activity' } as const, [] as Activity[])

const MAX_AGENTS = 20
const MAX_ACTIVITY = 10
const MAX_SKILLS = 30
const live = (r: AgentRun) => r.status === 'running' || r.status === 'waiting'
// the oldest ended agents go first; running ones always stay
const trimAgents = (all: Record<string, AgentRun>) => {
  const ended = Object.entries(all).filter(([, r]) => !live(r)).sort(([, a], [, b]) => a.startedAt - b.startedAt)
  const drop = new Set(ended.slice(0, Math.max(0, Object.keys(all).length - MAX_AGENTS)).map(([id]) => id))
  return Object.fromEntries(Object.entries(all).filter(([id]) => !drop.has(id)))
}
// ties an activity row to its tool call across `next(e)`
let seq = 0

// a failed read keeps what the pane already shows
const refreshPlan = async ($: EngineInterface, path: string) => {
  const text = await $.fs.read(path).catch(() => null)
  if (typeof text !== 'string') return
  const at = ledgerPath(path)
  const ledger = at ? await $.fs.read(at).catch(() => null) : null
  const owned = typeof ledger === 'string' && ledgerOwns(path, ledger) ? ledger : undefined
  const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
  await update($, plan, prev => {
    const tasks = parsePlan(text, owned)
    // same plan (maybe now in the main checkout): done stays done
    const same = !!prev?.path && base(prev.path) === base(path)
    return { path, tasks: same ? keepCompleted(prev.tasks, tasks) : tasks, ...(same && prev.finishing ? { finishing: true } : {}) }
  })
}

const DEFAULT_MAIN: Main = {
  model: '',
  effort: '',
  mode: '',
  steps: 0,
  isRunning: false,
  pct: null,
  tokens: null,
  window: 0,
  compactions: 0,
  costUsd: null,
  limits: [],
  doneAt: null,
}
const main = atom({ plugin: 'task-progress', key: 'main' } as const, DEFAULT_MAIN)

const PANE = 'task-progress'
const PANE_COLUMNS = 48

const setMain = ($: EngineInterface, patch: (m: Main) => Partial<Main>) => update($, main, m => ({ ...DEFAULT_MAIN, ...m, ...patch({ ...DEFAULT_MAIN, ...m }) }))

type Usage = Awaited<ReturnType<EngineInterface['session']['usage']>>
const usageOf = (u: Pick<Usage, 'context' | 'cost' | 'rateLimits'>): Partial<Main> => ({
  pct: u.context.percent ?? null,
  tokens: u.context.tokens ?? null,
  window: u.context.window,
  costUsd: u.cost?.usd ?? null,
  limits: u.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed })),
})

// while a turn runs the pane redraws on a clock so the spinner and shimmer move
const frame = () => Math.floor(Date.now() / FRAME_MS)
let ticker: Timer | undefined
// the clock runs while the main turn or any agent is working
const animate = async ($: EngineInterface) => {
  const [m, a] = await Promise.all([read($, main), read($, agents)])
  const on = !!m?.isRunning || Object.values(a ?? {}).some(live)
  if (on) ticker ??= $.clock.every(FRAME_MS, () => $.ui.invalidate('ui.render'))
  else ticker = void ticker?.cancel()
}

// todos win, unless all are done and a plan still has open work
const shownTasks = (todos: Task[], p: Plan | undefined) => {
  const planOpen = (p?.tasks ?? []).some(t => t.status !== 'completed')
  return todos.some(t => t.status !== 'completed') || (todos.length > 0 && !planOpen) ? todos : (p?.tasks ?? [])
}

// the moment the shown list became all done; cleared once something is open again
const stampDone = async ($: EngineInterface) => {
  const [todos, p, m] = await Promise.all([read($, tasks).then(t => Object.values(t ?? {})), read($, plan), read($, main)])
  const list = shownTasks(todos, p)
  const allDone = list.length > 0 && list.every(t => t.status === 'completed')
  const stamped = typeof m?.doneAt === 'number'
  if (allDone && !stamped) {
    const at = await $.clock.now()
    await setMain($, () => ({ doneAt: at }))
  } else if (!allDone && stamped) await setMain($, () => ({ doneAt: null }))
}

// `Bash · Run tests`, `Read · plan.ts`: the tool and the most telling input it has
const activityOf = (e: { tool: string; description?: unknown; file_path?: unknown; pattern?: unknown; command?: unknown }) => {
  const what = [e.description, e.file_path, e.pattern, e.command].find(x => typeof x === 'string' && x) as string | undefined
  return what ? `${e.tool} · ${what.slice(what.lastIndexOf('/') + 1)}` : e.tool
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Task Progress', columns: PANE_COLUMNS, rows: 8 })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'task-progress', description: 'Open or close the task progress pane', argumentHint: '[close]' })
    // a host without usage (headless, SDK) just starts without it
    const u = await $.session.usage().catch(() => null)
    if (u) await setMain($, () => usageOf(u))
    void openPane($).catch(() => undefined)
    return next(e)
  })

  on('command.run', { command: 'task-progress' }, async ($, e) => {
    if (e.args.trim() === 'close') {
      await $.ui.close({ id: PANE })
      return { text: 'Task progress closed.' }
    }
    const opened = await openPane($)
    return { text: opened.isPlaced ? 'Task progress opened.' : `Task progress is not shown yet: ${opened.reason}` }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.permission_mode) await setMain($, () => ({ mode: e.permission_mode }))
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await setMain($, () => ({ isRunning: true }))
    await animate($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId) {
      const { agentId } = e
      // an agent waiting on its own background work ends its turn but isn't done
      const waiting = (await $.agent.list().catch(() => [])).find(a => a.id === agentId)?.status === 'waiting'
      const at = await $.clock.now()
      const status: AgentStatus = waiting ? 'waiting' : e.reason === 'error' || e.reason === 'aborted' ? 'failed' : 'done'
      await update($, agents, all => {
        const r = all?.[agentId]
        return r ? { ...all, [agentId]: { ...r, status, ...(waiting ? {} : { endedAt: at }) } } : all
      })
    } else await setMain($, () => ({ isRunning: false }))
    await animate($)
    return done
  })

  on('turn.step', async function* ($, e, next) {
    const { agentId } = e
    if (!agentId) await setMain($, m => ({ model: e.model, effort: String(e.effort ?? m.effort), steps: m.steps + 1 }))
    else {
      // a step after its end: the agent resumed once its background work came back
      const r = (await read($, agents))?.[agentId]
      if (r) {
        const { endedAt: _, ...run } = r
        await update($, agents, all => ({ ...all, [agentId]: { ...run, model: e.model, status: 'running' as const } }))
        if (!live(r)) await animate($)
      }
    }
    return yield* next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    const { agentId, model = '' } = spawned as { agentId?: string; model?: string }
    if (agentId) {
      const startedAt = await $.clock.now()
      // next after the highest still listed: one left running keeps its number
      await update($, agents, all =>
        trimAgents({
          ...all,
          [agentId]: { n: Math.max(0, ...Object.values(all ?? {}).map(r => r.n)) + 1, label: e.description || e.subagentType, model, startedAt, status: 'running' },
        }),
      )
      await animate($)
    }
    return spawned
  })

  on('skill.prompt', async ($, e, next) => {
    const at = await $.clock.now()
    const name = skillName(e.skill)
    // the same skill twice in a row is one entry
    await update($, skills, all => (all?.at(-1)?.name === name ? all : [...(all ?? []), { name, at }].slice(-MAX_SKILLS)))
    if (/(^|:)finishing-a-development-branch$/.test(e.skill)) await update($, plan, p => ({ ...(p ?? { path: '', tasks: [] }), finishing: true }))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await setMain($, () => usageOf(e))
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (!e.agentId && e.trigger !== 'precompute') await setMain($, m => ({ compactions: m.compactions + 1 }))
    return done
  })

  on('tool.call', async ($, e, next) => {
    const id = ++seq
    if (!e.agentId) {
      const row = { id, at: await $.clock.now(), label: activityOf(e as Parameters<typeof activityOf>[0]), status: 'running' as const }
      await update($, activity, all => [...(all ?? []), row].slice(-MAX_ACTIVITY))
    }
    const ran = await next(e)
    if (!e.agentId) {
      const status = ran.deny !== undefined || ran.isError ? ('error' as const) : ('ok' as const)
      await update($, activity, all => (all ?? []).map(a => (a.id === id ? { ...a, status } : a)))
    }
    if (ran.deny !== undefined || ran.isError) return ran

    if (e.tool === 'TodoWrite') {
      // TodoWrite replaces the whole list
      const list = Object.fromEntries(e.todos.map((t, i) => [`todo:${i}`, { status: t.status, label: t.activeForm || t.content }]))
      await update($, tasks, () => list)
    } else if (e.tool === 'TaskCreate') {
      // next(e) ran before e.tool was narrowed, so result isn't typed per tool
      const id = (ran.result as BuiltinToolResults['TaskCreate'] | undefined)?.task?.id
      const label = e.activeForm || e.subject
      if (id) await update($, tasks, all => ({ ...all, [id]: { status: 'pending' as const, label, n: id } }))
    } else if (e.tool === 'TaskUpdate') {
      const { taskId, status, activeForm, subject } = e
      await update($, tasks, all => {
        const { [taskId]: prev, ...rest } = all
        if (status === 'deleted' || !prev) return rest
        return { ...rest, [taskId]: { ...prev, status: status ?? prev.status, label: activeForm || subject || prev.label } }
      })
    }

    if (e.agentId) {
      await stampDone($)
      return ran
    }
    const planned = e.tool === 'ExitPlanMode' ? (ran.result as BuiltinToolResults['ExitPlanMode'] | undefined)?.filePath : undefined
    // Read too: a plan written in an earlier session is executed by reading it
    const written = (e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'Read') && isPlanPath(e.file_path) ? e.file_path : undefined
    const path = planned ?? written ?? (await read($, plan))?.path
    if (path) await refreshPlan($, path)
    await stampDone($)
    if (!planned) return ran
    return { ...ran, context: [...(ran.context ?? []), `Mark each step done by ticking it (- [x], or 1. [x] for numbered steps) in ${planned} as you finish it.`] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [m, todos, p, runs, used, acts, now] = await Promise.all([
      read($, main).then(x => ({ ...DEFAULT_MAIN, ...x })),
      read($, tasks).then(Object.values),
      read($, plan),
      read($, agents).then(a => Object.values(a ?? {})),
      read($, skills).then(s => s ?? []),
      read($, activity).then(a => a ?? []),
      $.clock.now(),
    ])
    const list = shownTasks(todos, p)
    const ui = $.ui.resolve(e)
    const { Box } = ui
    const f = frame()
    // a background agent keeps the session working after the main turn ends
    const v = { W: Math.max(30, e.props.bodyColumns), f, spin: SPINNER[f % SPINNER.length]!, busy: m.isRunning || runs.some(live), now }
    return (
      <Box flexDirection="column">
        {mainPanel(ui, m, v)}
        {list.length > 0 ? tasksPanel(ui, list, m.doneAt, !!p?.finishing, v) : null}
        {runs.length > 0 ? agentsPanel(ui, runs, v) : null}
        {used.length > 0 ? skillsPanel(ui, used.map(u => u.name), v) : null}
        {acts.length > 0 ? activityPanel(ui, acts, v) : null}
      </Box>
    )
  })
}

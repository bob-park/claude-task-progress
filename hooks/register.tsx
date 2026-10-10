import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, Register, Timer } from 'claude-code'

import type { Activity, AgentRun, AgentStatus, Main, Plan, SkillUse, Sp, Task } from '../types'
import { isPlanPath, keepCompleted, ledgerOwns, ledgerPath, parsePlan } from './plan'
import { addExtra, EMPTY_SP, extraOf, isSpecPath, pathFrom, reach, roleOf, skillName, stageOf, taskNOf, verdictOf } from './superpowers'
import { activityPanel, agentsPanel, FRAME_MS, mainPanel, skillsPanel, spPanel, SPINNER, tasksPanel } from './view'

const tasks = atom({ plugin: 'task-progress', key: 'tasks' } as const, {} as Record<string, Task>)
const plan = atom({ plugin: 'task-progress', key: 'plan' } as const, { path: '', tasks: [] } as Plan)
const agents = atom({ plugin: 'task-progress', key: 'agents' } as const, {} as Record<string, AgentRun>)
const skills = atom({ plugin: 'task-progress', key: 'skills' } as const, [] as SkillUse[])
const activity = atom({ plugin: 'task-progress', key: 'activity' } as const, [] as Activity[])
const sp = atom({ plugin: 'task-progress', key: 'sp' } as const, EMPTY_SP)
const updateSp = ($: EngineInterface, patch: (s: Sp) => Sp) => update($, sp, s => patch({ ...EMPTY_SP, ...s }))

const MAX_AGENTS = 20
const MAX_ACTIVITY = 10
const MAX_SKILLS = 30
/** An agent saved before `status` existed (0.6, kept across a hot reload) reads from its end time */
export const withStatus = (r: AgentRun): AgentRun => (r.status ? r : { ...r, status: r.endedAt === undefined ? 'running' : 'done' })
const live = (r: AgentRun) => ['running', 'waiting'].includes(withStatus(r).status)
// the oldest ended agents go first; running ones always stay
const trimAgents = (all: Record<string, AgentRun>) => {
  const ended = Object.entries(all).filter(([, r]) => !live(r)).sort(([, a], [, b]) => a.startedAt - b.startedAt)
  const drop = new Set(ended.slice(0, Math.max(0, Object.keys(all).length - MAX_AGENTS)).map(([id]) => id))
  return Object.fromEntries(Object.entries(all).filter(([id]) => !drop.has(id)))
}
/** Appends a row with the next id after the kept rows: ids outlive a hot reload, a module counter would not */
export const pushActivity = (all: Activity[], row: Omit<Activity, 'id'>) => {
  const id = Math.max(0, ...all.map(a => a.id)) + 1
  return { id, list: [...all, { ...row, id }].slice(-MAX_ACTIVITY) }
}

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
    return { path, tasks: same ? keepCompleted(prev.tasks, tasks) : tasks }
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

// a superpowers plan has an SDD ledger beside it; a plan-mode plan has none
const isSpPlan = (p: Plan | undefined) => !!p?.path && ledgerPath(p.path) !== null
const spTasks = (p: Plan | undefined) => (isSpPlan(p) ? p!.tasks : [])

// TASKS: todos win, unless all are done and a plan-mode plan still has open work
const shownTasks = (todos: Task[], p: Plan | undefined) => {
  const pm = isSpPlan(p) ? [] : (p?.tasks ?? [])
  const planOpen = pm.some(t => t.status !== 'completed')
  return todos.some(t => t.status !== 'completed') || (todos.length > 0 && !planOpen) ? todos : pm
}

const allDone = (list: Task[]) => list.length > 0 && list.every(t => t.status === 'completed')

// the moment each list became all done; cleared once something is open again
const stampDone = async ($: EngineInterface) => {
  const [todos, p, m, s] = await Promise.all([read($, tasks).then(t => Object.values(t ?? {})), read($, plan), read($, main), read($, sp)])
  const tasksDone = allDone(shownTasks(todos, p))
  const planDone = allDone(spTasks(p))
  if (tasksDone === (typeof m?.doneAt === 'number') && planDone === (typeof s?.doneAt === 'number')) return
  const at = await $.clock.now()
  if (tasksDone !== (typeof m?.doneAt === 'number')) await setMain($, () => ({ doneAt: tasksDone ? at : null }))
  if (planDone !== (typeof s?.doneAt === 'number')) await updateSp($, x => ({ ...x, doneAt: planDone ? at : null }))
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
        const verdict = r?.role === 'review' && !waiting ? verdictOf(e.answer) : undefined
        return r ? { ...all, [agentId]: { ...r, status, ...(waiting ? {} : { endedAt: at }), ...(verdict ? { verdict } : {}) } } : all
      })
    } else {
      await setMain($, () => ({ isRunning: false }))
      // brainstorming says out loud which path it takes
      const path = pathFrom(e.answer)
      if (path) await updateSp($, s => (s.current === 'brainstorm' ? { ...s, path } : s))
    }
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
      // while superpowers runs (until it finishes), its implementers and reviewers get a role
      const s = await read($, sp)
      const role = s?.stages.length && s.current !== 'finish' ? roleOf(e.description) : undefined
      // the description alone: prompts quote plan text, Task numbers included
      const taskN = role ? taskNOf(e.description) : undefined
      // SDD's whole-branch review has no task: execution is over
      if (role === 'review' && !taskN && s?.current === 'execute') await updateSp($, x => reach(x, 'review'))
      // next after the highest still listed: one left running keeps its number
      await update($, agents, all =>
        trimAgents({
          ...all,
          [agentId]: { n: Math.max(0, ...Object.values(all ?? {}).map(r => r.n)) + 1, label: e.description || e.subagentType, model, startedAt, status: 'running', ...(role ? { role } : {}), ...(taskN ? { taskN } : {}) },
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
    const stage = stageOf(e.skill)
    const extra = extraOf(e.skill)
    if (stage) await updateSp($, s => reach(s, stage))
    else if (extra) await updateSp($, s => addExtra(s, extra))
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
    let id = 0
    if (!e.agentId) {
      const row = { at: await $.clock.now(), label: activityOf(e as Parameters<typeof activityOf>[0]), status: 'running' as const }
      await update($, activity, all => {
        const pushed = pushActivity(all ?? [], row)
        id = pushed.id
        return pushed.list
      })
    }
    const settle = async (status: Activity['status']) => {
      if (id) await update($, activity, all => (all ?? []).map(a => (a.id === id ? { ...a, status } : a)))
    }
    let ran: Awaited<ReturnType<typeof next>>
    try {
      ran = await next(e)
    } catch (err) {
      await settle('error')
      throw err
    }
    await settle(ran.deny !== undefined || ran.isError ? 'error' : 'ok')
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
    const prev = await read($, plan)
    const path = planned ?? written ?? prev?.path
    if (path) await refreshPlan($, path)
    if ((e.tool === 'Write' || e.tool === 'Edit') && isSpecPath(e.file_path)) await updateSp($, s => reach(s, 'spec'))
    // a superpowers plan reaches the plan stage; one already reached is only re-read
    const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
    if (written && ledgerPath(written)) {
      const fresh = !prev?.path || base(prev.path) !== base(written)
      await updateSp($, s => (fresh || !s.stages.includes('plan') ? reach(s, 'plan') : s))
    }
    await stampDone($)
    if (!planned) return ran
    return { ...ran, context: [...(ran.context ?? []), `Mark each step done by ticking it (- [x], or 1. [x] for numbered steps) in ${planned} as you finish it.`] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [m, todos, p, runs, used, acts, s, now] = await Promise.all([
      read($, main).then(x => ({ ...DEFAULT_MAIN, ...x })),
      read($, tasks).then(Object.values),
      read($, plan),
      read($, agents).then(a => Object.values(a ?? {}).map(withStatus)),
      read($, skills).then(s => s ?? []),
      read($, activity).then(a => a ?? []),
      read($, sp).then(x => ({ ...EMPTY_SP, ...x })),
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
        {s.stages.length > 0 ? spPanel(ui, s, spTasks(p), runs, v) : null}
        {list.length > 0 ? tasksPanel(ui, list, m.doneAt, v) : null}
        {runs.some(r => !r.role) ? agentsPanel(ui, runs, v) : null}
        {used.length > 0 ? skillsPanel(ui, used.map(u => u.name), v) : null}
        {acts.length > 0 ? activityPanel(ui, acts, v) : null}
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, Register, Timer } from 'claude-code'

import type { AgentRun, Main, Plan, Task } from '../types'
import { isPlanPath, keepCompleted, ledgerOwns, ledgerPath, parsePlan } from './plan'

const tasks = atom({ plugin: 'task-progress', key: 'tasks' } as const, {} as Record<string, Task>)
const plan = atom({ plugin: 'task-progress', key: 'plan' } as const, { path: '', tasks: [] } as Plan)
const agents = atom({ plugin: 'task-progress', key: 'agents' } as const, {} as Record<string, AgentRun>)

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
  activity: '',
  pct: null,
  tokens: null,
  window: 0,
  compactions: 0,
  costUsd: null,
  limits: [],
}
const main = atom({ plugin: 'task-progress', key: 'main' } as const, DEFAULT_MAIN)

const PANE = 'task-progress'
const PANE_COLUMNS = 48

// Formatting below is adapted from Flightdeck (MIT, github.com/scasella/claude-flightdeck)
const prettyModel = (id: string) => {
  if (!id) return '—'
  const m = /claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?![\d])/i.exec(id)
  return m?.[1] ? `${m[1].charAt(0).toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : id.slice(0, 22)
}
const kTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const fmtUsd = (n: number) => (n >= 100 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`)
const gauge = (pct: number, width: number) => {
  const full = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return { on: '▰'.repeat(full), off: '▱'.repeat(width - full) }
}
const limitLabel = (kind: string) =>
  kind
    .replace(/five[_ -]?hours?/i, '5h')
    .replace(/seven[_ -]?days?/i, '7d')
    .replace(/[_-]+/g, ' ')
    .trim()

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
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const FRAME_MS = 100
const frame = () => Math.floor(Date.now() / FRAME_MS)
let ticker: Timer | undefined
// the clock runs while the main turn or any agent is working
const animate = async ($: EngineInterface) => {
  const [m, a] = await Promise.all([read($, main), read($, agents)])
  const on = !!m?.isRunning || Object.values(a ?? {}).some(r => r.endedAt === undefined)
  if (on) ticker ??= $.clock.every(FRAME_MS, () => $.ui.invalidate('ui.render'))
  else ticker = void ticker?.cancel()
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
const numbered = (t: Task) => (t.n ? `#${t.n} ${t.label}` : t.label)

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
    // a new prompt clears agents that finished before it
    await update($, agents, all => Object.fromEntries(Object.entries(all ?? {}).filter(([, r]) => r.endedAt === undefined)))
    await animate($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId) {
      const { agentId } = e
      // an agent waiting on its own background work ends its turn but isn't done
      const status = (await $.agent.list().catch(() => [])).find(a => a.id === agentId)?.status
      if (status === 'waiting') return done
      const at = await $.clock.now()
      await update($, agents, all => {
        const r = all?.[agentId]
        return r ? { ...all, [agentId]: { ...r, endedAt: at, ok: e.reason === 'answer' } } : all
      })
    } else await setMain($, () => ({ isRunning: false, activity: '' }))
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
        const { endedAt, ok: _, ...run } = r
        await update($, agents, all => ({ ...all, [agentId]: { ...run, model: e.model } }))
        if (endedAt !== undefined) await animate($)
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
      await update($, agents, all => ({
        ...all,
        [agentId]: { n: Math.max(0, ...Object.values(all ?? {}).map(r => r.n)) + 1, label: e.description || e.subagentType, model, startedAt },
      }))
      await animate($)
    }
    return spawned
  })

  on('skill.prompt', async ($, e, next) => {
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
    if (!e.agentId) await setMain($, () => ({ activity: activityOf(e as Parameters<typeof activityOf>[0]) }))
    const ran = await next(e)
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

    if (e.agentId) return ran
    const planned = e.tool === 'ExitPlanMode' ? (ran.result as BuiltinToolResults['ExitPlanMode'] | undefined)?.filePath : undefined
    // Read too: a plan written in an earlier session is executed by reading it
    const written = (e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'Read') && isPlanPath(e.file_path) ? e.file_path : undefined
    const path = planned ?? written ?? (await read($, plan))?.path
    if (path) await refreshPlan($, path)
    if (!planned) return ran
    return { ...ran, context: [...(ran.context ?? []), `Mark each step done by ticking it (- [x], or 1. [x] for numbered steps) in ${planned} as you finish it.`] }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const [m, todos, p, runs, now] = await Promise.all([
      read($, main).then(x => ({ ...DEFAULT_MAIN, ...x })),
      read($, tasks).then(Object.values),
      read($, plan),
      read($, agents).then(a => Object.values(a ?? {}).sort((x, y) => x.n - y.n)),
      $.clock.now(),
    ])
    // todos win, unless all are done and a plan still has open work
    const planOpen = (p?.tasks ?? []).some(t => t.status !== 'completed')
    const list = todos.some(t => t.status !== 'completed') || (todos.length > 0 && !planOpen) ? todos : (p?.tasks ?? [])
    const { Box, Text } = $.ui.resolve(e)
    const W = Math.max(30, e.props.bodyColumns)
    const f = frame()
    const spin = SPINNER[f % SPINNER.length]
    // a background agent keeps the session working after the main turn ends
    const busy = m.isRunning || runs.some(r => r.endedAt === undefined)

    // ---- main (layout from Flightdeck's main panel)
    const effortN = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }[m.effort] ?? 0
    const ctx = m.pct !== null ? gauge(m.pct, 10) : null
    const mainPanel = (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={W}>
        <Box justifyContent="space-between">
          <Text color="cyan" bold>{`${prettyModel(m.model)} · main`}</Text>
          <Text color={busy ? 'cyan' : undefined} dimColor={!busy}>{busy ? `${spin} working` : '○ idle'}</Text>
        </Box>
        <Text wrap="truncate">
          <Text dimColor>effort </Text>
          <Text color="cyan">{'▮'.repeat(effortN) + '▯'.repeat(4 - effortN)} </Text>
          <Text color="cyan" bold>{m.effort || '—'}</Text>
          {m.mode ? <Text dimColor>{`   mode ${m.mode}`}</Text> : null}
          <Text dimColor>{`   ${m.steps} req`}</Text>
        </Text>
        {ctx ? (
          <Text wrap="truncate">
            <Text dimColor>ctx </Text>
            <Text color={m.pct !== null && m.pct >= 80 ? 'red' : 'cyan'}>{ctx.on}</Text>
            <Text dimColor>{ctx.off}</Text>
            <Text bold>{` ${Math.round(m.pct ?? 0)}%`}</Text>
            {m.tokens !== null ? <Text dimColor>{` ${kTokens(m.tokens)}/${kTokens(m.window)}`}</Text> : null}
            {m.compactions > 0 ? <Text color="yellow">{`  ⟲${m.compactions}`}</Text> : null}
          </Text>
        ) : null}
        {m.costUsd !== null || m.limits.length > 0 ? (
          <Text wrap="truncate">
            {m.costUsd !== null ? <Text>{`${fmtUsd(m.costUsd)}   `}</Text> : null}
            {m.limits.slice(0, 2).map(l => {
              const g = gauge(l.pct, 5)
              return (
                <Text key={l.kind}>
                  <Text dimColor>{`${limitLabel(l.kind)} `}</Text>
                  <Text color={l.pct >= 80 ? 'red' : 'cyan'}>{g.on}</Text>
                  <Text dimColor>{`${g.off} ${Math.round(l.pct)}%  `}</Text>
                </Text>
              )
            })}
          </Text>
        ) : null}
      </Box>
    )

    // ---- agents: `1: label --- Model mm:ss`, the right column lined up
    const agentsPanel =
      runs.length > 0 ? (
        <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} width={W}>
          <Text color="magenta" bold>AGENTS</Text>
          {runs.map(r => {
            const running = r.endedAt === undefined
            const right = ` ${prettyModel(r.model)} ${mmss((r.endedAt ?? now) - r.startedAt)}`
            const room = W - 4 - 2 - right.length - 4 // icon, then ` ---` at the least
            let left = `${r.n}: ${r.label}`
            if (left.length > room) left = `${left.slice(0, Math.max(0, room - 1))}…`
            const icon = running ? spin : r.ok === false ? '✗' : '✓'
            return (
              <Text key={String(r.n)} color={running ? 'yellow' : r.ok === false ? 'red' : 'green'} wrap="truncate">
                {`${icon} ${left} ${'-'.repeat(Math.max(3, room - left.length + 3))}${right}`}
              </Text>
            )
          })}
        </Box>
      ) : null

    // what Claude is doing right now, when no task says it
    const activityPanel =
      m.isRunning && m.activity ? (
        <Box borderStyle="round" borderColor="yellow" paddingX={1} width={W}>
          <Text color="yellow" wrap="truncate">{`${spin} ${m.activity}`}</Text>
        </Box>
      ) : null

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          {mainPanel}
          {activityPanel}
          {agentsPanel}
        </Box>
      )
    }

    // ---- tasks
    const total = list.length
    const done = list.filter(t => t.status === 'completed').length
    const active = list.filter(t => t.status === 'in_progress')
    const barW = Math.max(10, W - 4 - ` ${total}/${total} · 100%`.length - 1)
    const filled = Math.round((done / total) * barW)
    const activeCells = Math.round(((done + active.length) / total) * barW) - filled
    const percent = Math.round((done / total) * 100)
    const allDone = done === total
    const next = list.find(t => t.status === 'pending')
    // a bright cell sweeps across the in-progress part of the bar while working
    const sweep = busy && activeCells > 0 ? f % activeCells : -1

    return (
      <Box flexDirection="column">
        {mainPanel}
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} width={W}>
          <Text color="green" bold>{allDone ? '✓ TASKS' : 'TASKS'}</Text>
          {/* count sits right after the bar so the eye doesn't travel */}
          <Text wrap="truncate">
            <Text color="green">{'█'.repeat(filled)}</Text>
            {sweep >= 0 ? (
              <Text color="yellow">
                {'▓'.repeat(sweep)}
                <Text bold>█</Text>
                {'▓'.repeat(activeCells - sweep - 1)}
              </Text>
            ) : (
              <Text color="yellow">{'▓'.repeat(activeCells)}</Text>
            )}
            <Text dimColor>{'░'.repeat(barW - filled - activeCells)}</Text>
            <Text bold color="blue">{` ${done}/${total}`}</Text>
            <Text dimColor>{` · ${percent}%`}</Text>
          </Text>
          {allDone ? (
            <Text color="green">✓ 모두 완료</Text>
          ) : active.length > 0 ? (
            <Text color="yellow" wrap="truncate">{`${busy ? spin : '▸'} ${active.map(numbered).join(', ')}`}</Text>
          ) : (
            <Text dimColor wrap="truncate">{`○ 다음: ${next ? numbered(next) : '—'}`}</Text>
          )}
          {p?.finishing ? <Text color="cyan" wrap="truncate">{`${busy ? spin : '⎇'} finishing-a-development-branch`}</Text> : null}
        </Box>
        {allDone ? activityPanel : null}
        {agentsPanel}
      </Box>
    )
  })
}

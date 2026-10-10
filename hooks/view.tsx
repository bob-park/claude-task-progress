import type { EngineInterface } from 'claude-code'

import type { Activity, AgentRun, Main, Task } from '../types'
import { fitTail } from './superpowers'

/** `$.ui.resolve(e)`: the surface's Box, Text, ... */
export type UI = ReturnType<EngineInterface['ui']['resolve']>

/** What every section draws with: the body width, the clock and whether anything works */
export type Frame = { W: number; f: number; spin: string; busy: boolean; now: number }

export const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
export const FRAME_MS = 100

// Formatting below is adapted from Flightdeck (MIT, github.com/scasella/claude-flightdeck)
export const prettyModel = (id: string) => {
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

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
// `오후 2:05`, and `10월 9일 오후 2:05` once it is another day
export const doneTime = (at: number, now: number) => {
  const d = new Date(at)
  const h = d.getHours()
  const day = d.toDateString() === new Date(now).toDateString() ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일 `
  return `${day}${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`
}

const numbered = (t: Task) => (t.n ? `#${t.n} ${t.label}` : t.label)

// `icon left ----- right`, the right column lined up; a long left is cut with …
export const lineUp = (icon: string, left: string, right: string, W: number, fill: string) => {
  const room = W - 4 - 2 - right.length - 4 // icon, then ` ---` at the least
  const l = left.length > room ? `${left.slice(0, Math.max(0, room - 1))}…` : left
  return `${icon} ${l} ${fill.repeat(Math.max(3, room - l.length + 3))}${right}`
}

// ---- main (layout from Flightdeck's main panel)
export const mainPanel = ({ Box, Text }: UI, m: Main, v: Frame) => {
  const effortN = { low: 1, medium: 2, high: 3, xhigh: 4, max: 4 }[m.effort] ?? 0
  const ctx = m.pct !== null ? gauge(m.pct, 10) : null
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} width={v.W}>
      <Box justifyContent="space-between">
        <Text color="cyan" bold>{`${prettyModel(m.model)} · main`}</Text>
        <Text color={v.busy ? 'cyan' : undefined} dimColor={!v.busy}>{v.busy ? `${v.spin} working` : '○ idle'}</Text>
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
}

// ---- progress: the bar with done/total right after it, and the current step below
export const progressLines = ({ Text }: UI, list: Task[], doneAt: number | null, v: Frame) => {
  const total = list.length
  const done = list.filter(t => t.status === 'completed').length
  const active = list.filter(t => t.status === 'in_progress')
  const barW = Math.max(10, v.W - 4 - ` ${total}/${total} · 100%`.length - 1)
  const filled = Math.round((done / total) * barW)
  const activeCells = Math.round(((done + active.length) / total) * barW) - filled
  const percent = Math.round((done / total) * 100)
  const next = list.find(t => t.status === 'pending')
  // a bright cell sweeps across the in-progress part of the bar while working
  const sweep = v.busy && activeCells > 0 ? v.f % activeCells : -1
  return [
    // count sits right after the bar so the eye doesn't travel
    <Text key="bar" wrap="truncate">
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
    </Text>,
    done === total ? (
      <Text key="now" color="green">{doneAt !== null ? `✓ 모두 완료 · ${doneTime(doneAt, v.now)}` : '✓ 모두 완료'}</Text>
    ) : active.length > 0 ? (
      <Text key="now" color="yellow" wrap="truncate">{`${v.busy ? v.spin : '▸'} ${active.map(numbered).join(', ')}`}</Text>
    ) : (
      <Text key="now" dimColor wrap="truncate">{`○ 다음: ${next ? numbered(next) : '—'}`}</Text>
    ),
  ]
}

// ---- tasks
export const tasksPanel = (ui: UI, list: Task[], doneAt: number | null, finishing: boolean, v: Frame) => {
  const { Box, Text } = ui
  const allDone = list.every(t => t.status === 'completed')
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} width={v.W}>
      <Text color="green" bold>{allDone ? '✓ TASKS' : 'TASKS'}</Text>
      {progressLines(ui, list, doneAt, v)}
      {finishing ? <Text color="cyan" wrap="truncate">{`${v.busy ? v.spin : '⎇'} finishing-a-development-branch`}</Text> : null}
    </Box>
  )
}

// ---- agents: running ones first, the latest on top, then the latest ended ones
const ENDED_SHOWN = 3
const ICON = { waiting: '⏸', done: '✓', failed: '✗' } as const
const COLOR = { running: 'yellow', waiting: 'cyan', done: undefined, failed: 'red' } as const

/** `⠹ 1: label --- Model mm:ss`; an ended row keeps its final time */
export const agentRow = ({ Text }: UI, r: AgentRun, left: string, right: string, fill: string, v: Frame, icon?: string) => (
  <Text key={String(r.n)} color={COLOR[r.status]} dimColor={r.status === 'done'} wrap="truncate">
    {lineUp(icon ?? (r.status === 'running' ? v.spin : ICON[r.status]), left, right, v.W, fill)}
  </Text>
)

export const agentsPanel = (ui: UI, all: AgentRun[], v: Frame) => {
  const { Box, Text } = ui
  const live = all.filter(r => r.status === 'running' || r.status === 'waiting').sort((x, y) => y.startedAt - x.startedAt)
  const ended = all.filter(r => r.status === 'done' || r.status === 'failed').sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0))
  const failed = ended.filter(r => r.status === 'failed').length
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} width={v.W}>
      <Text wrap="truncate">
        <Text color="magenta" bold>AGENTS</Text>
        <Text dimColor>{`  ${live.length} running · ${ended.length - failed} done${failed > 0 ? ` · ${failed} failed` : ''}`}</Text>
      </Text>
      {[...live, ...ended.slice(0, ENDED_SHOWN)].map(r =>
        agentRow(ui, r, `${r.n}: ${r.label}`, ` ${prettyModel(r.model)} ${mmss((r.endedAt ?? v.now) - r.startedAt)}`, '-', v),
      )}
    </Box>
  )
}

// ---- skills: every skill run, oldest dropped first when too wide
export const skillsPanel = ({ Box, Text }: UI, names: string[], v: Frame) => (
  <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} width={v.W}>
    <Text color="blue" bold>SKILLS</Text>
    <Text wrap="truncate">{fitTail(names, ' → ', v.W - 4, '…')}</Text>
  </Box>
)

// ---- activity: the main loop's latest tool calls, newest on top
const ACTIVITY_SHOWN = 3
const hhmm = (at: number) => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
export const activityPanel = ({ Box, Text }: UI, items: Activity[], v: Frame) => (
  <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={v.W}>
    <Text color="yellow" bold>ACTIVITY</Text>
    {items
      .slice(-ACTIVITY_SHOWN)
      .reverse()
      .map(a => (
        <Text key={String(a.id)} wrap="truncate">
          <Text dimColor>{`${hhmm(a.at)} `}</Text>
          <Text color={a.status === 'running' ? 'yellow' : a.status === 'error' ? 'red' : undefined}>
            {`${a.status === 'running' ? v.spin : a.status === 'error' ? '✗' : '✓'} ${a.label}`}
          </Text>
        </Text>
      ))}
  </Box>
)

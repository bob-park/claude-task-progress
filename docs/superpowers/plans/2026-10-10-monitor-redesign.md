# Monitor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the main panel, move everything superpowers-specific into its own SUPERPOWERS section, and add generic TASKS / AGENTS / SKILLS / ACTIVITY monitoring that works in any session.

**Architecture:** `hooks/register.tsx` keeps the event handlers and only updates state atoms; a new `hooks/view.tsx` draws one function per section; a new `hooks/superpowers.ts` holds the pure workflow logic (stage of a skill, path from a reply, SDD role, pipeline). Sections stack top to bottom and hide when empty.

**Tech Stack:** Claude Code mod (TypeScript/TSX, `claude-code` API, `claude-code/testing`); tests run with `claude plugin test .`, types checked with `bunx -p typescript tsc -p .`.

**Spec:** `docs/superpowers/specs/2026-10-10-monitor-redesign-design.md`

## Global Constraints

- The main panel's content and layout stay exactly as today (only moved into `view.tsx`).
- Every hook returns `next(e)`'s result unchanged, except the existing ExitPlanMode context line.
- A failed file read keeps what the pane shows; a failed `$.agent.list()` is an empty list.
- No new dependencies. State lives in `atom`s under plugin `task-progress`.
- Body width W is `Math.max(30, e.props.bodyColumns)`; a line's content width is `W - 4`.
- Kept history caps: agents 20 (oldest ended dropped first), activity 10, skills 30.
- UI copy stays as today: `✓ 모두 완료 · 오후 2:05`, `○ 다음: …`.
- Patches below are unified diffs against the state the previous task leaves; apply each with `git apply <file>` (or by hand). New files are given whole.

## Review Focus

- Parallel main-loop tool calls: each ACTIVITY row must settle to its own ✓/✗ (rows are tied to their call by a per-call `id`, not by label).
- A reviewer report holding both ✅ and `Needs fixes` must read as `issues`, never `approved` (pinned in Task 1's `verdictOf` test).
- A narrow pane (W = 30) must fold the pipeline and the skills line rather than overflow (pinned in Task 4's narrow-pane test).
- Re-reading the same superpowers plan after `finishing-a-development-branch` must not restart the cycle, while a different plan must (pinned in Task 4's finish test).
- An agent spawned before any superpowers skill, even one named `Review …`, must stay a plain AGENTS row (pinned in Task 4's no-role test).

---

### Task 1: Superpowers workflow logic

Pure functions the later tasks wire in: which stage a skill is, moving the workflow forward, the path a reply names, SDD roles, reviewer verdicts, and fitting a line to the pane.

**Files:**
- Create: `hooks/superpowers.ts`
- Create: `hooks/superpowers.test.ts`
- Modify: `types/index.d.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (types, `types/index.d.ts`): `Stage = 'brainstorm' | 'spec' | 'plan' | 'worktree' | 'execute' | 'review' | 'finish'`, `SpPath = 'spike' | 'bounded' | 'architectural'`, `Role = 'impl' | 'review'`, `Sp = { path?: SpPath; stages: Stage[]; current?: Stage; extras: string[]; doneAt: number | null }`.
- Produces (`hooks/superpowers.ts`): `ORDER: Stage[]`, `EMPTY_SP: Sp`, `skillName(skill: string): string`, `stageOf(skill: string): Stage | undefined`, `extraOf(skill: string): string | undefined`, `reach(sp: Sp, stage: Stage): Sp`, `addExtra(sp: Sp, extra: string): Sp`, `pathFrom(text: string): SpPath | undefined`, `type Step = { stage: Stage; state: 'done' | 'current' | 'todo' }`, `pipeline(sp: Sp): Step[]`, `roleOf(description: string): Role | undefined`, `taskNOf(text: string): string | undefined`, `verdictOf(answer: string): 'ok' | 'issues' | undefined`, `fitTail(parts: string[], sep: string, width: number, lead: string): string`.

- [ ] **Step 1: Write the failing test**

Create `hooks/superpowers.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'

import { addExtra, EMPTY_SP, extraOf, fitTail, pathFrom, pipeline, reach, roleOf, skillName, stageOf, taskNOf, verdictOf } from './superpowers'

test('skill names map to stages and extras, prefixed or bare', () => {
  expect(skillName('superpowers:brainstorming')).toBe('brainstorming')
  expect(stageOf('superpowers:brainstorming')).toBe('brainstorm')
  expect(stageOf('writing-plans')).toBe('plan')
  expect(stageOf('superpowers:subagent-driven-development')).toBe('execute')
  expect(stageOf('superpowers:finishing-a-development-branch')).toBe('finish')
  expect(stageOf('commit')).toBeUndefined()
  expect(extraOf('superpowers:test-driven-development')).toBe('tdd')
  expect(extraOf('brainstorming')).toBeUndefined()
})

test('reach moves forward only, and starts over after finish', () => {
  let sp = reach(EMPTY_SP, 'brainstorm')
  expect(sp).toEqual({ stages: ['brainstorm'], current: 'brainstorm', extras: [], doneAt: null })
  sp = reach(sp, 'execute')
  sp = reach(sp, 'plan') // a late plan read
  expect(sp.current).toBe('execute')
  expect(sp.path).toBe('architectural')
  sp = reach(addExtra(sp, 'tdd'), 'finish')
  expect(sp.current).toBe('finish')
  sp = reach(sp, 'brainstorm')
  expect(sp).toEqual({ stages: ['brainstorm'], current: 'brainstorm', extras: [], doneAt: null })
})

test('addExtra keeps each extra once', () => {
  expect(addExtra(addExtra(EMPTY_SP, 'tdd'), 'tdd').extras).toEqual(['tdd'])
})

test('path is the last one a reply names, any case, inside Korean text', () => {
  expect(pathFrom('this looks bounded, so I will present a short design')).toBe('bounded')
  expect(pathFrom('**분류: Architectural** — spec 경로로 가겠습니다')).toBe('architectural')
  expect(pathFrom('Spike인 줄 알았는데 BOUNDED로 올립니다')).toBe('bounded')
  expect(pathFrom('nothing here, unbounded')).toBeUndefined()
})

test('pipeline draws the path template plus reached stages', () => {
  expect(pipeline({ ...EMPTY_SP, path: 'architectural', stages: ['brainstorm', 'plan', 'execute'], current: 'execute' }).map(s => `${s.state}:${s.stage}`)).toEqual([
    'done:brainstorm',
    'done:spec',
    'done:plan',
    'current:execute',
    'todo:review',
    'todo:finish',
  ])
  expect(pipeline({ ...EMPTY_SP, path: 'bounded', stages: ['brainstorm'], current: 'brainstorm' }).map(s => s.stage)).toEqual([
    'brainstorm',
    'execute',
    'finish',
  ])
  // no path yet, or spike: only what was reached
  expect(pipeline({ ...EMPTY_SP, stages: ['brainstorm'], current: 'brainstorm' }).map(s => s.stage)).toEqual(['brainstorm'])
  // worktree shows once reached
  expect(pipeline({ ...EMPTY_SP, path: 'architectural', stages: ['worktree'], current: 'worktree' }).map(s => s.stage)).toContain('worktree')
})

test('SDD dispatches get a role and task number; reports a verdict', () => {
  expect(roleOf('Implement Task 4: Wire detector')).toBe('impl')
  expect(roleOf('Review Task 3 (spec + quality)')).toBe('review')
  expect(roleOf('Re-review Task 3 fix round 1')).toBe('review')
  expect(roleOf('Review spec document')).toBe('review')
  expect(roleOf('Explore auth')).toBeUndefined()
  expect(taskNOf('Review Task 12 (spec + quality)')).toBe('12')
  expect(taskNOf('Explore auth')).toBeUndefined()
  expect(verdictOf('**Task quality:** Approved')).toBe('ok')
  expect(verdictOf('✅ Spec compliant\n**Task quality:** Needs fixes')).toBe('issues')
  expect(verdictOf('Finding 1: NOT ADDRESSED')).toBe('issues')
  expect(verdictOf('done')).toBeUndefined()
})

test('fitTail keeps the latest parts behind a lead', () => {
  expect(fitTail(['a', 'b', 'c'], ' → ', 20, '…')).toBe('a → b → c')
  expect(fitTail(['alpha', 'beta', 'gamma'], ' → ', 14, '…')).toBe('… → gamma')
  expect(fitTail(['✓brainstorm', '✓plan', '●execute'], ' ', 17, '✓…')).toBe('✓… ✓plan ●execute')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `claude plugin test .`
Expected: `hooks/superpowers.test.ts` fails to load (`Cannot find module './superpowers'`); the other files pass.

- [ ] **Step 3: Add the types**

Apply to `types/index.d.ts`:

```diff
--- a/types/index.d.ts
+++ b/types/index.d.ts
@@ -28,6 +28,14 @@
   doneAt: number | null
 }
 
+export type Stage = 'brainstorm' | 'spec' | 'plan' | 'worktree' | 'execute' | 'review' | 'finish'
+export type SpPath = 'spike' | 'bounded' | 'architectural'
+/** What superpowers dispatched an agent for: SDD's implementer, or any review */
+export type Role = 'impl' | 'review'
+
+/** The superpowers workflow so far; empty `stages` until a superpowers skill runs */
+export type Sp = { path?: SpPath; stages: Stage[]; current?: Stage; extras: string[]; doneAt: number | null }
+
 declare module 'claude-code' {
   interface PluginState {
     'task-progress': { tasks: Record<string, Task>; main: Main; plan: Plan; agents: Record<string, AgentRun> }
```

- [ ] **Step 4: Write the implementation**

Create `hooks/superpowers.ts`:

```ts
import type { Role, Sp, SpPath, Stage } from '../types'

/** Workflow order; a stage only moves forward within one cycle */
export const ORDER: Stage[] = ['brainstorm', 'spec', 'plan', 'worktree', 'execute', 'review', 'finish']

const STAGE_OF: Record<string, Stage> = {
  brainstorming: 'brainstorm',
  'writing-plans': 'plan',
  'using-git-worktrees': 'worktree',
  'subagent-driven-development': 'execute',
  'executing-plans': 'execute',
  'dispatching-parallel-agents': 'execute',
  'requesting-code-review': 'review',
  'receiving-code-review': 'review',
  'finishing-a-development-branch': 'finish',
}

const EXTRA_OF: Record<string, string> = {
  'test-driven-development': 'tdd',
  'systematic-debugging': 'debugging',
  'verification-before-completion': 'verification',
}

export const EMPTY_SP: Sp = { stages: [], extras: [], doneAt: null }

/** `superpowers:brainstorming` → `brainstorming` */
export const skillName = (skill: string) => skill.slice(skill.lastIndexOf(':') + 1)
export const stageOf = (skill: string): Stage | undefined => STAGE_OF[skillName(skill)]
export const extraOf = (skill: string): string | undefined => EXTRA_OF[skillName(skill)]

/** A stage before the current one never moves it back; after finish it starts a new cycle */
export const reach = (sp: Sp, stage: Stage): Sp => {
  const at = (s: Stage | undefined) => (s ? ORDER.indexOf(s) : -1)
  const base = sp.stages.includes('finish') && at(stage) < at('finish') ? EMPTY_SP : sp
  const stages = base.stages.includes(stage) ? base.stages : [...base.stages, stage]
  const current = at(base.current) > at(stage) ? base.current : stage
  // a spec or plan is only written on the architectural path
  const path = stage === 'spec' || stage === 'plan' ? 'architectural' : base.path
  return { ...base, stages, ...(current ? { current } : {}), ...(path ? { path } : {}) }
}

export const addExtra = (sp: Sp, extra: string): Sp => (sp.extras.includes(extra) ? sp : { ...sp, extras: [...sp.extras, extra] })

/** The last spike / bounded / architectural a reply names */
export const pathFrom = (text: string) =>
  [...text.matchAll(/\b(spike|bounded|architectural)\b/gi)].at(-1)?.[1]?.toLowerCase() as SpPath | undefined

const TEMPLATE: Record<SpPath, Stage[]> = {
  architectural: ['brainstorm', 'spec', 'plan', 'execute', 'review', 'finish'],
  bounded: ['brainstorm', 'execute', 'finish'],
  spike: [],
}

export type Step = { stage: Stage; state: 'done' | 'current' | 'todo' }

/** The path's stages plus every stage reached, in order; before the current one counts as done */
export const pipeline = (sp: Sp): Step[] => {
  const template = sp.path ? TEMPLATE[sp.path] : []
  const at = sp.current ? ORDER.indexOf(sp.current) : -1
  return ORDER.filter(s => sp.stages.includes(s) || template.includes(s)).map(stage => {
    const i = ORDER.indexOf(stage)
    return { stage, state: i < at ? 'done' : i === at ? 'current' : 'todo' }
  })
}

/** SDD dispatches `Implement Task N: …`, `Review Task N (…)`, `Re-review Task N …`; docs get `Review spec document` */
export const roleOf = (description: string): Role | undefined =>
  /^implement\b/i.test(description) ? 'impl' : /review/i.test(description) ? 'review' : undefined

export const taskNOf = (text: string) => /\bTask\s+(\d+)/.exec(text)?.[1]

/** A reviewer's report: `Needs fixes` / `NOT ADDRESSED` / ❌ before `Approved` / `ADDRESSED` / ✅ */
export const verdictOf = (answer: string): 'ok' | 'issues' | undefined =>
  /needs fixes|not addressed|❌/i.test(answer) ? 'issues' : /approved|addressed|✅/i.test(answer) ? 'ok' : undefined

/** Joins parts; too wide drops the oldest behind `lead` so the latest stay */
export const fitTail = (parts: string[], sep: string, width: number, lead: string) => {
  let rest = parts
  let line = rest.join(sep)
  while (line.length > width && rest.length > 1) {
    rest = rest.slice(1)
    line = [lead, ...rest].join(sep)
  }
  return line
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `claude plugin test .` — Expected: `28 pass`, `0 fail`.
Run: `bunx -p typescript tsc -p .` — Expected: no `error TS` lines.

- [ ] **Step 6: Commit**

```bash
git add hooks/superpowers.ts hooks/superpowers.test.ts types/index.d.ts
git commit -m "feat: superpowers 워크플로 판정 함수"
```

---

### Task 2: Move rendering into view.tsx

A pure refactor: the pane draws exactly what it draws today, but each section is a function in `hooks/view.tsx`, so the next tasks add sections without growing `register.tsx`.

**Files:**
- Create: `hooks/view.tsx`
- Modify: `hooks/register.tsx` (whole file below)
- Modify: `hooks/register.test.ts:2` (import)

**Interfaces:**
- Consumes: nothing new.
- Produces (`hooks/view.tsx`): `type UI = ReturnType<EngineInterface['ui']['resolve']>`, `type Frame = { W: number; f: number; spin: string; busy: boolean; now: number }`, `SPINNER`, `FRAME_MS`, `prettyModel(id)`, `mmss(ms)`, `doneTime(at, now)`, `lineUp(icon, left, right, W, fill): string`, `mainPanel(ui, m: Main, v)`, `progressLines(ui, list: Task[], doneAt: number | null, v)` (array of two `Text`s: bar, current line), `tasksPanel(ui, list, doneAt, finishing: boolean, v)`, `agentsPanel(ui, runs: AgentRun[], v)`, `activityPanel(ui, activity: string, v)`.

- [ ] **Step 1: Point the test at the new module**

Apply to `hooks/register.test.ts`:

```diff
--- a/hooks/register.test.ts
+++ b/hooks/register.test.ts
@@ -1,5 +1,5 @@
 import { expect, mock, test } from 'claude-code/testing'
-import { doneTime } from './register'
+import { doneTime } from './view'
 
 const pane = {
   plugin: 'task-progress',
```

- [ ] **Step 2: Run test to verify it fails**

Run: `claude plugin test .`
Expected: `hooks/register.test.ts` fails to load (`./view` not found).

- [ ] **Step 3: Create `hooks/view.tsx`**

```tsx
import type { EngineInterface } from 'claude-code'

import type { AgentRun, Main, Task } from '../types'

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

// ---- agents: `1: label --- Model mm:ss`, the right column lined up
export const agentsPanel = ({ Box, Text }: UI, runs: AgentRun[], v: Frame) => (
  <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} width={v.W}>
    <Text color="magenta" bold>AGENTS</Text>
    {runs.map(r => (
      <Text key={String(r.n)} color="yellow" wrap="truncate">
        {lineUp(v.spin, `${r.n}: ${r.label}`, ` ${prettyModel(r.model)} ${mmss(v.now - r.startedAt)}`, v.W, '-')}
      </Text>
    ))}
  </Box>
)

// what Claude is doing right now, when no task says it
export const activityPanel = ({ Box, Text }: UI, activity: string, v: Frame) => (
  <Box borderStyle="round" borderColor="yellow" paddingX={1} width={v.W}>
    <Text color="yellow" wrap="truncate">{`${v.spin} ${activity}`}</Text>
  </Box>
)
```

- [ ] **Step 4: Replace `hooks/register.tsx`**

The formatting helpers, `doneTime` and the JSX moved to `view.tsx`; the handlers are unchanged. Whole file:

```tsx
import { atom, read, update } from 'claude-code'
import type { BuiltinToolResults, EngineInterface, Register, Timer } from 'claude-code'

import type { AgentRun, Main, Plan, Task } from '../types'
import { isPlanPath, keepCompleted, ledgerOwns, ledgerPath, parsePlan } from './plan'
import { activityPanel, agentsPanel, FRAME_MS, mainPanel, SPINNER, tasksPanel } from './view'

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
  const on = !!m?.isRunning || Object.values(a ?? {}).some(r => r.endedAt === undefined)
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
        return r ? { ...all, [agentId]: { ...r, endedAt: at } } : all
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
        const { endedAt, ...run } = r
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
    const [m, todos, p, runs, now] = await Promise.all([
      read($, main).then(x => ({ ...DEFAULT_MAIN, ...x })),
      read($, tasks).then(Object.values),
      read($, plan),
      // running ones only, the latest on top
      read($, agents).then(a => Object.values(a ?? {}).filter(r => r.endedAt === undefined).sort((x, y) => y.startedAt - x.startedAt)),
      $.clock.now(),
    ])
    const list = shownTasks(todos, p)
    const ui = $.ui.resolve(e)
    const { Box } = ui
    const f = frame()
    // a background agent keeps the session working after the main turn ends
    const v = { W: Math.max(30, e.props.bodyColumns), f, spin: SPINNER[f % SPINNER.length]!, busy: m.isRunning || runs.length > 0, now }
    const allDone = list.length > 0 && list.every(t => t.status === 'completed')
    // what Claude is doing right now, when no task says it
    const showActivity = m.isRunning && !!m.activity && (list.length === 0 || allDone)
    return (
      <Box flexDirection="column">
        {mainPanel(ui, m, v)}
        {list.length > 0 ? tasksPanel(ui, list, m.doneAt, !!p?.finishing, v) : null}
        {showActivity ? activityPanel(ui, m.activity, v) : null}
        {runs.length > 0 ? agentsPanel(ui, runs, v) : null}
      </Box>
    )
  })
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `claude plugin test .` — Expected: `28 pass`, `0 fail` (the same register tests as before, unchanged except the import).
Run: `bunx -p typescript tsc -p .` — Expected: no `error TS` lines.

- [ ] **Step 6: Commit**

```bash
git add hooks/view.tsx hooks/register.tsx hooks/register.test.ts
git commit -m "refactor: pane 렌더링을 view.tsx 로 분리"
```

---

### Task 3: Generic monitoring — AGENTS history, SKILLS, ACTIVITY

Works with or without superpowers. AGENTS keeps ended agents (✓ / ✗ with their final time, ⏸ while waiting) and counts them in its header; SKILLS lists every skill run; ACTIVITY always shows the main loop's latest 3 tool calls with their outcome. `Main.activity` and the old one-line activity panel go away.

**Files:**
- Modify: `types/index.d.ts`, `hooks/register.tsx`, `hooks/view.tsx`
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: `fitTail`, `skillName` (Task 1); `UI`, `Frame`, `lineUp`, `prettyModel`, `mmss` (Task 2).
- Produces (types): `AgentStatus = 'running' | 'waiting' | 'done' | 'failed'`; `AgentRun` gains `status: AgentStatus`; `SkillUse = { name: string; at: number }`; `Activity = { id: number; at: number; label: string; status: 'running' | 'ok' | 'error' }`; `Main.activity` removed; plugin state gains `skills: SkillUse[]`, `activity: Activity[]`.
- Produces (`view.tsx`): `agentRow(ui, r: AgentRun, left: string, right: string, fill: string, v: Frame, icon?: string)`, `agentsPanel(ui, all: AgentRun[], v)` (now takes every agent and picks what to list), `skillsPanel(ui, names: string[], v)`, `activityPanel(ui, items: Activity[], v)`.
- Produces (`register.tsx`): `live(r: AgentRun): boolean` (running or waiting), atoms `skills`, `activity`.

- [ ] **Step 1: Write the failing tests**

Apply to `hooks/register.test.ts` (new tests for ACTIVITY, running rows, SKILLS, agent history and caps; the agent and waiting tests now expect ended agents to stay; the old activity tests are replaced):

```diff
diff --git a/hooks/register.test.ts b/hooks/register.test.ts
index 997ab61..9af2f1a 100644
--- a/hooks/register.test.ts
+++ b/hooks/register.test.ts
@@ -138,15 +138,45 @@ test('reading a plan written in an earlier session makes it the active plan', as
   expect(await ui.find({ text: /^ 1\/2$/ })).toBeDefined()
 })
 
-test('with no todos or plan, a running turn shows what Claude is doing', async ($, on) => {
+test('activity lists the latest main-loop tool calls, newest on top, ✗ on error', async ($, on) => {
   mock.clock(on)
-  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
-  on('tool.call', () => ({ result: {} }) as never)
+  on('tool.call', (_$, e) => (e.tool === 'Read' ? { result: {}, isError: true } : { result: {} }) as never)
+  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
+  expect(await ui.find({ text: /^ACTIVITY$/ })).toBeUndefined()
+  await ui.unmount()
 
-  await $.turn.start({ text: 'go', turnId: 'T1' })
   await $.tool.call({ tool: 'Bash', command: 'bun test', description: 'Run tests' } as never)
+  await $.tool.call({ tool: 'Read', file_path: '/r/a/missing.ts' } as never)
+  await $.tool.call({ tool: 'Edit', file_path: '/r/a/plan.ts' } as never)
+  await $.tool.call({ tool: 'Grep', pattern: 'TODO' } as never)
+  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
+  expect(await ui.find({ text: /^ACTIVITY$/ })).toBeDefined()
+  const rows = await ui.findAll({ text: /^[✓✗⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] \w+ · / })
+  expect(rows.map(r => r.text)).toEqual(['✓ Grep · TODO', '✓ Edit · plan.ts', '✗ Read · missing.ts']) // the latest 3
+  expect(await ui.find({ text: /^\d\d:\d\d $/ })).toBeDefined()
+})
+
+test('a tool call shows as running until it returns', async ($, on) => {
+  mock.clock(on)
+  let running = false
+  on('tool.call', async () => {
+    const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
+    running = !!(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Bash · Run tests$/ }))
+    await ui.unmount()
+    return { result: {} } as never
+  })
+  await $.tool.call({ tool: 'Bash', command: 'bun test', description: 'Run tests' } as never)
+  expect(running).toBe(true)
+})
+
+test('skills list every skill run in order, a repeat in a row once', async ($, on) => {
+  mock.clock(on)
+  on('skill.prompt', () => ({ text: '' }))
+  for (const skill of ['superpowers:brainstorming', 'superpowers:brainstorming', 'commit', 'superpowers:writing-plans'])
+    await $.skill.prompt({ skill, text: '' })
   const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
-  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Bash · Run tests$/ })).toBeDefined()
+  expect(await ui.find({ text: /^SKILLS$/ })).toBeDefined()
+  expect(await ui.find({ text: /^brainstorming → commit → writing-plans$/ })).toBeDefined()
 })
 
 test('agents list below the tasks: num, label, model and mm:ss', async ($, on) => {
@@ -166,6 +196,7 @@ test('agents list below the tasks: num, label, model and mm:ss', async ($, on) =
   // the latest on top
   let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
   expect(await ui.find({ text: /^AGENTS$/ })).toBeDefined()
+  expect(await ui.find({ text: /^  2 running · 0 done$/ })).toBeDefined()
   const rows = await ui.findAll({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] \d: / })
   expect(rows.map(r => r.text)).toEqual([
     expect.stringMatching(/^. 2: Review diff -+ Haiku 5\.5 00:42$/),
@@ -173,16 +204,38 @@ test('agents list below the tasks: num, label, model and mm:ss', async ($, on) =
   ])
   await ui.unmount()
 
-  // a finished one leaves the list at once
+  // a finished one stays below the running ones with ✓ and its final time
   await end('A1')
+  await clock.advance(10_000)
   ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
-  expect(await ui.find({ text: /Explore auth/ })).toBeUndefined()
-  expect(await ui.find({ text: /2: Review diff/ })).toBeDefined()
+  expect((await ui.findAll({ text: /^. \d: / })).map(r => r.text)).toEqual([
+    expect.stringMatching(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 2: Review diff -+ Haiku 5\.5 00:52$/),
+    expect.stringMatching(/^✓ 1: Explore auth -+ Haiku 5\.5 01:23$/),
+  ])
   await ui.unmount()
 
-  await end('A2')
+  // a new prompt keeps them; a failed one is ✗ and counted
+  await $.turn.start({ text: 'next', turnId: 'T2' })
+  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'T', agentId: 'A2', reason: 'error' } as never)
   ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
-  expect(await ui.find({ text: /^AGENTS$/ })).toBeUndefined()
+  expect(await ui.find({ text: /^  0 running · 1 done · 1 failed$/ })).toBeDefined()
+  expect(await ui.find({ text: /^✗ 2: Review diff / })).toBeDefined()
+  expect(await ui.find({ text: /^✓ 1: Explore auth / })).toBeDefined()
+})
+
+test('agents show the latest 3 ended ones, and keep at most 20', async ($, on) => {
+  const clock = mock.clock(on)
+  let k = 0
+  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `A${++k}` }))
+  on('turn.complete', () => ({ text: '' }))
+  for (let i = 1; i <= 22; i++) {
+    await $.agent.spawn({ prompt: 'p', description: `Job ${i}` } as never)
+    await clock.advance(1000)
+    await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'T', agentId: `A${i}`, reason: 'answer' } as never)
+  }
+  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
+  expect(await ui.find({ text: /^  0 running · 20 done$/ })).toBeDefined()
+  expect((await ui.findAll({ text: /^✓ \d+: / })).map(r => r.text.split(' -')[0])).toEqual(['✓ 22: Job 22', '✓ 21: Job 21', '✓ 20: Job 20'])
 })
 
 test('a TaskCreate task shows its number on the current line', async ($, on) => {
@@ -229,8 +282,9 @@ test('an agent waiting on its background work stays running, and a resumed one r
   await end('A1')
   await end('A2')
   let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
-  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 1: Scan / })).toBeDefined()
-  expect(await ui.find({ text: /2: Lint/ })).toBeUndefined()
+  expect(await ui.find({ text: /^⏸ 1: Scan / })).toBeDefined()
+  expect(await ui.find({ text: /^✓ 2: Lint / })).toBeDefined()
+  expect(await ui.find({ text: /^  1 running · 1 done$/ })).toBeDefined() // waiting counts as running
   await ui.unmount()
 
   // A2 is woken again: its next step puts it back to running
@@ -255,17 +309,15 @@ test('finishing-a-development-branch shows under the tasks until another plan',
 
   await $.tool.call({ tool: 'Write', file_path: B, content: '' } as never)
   ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
-  expect(await ui.find({ text: /finishing-a-development-branch/ })).toBeUndefined()
+  expect(await ui.find({ text: /^⎇ finishing-a-development-branch$/ })).toBeUndefined()
 })
 
-test('once every task is done, a running turn shows what Claude is doing', async ($, on) => {
+test('activity shows alongside open tasks', async ($, on) => {
   mock.clock(on)
-  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
   on('tool.call', () => ({ result: {} }) as never)
-  await $.tool.call({ tool: 'TodoWrite', todos: [todo('a', 'completed')] } as never)
-  await $.turn.start({ text: 'go', turnId: 'T1' })
+  await $.tool.call({ tool: 'TodoWrite', todos: [todo('a', 'in_progress')] } as never)
   await $.tool.call({ tool: 'Bash', command: 'git push', description: 'Push branch' } as never)
   const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
-  expect(await ui.find({ text: /^✓ 모두 완료 · / })).toBeDefined()
-  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Bash · Push branch$/ })).toBeDefined()
+  expect(await ui.find({ text: /^▸ aing$/ })).toBeDefined()
+  expect(await ui.find({ text: /^✓ Bash · Push branch$/ })).toBeDefined()
 })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL — among others `activity lists the latest main-loop tool calls…` (no `ACTIVITY` title) and `skills list every skill run…` (no `SKILLS`).

- [ ] **Step 3: Update types and handlers**

Apply to `types/index.d.ts` and `hooks/register.tsx`:

```diff
diff --git a/hooks/register.tsx b/hooks/register.tsx
index f55f8c0..64fbffe 100644
--- a/hooks/register.tsx
+++ b/hooks/register.tsx
@@ -1,13 +1,29 @@
 import { atom, read, update } from 'claude-code'
 import type { BuiltinToolResults, EngineInterface, Register, Timer } from 'claude-code'
 
-import type { AgentRun, Main, Plan, Task } from '../types'
+import type { Activity, AgentRun, AgentStatus, Main, Plan, SkillUse, Task } from '../types'
 import { isPlanPath, keepCompleted, ledgerOwns, ledgerPath, parsePlan } from './plan'
-import { activityPanel, agentsPanel, FRAME_MS, mainPanel, SPINNER, tasksPanel } from './view'
+import { skillName } from './superpowers'
+import { activityPanel, agentsPanel, FRAME_MS, mainPanel, skillsPanel, SPINNER, tasksPanel } from './view'
 
 const tasks = atom({ plugin: 'task-progress', key: 'tasks' } as const, {} as Record<string, Task>)
 const plan = atom({ plugin: 'task-progress', key: 'plan' } as const, { path: '', tasks: [] } as Plan)
 const agents = atom({ plugin: 'task-progress', key: 'agents' } as const, {} as Record<string, AgentRun>)
+const skills = atom({ plugin: 'task-progress', key: 'skills' } as const, [] as SkillUse[])
+const activity = atom({ plugin: 'task-progress', key: 'activity' } as const, [] as Activity[])
+
+const MAX_AGENTS = 20
+const MAX_ACTIVITY = 10
+const MAX_SKILLS = 30
+const live = (r: AgentRun) => r.status === 'running' || r.status === 'waiting'
+// the oldest ended agents go first; running ones always stay
+const trimAgents = (all: Record<string, AgentRun>) => {
+  const ended = Object.entries(all).filter(([, r]) => !live(r)).sort(([, a], [, b]) => a.startedAt - b.startedAt)
+  const drop = new Set(ended.slice(0, Math.max(0, Object.keys(all).length - MAX_AGENTS)).map(([id]) => id))
+  return Object.fromEntries(Object.entries(all).filter(([id]) => !drop.has(id)))
+}
+// ties an activity row to its tool call across `next(e)`
+let seq = 0
 
 // a failed read keeps what the pane already shows
 const refreshPlan = async ($: EngineInterface, path: string) => {
@@ -31,7 +47,6 @@ const DEFAULT_MAIN: Main = {
   mode: '',
   steps: 0,
   isRunning: false,
-  activity: '',
   pct: null,
   tokens: null,
   window: 0,
@@ -62,7 +77,7 @@ let ticker: Timer | undefined
 // the clock runs while the main turn or any agent is working
 const animate = async ($: EngineInterface) => {
   const [m, a] = await Promise.all([read($, main), read($, agents)])
-  const on = !!m?.isRunning || Object.values(a ?? {}).some(r => r.endedAt === undefined)
+  const on = !!m?.isRunning || Object.values(a ?? {}).some(live)
   if (on) ticker ??= $.clock.every(FRAME_MS, () => $.ui.invalidate('ui.render'))
   else ticker = void ticker?.cancel()
 }
@@ -119,8 +134,6 @@ export const register: Register = on => {
 
   on('turn.start', async ($, e, next) => {
     await setMain($, () => ({ isRunning: true }))
-    // a new prompt clears agents that finished before it
-    await update($, agents, all => Object.fromEntries(Object.entries(all ?? {}).filter(([, r]) => r.endedAt === undefined)))
     await animate($)
     return next(e)
   })
@@ -130,14 +143,14 @@ export const register: Register = on => {
     if (e.agentId) {
       const { agentId } = e
       // an agent waiting on its own background work ends its turn but isn't done
-      const status = (await $.agent.list().catch(() => [])).find(a => a.id === agentId)?.status
-      if (status === 'waiting') return done
+      const waiting = (await $.agent.list().catch(() => [])).find(a => a.id === agentId)?.status === 'waiting'
       const at = await $.clock.now()
+      const status: AgentStatus = waiting ? 'waiting' : e.reason === 'error' || e.reason === 'aborted' ? 'failed' : 'done'
       await update($, agents, all => {
         const r = all?.[agentId]
-        return r ? { ...all, [agentId]: { ...r, endedAt: at } } : all
+        return r ? { ...all, [agentId]: { ...r, status, ...(waiting ? {} : { endedAt: at }) } } : all
       })
-    } else await setMain($, () => ({ isRunning: false, activity: '' }))
+    } else await setMain($, () => ({ isRunning: false }))
     await animate($)
     return done
   })
@@ -149,9 +162,9 @@ export const register: Register = on => {
       // a step after its end: the agent resumed once its background work came back
       const r = (await read($, agents))?.[agentId]
       if (r) {
-        const { endedAt, ...run } = r
-        await update($, agents, all => ({ ...all, [agentId]: { ...run, model: e.model } }))
-        if (endedAt !== undefined) await animate($)
+        const { endedAt: _, ...run } = r
+        await update($, agents, all => ({ ...all, [agentId]: { ...run, model: e.model, status: 'running' as const } }))
+        if (!live(r)) await animate($)
       }
     }
     return yield* next(e)
@@ -163,16 +176,22 @@ export const register: Register = on => {
     if (agentId) {
       const startedAt = await $.clock.now()
       // next after the highest still listed: one left running keeps its number
-      await update($, agents, all => ({
-        ...all,
-        [agentId]: { n: Math.max(0, ...Object.values(all ?? {}).map(r => r.n)) + 1, label: e.description || e.subagentType, model, startedAt },
-      }))
+      await update($, agents, all =>
+        trimAgents({
+          ...all,
+          [agentId]: { n: Math.max(0, ...Object.values(all ?? {}).map(r => r.n)) + 1, label: e.description || e.subagentType, model, startedAt, status: 'running' },
+        }),
+      )
       await animate($)
     }
     return spawned
   })
 
   on('skill.prompt', async ($, e, next) => {
+    const at = await $.clock.now()
+    const name = skillName(e.skill)
+    // the same skill twice in a row is one entry
+    await update($, skills, all => (all?.at(-1)?.name === name ? all : [...(all ?? []), { name, at }].slice(-MAX_SKILLS)))
     if (/(^|:)finishing-a-development-branch$/.test(e.skill)) await update($, plan, p => ({ ...(p ?? { path: '', tasks: [] }), finishing: true }))
     return next(e)
   })
@@ -189,8 +208,16 @@ export const register: Register = on => {
   })
 
   on('tool.call', async ($, e, next) => {
-    if (!e.agentId) await setMain($, () => ({ activity: activityOf(e as Parameters<typeof activityOf>[0]) }))
+    const id = ++seq
+    if (!e.agentId) {
+      const row = { id, at: await $.clock.now(), label: activityOf(e as Parameters<typeof activityOf>[0]), status: 'running' as const }
+      await update($, activity, all => [...(all ?? []), row].slice(-MAX_ACTIVITY))
+    }
     const ran = await next(e)
+    if (!e.agentId) {
+      const status = ran.deny !== undefined || ran.isError ? ('error' as const) : ('ok' as const)
+      await update($, activity, all => (all ?? []).map(a => (a.id === id ? { ...a, status } : a)))
+    }
     if (ran.deny !== undefined || ran.isError) return ran
 
     if (e.tool === 'TodoWrite') {
@@ -226,12 +253,13 @@ export const register: Register = on => {
   })
 
   on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
-    const [m, todos, p, runs, now] = await Promise.all([
+    const [m, todos, p, runs, used, acts, now] = await Promise.all([
       read($, main).then(x => ({ ...DEFAULT_MAIN, ...x })),
       read($, tasks).then(Object.values),
       read($, plan),
-      // running ones only, the latest on top
-      read($, agents).then(a => Object.values(a ?? {}).filter(r => r.endedAt === undefined).sort((x, y) => y.startedAt - x.startedAt)),
+      read($, agents).then(a => Object.values(a ?? {})),
+      read($, skills).then(s => s ?? []),
+      read($, activity).then(a => a ?? []),
       $.clock.now(),
     ])
     const list = shownTasks(todos, p)
@@ -239,16 +267,14 @@ export const register: Register = on => {
     const { Box } = ui
     const f = frame()
     // a background agent keeps the session working after the main turn ends
-    const v = { W: Math.max(30, e.props.bodyColumns), f, spin: SPINNER[f % SPINNER.length]!, busy: m.isRunning || runs.length > 0, now }
-    const allDone = list.length > 0 && list.every(t => t.status === 'completed')
-    // what Claude is doing right now, when no task says it
-    const showActivity = m.isRunning && !!m.activity && (list.length === 0 || allDone)
+    const v = { W: Math.max(30, e.props.bodyColumns), f, spin: SPINNER[f % SPINNER.length]!, busy: m.isRunning || runs.some(live), now }
     return (
       <Box flexDirection="column">
         {mainPanel(ui, m, v)}
         {list.length > 0 ? tasksPanel(ui, list, m.doneAt, !!p?.finishing, v) : null}
-        {showActivity ? activityPanel(ui, m.activity, v) : null}
         {runs.length > 0 ? agentsPanel(ui, runs, v) : null}
+        {used.length > 0 ? skillsPanel(ui, used.map(u => u.name), v) : null}
+        {acts.length > 0 ? activityPanel(ui, acts, v) : null}
       </Box>
     )
   })
diff --git a/types/index.d.ts b/types/index.d.ts
index ee359e6..2e40402 100644
--- a/types/index.d.ts
+++ b/types/index.d.ts
@@ -3,8 +3,16 @@ export type TaskStatus = 'pending' | 'in_progress' | 'completed'
 /** `n`: the task's number when its source has one (plan `Task N`, TaskCreate id, `1.` step) */
 export type Task = { status: TaskStatus; label: string; n?: string }
 
-/** A subagent the model spawned, listed under the tasks */
-export type AgentRun = { n: number; label: string; model: string; startedAt: number; endedAt?: number }
+export type AgentStatus = 'running' | 'waiting' | 'done' | 'failed'
+
+/** A subagent the model spawned; kept once it ends (`endedAt`), up to the latest 20 */
+export type AgentRun = { n: number; label: string; model: string; startedAt: number; endedAt?: number; status: AgentStatus }
+
+/** A skill the session ran, in order */
+export type SkillUse = { name: string; at: number }
+
+/** A main-loop tool call: `Bash · Run tests` */
+export type Activity = { id: number; at: number; label: string; status: 'running' | 'ok' | 'error' }
 
 /** The plan file progress is read from when there are no todos; `finishing` once finishing-a-development-branch ran on it */
 export type Plan = { path: string; tasks: Task[]; finishing?: boolean }
@@ -16,8 +24,6 @@ export type Main = {
   mode: string
   steps: number
   isRunning: boolean
-  /** The main loop's latest tool call, shown when there are no tasks */
-  activity: string
   pct: number | null
   tokens: number | null
   window: number
@@ -38,6 +44,13 @@ export type Sp = { path?: SpPath; stages: Stage[]; current?: Stage; extras: stri
 
 declare module 'claude-code' {
   interface PluginState {
-    'task-progress': { tasks: Record<string, Task>; main: Main; plan: Plan; agents: Record<string, AgentRun> }
+    'task-progress': {
+      tasks: Record<string, Task>
+      main: Main
+      plan: Plan
+      agents: Record<string, AgentRun>
+      skills: SkillUse[]
+      activity: Activity[]
+    }
   }
 }
```

- [ ] **Step 4: Add the sections**

Apply to `hooks/view.tsx`:

```diff
diff --git a/hooks/view.tsx b/hooks/view.tsx
index e48e68a..8e12d0c 100644
--- a/hooks/view.tsx
+++ b/hooks/view.tsx
@@ -1,6 +1,7 @@
 import type { EngineInterface } from 'claude-code'
 
-import type { AgentRun, Main, Task } from '../types'
+import type { Activity, AgentRun, Main, Task } from '../types'
+import { fitTail } from './superpowers'
 
 /** `$.ui.resolve(e)`: the surface's Box, Text, ... */
 export type UI = ReturnType<EngineInterface['ui']['resolve']>
@@ -149,21 +150,63 @@ export const tasksPanel = (ui: UI, list: Task[], doneAt: number | null, finishin
   )
 }
 
-// ---- agents: `1: label --- Model mm:ss`, the right column lined up
-export const agentsPanel = ({ Box, Text }: UI, runs: AgentRun[], v: Frame) => (
-  <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} width={v.W}>
-    <Text color="magenta" bold>AGENTS</Text>
-    {runs.map(r => (
-      <Text key={String(r.n)} color="yellow" wrap="truncate">
-        {lineUp(v.spin, `${r.n}: ${r.label}`, ` ${prettyModel(r.model)} ${mmss(v.now - r.startedAt)}`, v.W, '-')}
+// ---- agents: running ones first, the latest on top, then the latest ended ones
+const ENDED_SHOWN = 3
+const ICON = { waiting: '⏸', done: '✓', failed: '✗' } as const
+const COLOR = { running: 'yellow', waiting: 'cyan', done: undefined, failed: 'red' } as const
+
+/** `⠹ 1: label --- Model mm:ss`; an ended row keeps its final time */
+export const agentRow = ({ Text }: UI, r: AgentRun, left: string, right: string, fill: string, v: Frame, icon?: string) => (
+  <Text key={String(r.n)} color={COLOR[r.status]} dimColor={r.status === 'done'} wrap="truncate">
+    {lineUp(icon ?? (r.status === 'running' ? v.spin : ICON[r.status]), left, right, v.W, fill)}
+  </Text>
+)
+
+export const agentsPanel = (ui: UI, all: AgentRun[], v: Frame) => {
+  const { Box, Text } = ui
+  const live = all.filter(r => r.status === 'running' || r.status === 'waiting').sort((x, y) => y.startedAt - x.startedAt)
+  const ended = all.filter(r => r.status === 'done' || r.status === 'failed').sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0))
+  const failed = ended.filter(r => r.status === 'failed').length
+  return (
+    <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} width={v.W}>
+      <Text wrap="truncate">
+        <Text color="magenta" bold>AGENTS</Text>
+        <Text dimColor>{`  ${live.length} running · ${ended.length - failed} done${failed > 0 ? ` · ${failed} failed` : ''}`}</Text>
       </Text>
-    ))}
+      {[...live, ...ended.slice(0, ENDED_SHOWN)].map(r =>
+        agentRow(ui, r, `${r.n}: ${r.label}`, ` ${prettyModel(r.model)} ${mmss((r.endedAt ?? v.now) - r.startedAt)}`, '-', v),
+      )}
+    </Box>
+  )
+}
+
+// ---- skills: every skill run, oldest dropped first when too wide
+export const skillsPanel = ({ Box, Text }: UI, names: string[], v: Frame) => (
+  <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} width={v.W}>
+    <Text color="blue" bold>SKILLS</Text>
+    <Text wrap="truncate">{fitTail(names, ' → ', v.W - 4, '…')}</Text>
   </Box>
 )
 
-// what Claude is doing right now, when no task says it
-export const activityPanel = ({ Box, Text }: UI, activity: string, v: Frame) => (
-  <Box borderStyle="round" borderColor="yellow" paddingX={1} width={v.W}>
-    <Text color="yellow" wrap="truncate">{`${v.spin} ${activity}`}</Text>
+// ---- activity: the main loop's latest tool calls, newest on top
+const ACTIVITY_SHOWN = 3
+const hhmm = (at: number) => {
+  const d = new Date(at)
+  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
+}
+export const activityPanel = ({ Box, Text }: UI, items: Activity[], v: Frame) => (
+  <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={v.W}>
+    <Text color="yellow" bold>ACTIVITY</Text>
+    {items
+      .slice(-ACTIVITY_SHOWN)
+      .reverse()
+      .map(a => (
+        <Text key={String(a.id)} wrap="truncate">
+          <Text dimColor>{`${hhmm(a.at)} `}</Text>
+          <Text color={a.status === 'running' ? 'yellow' : a.status === 'error' ? 'red' : undefined}>
+            {`${a.status === 'running' ? v.spin : a.status === 'error' ? '✗' : '✓'} ${a.label}`}
+          </Text>
+        </Text>
+      ))}
   </Box>
 )
```

- [ ] **Step 5: Run tests and typecheck**

Run: `claude plugin test .` — Expected: `31 pass`, `0 fail`.
Run: `bunx -p typescript tsc -p .` — Expected: no `error TS` lines.

- [ ] **Step 6: Commit**

```bash
git add types/index.d.ts hooks/register.tsx hooks/view.tsx hooks/register.test.ts
git commit -m "feat: 에이전트 이력, SKILLS, ACTIVITY 섹션"
```

---

### Task 4: SUPERPOWERS section

The superpowers workflow gets its own section: path badge, pipeline, the superpowers plan's progress (moved out of TASKS, with its own done time in `sp.doneAt`), SDD agents by role with reviewer verdicts, and extras. `Plan.finishing` and the `⎇ finishing-a-development-branch` line go away: finish is now a pipeline stage.

Detection, as wired here:
- `skill.prompt`: `stageOf` → `reach`; else `extraOf` → `addExtra`.
- Main-loop Write/Edit of `docs/superpowers/specs/*.md` → `reach(spec)`.
- Main-loop Write/Edit/Read of a superpowers plan → `reach(plan)` when it is a different plan than the active one or `plan` was never reached (so re-reading the same plan after finish does not restart; a new plan does).
- Main-loop `turn.complete`: `pathFrom(e.answer)` sets `sp.path` only while `sp.current === 'brainstorm'`.
- `agent.spawn` while `sp.stages` is non-empty: `roleOf(description)`, `taskNOf(description) ?? taskNOf(prompt)`.
- Agent `turn.complete` for a `review` agent: `verdictOf(e.answer)`.
- Role agents list under SUPERPOWERS (highest task first, at most 4); AGENTS lists the rest and shows only when one exists, its header still counting all.

**Files:**
- Modify: `types/index.d.ts`, `hooks/superpowers.ts`, `hooks/register.tsx`, `hooks/view.tsx`
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: everything from Task 1; `progressLines`, `agentRow`, `lineUp` (Tasks 2–3).
- Produces (types): `AgentRun` gains `role?: Role`, `taskN?: string`, `verdict?: 'ok' | 'issues'`; `Plan = { path: string; tasks: Task[] }` (no `finishing`); plugin state gains `sp: Sp`.
- Produces (`superpowers.ts`): `isSpecPath(p: string): boolean`.
- Produces (`view.tsx`): `spPanel(ui, sp: Sp, plan: Task[], runs: AgentRun[], v)`; `tasksPanel(ui, list, doneAt, v)` (no `finishing`).

- [ ] **Step 1: Write the failing tests**

Apply to `hooks/register.test.ts` (the finishing test becomes a pipeline test; new tests for the section, path badge, spec → architectural, SDD roles, no role outside superpowers, a narrow pane, and the plan moving out of TASKS):

```diff
diff --git a/hooks/register.test.ts b/hooks/register.test.ts
index 9af2f1a..87c10e3 100644
--- a/hooks/register.test.ts
+++ b/hooks/register.test.ts
@@ -106,10 +106,22 @@ test('superpowers plan fills the tasks panel and follows the ledger', async ($,
   expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
   await ui.unmount()
 
-  // todos win over the plan
+  // todos get their own TASKS section beside the plan
   await $.tool.call({ tool: 'TodoWrite', todos: [todo('Only', 'pending')] })
   ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
   expect(await ui.find({ text: /^ 0\/1$/ })).toBeDefined()
+  expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
+})
+
+test('a superpowers plan shows under SUPERPOWERS, not TASKS, with its done time', async ($, on) => {
+  mock.clock(on)
+  on('fs.read', (_$, e) => (e.path === SP ? { value: '### Task 1: A\n- [x] a\n' } : { deny: `ENOENT: ${e.path}` }))
+  on('tool.call', () => ({ result: {} }) as never)
+  await $.tool.call({ tool: 'Read', file_path: SP } as never)
+  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
+  expect(await ui.find({ text: /^⚡ SUPERPOWERS$/ })).toBeDefined()
+  expect(await ui.find({ text: /TASKS$/ })).toBeUndefined()
+  expect(await ui.find({ text: /^✓ 모두 완료 · (오전|오후) \d{1,2}:\d{2}$/ })).toBeDefined()
 })
 
 test('plan mode: ExitPlanMode makes its file the active plan and asks Claude to tick steps', async ($, on) => {
@@ -293,7 +305,7 @@ test('an agent waiting on its background work stays running, and a resumed one r
   expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 2: Lint / })).toBeDefined()
 })
 
-test('finishing-a-development-branch shows under the tasks until another plan', async ($, on) => {
+test('finish shows on the pipeline until another plan starts a new cycle', async ($, on) => {
   mock.clock(on)
   const B = '/r/docs/superpowers/plans/2026-02-01-next.md'
   on('fs.read', (_$, e) => (e.path === SP || e.path === B ? { value: '### Task 1: A\n- [x] a\n' } : { deny: `ENOENT: ${e.path}` }))
@@ -302,14 +314,97 @@ test('finishing-a-development-branch shows under the tasks until another plan',
 
   await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
   await $.skill.prompt({ skill: 'superpowers:finishing-a-development-branch', text: '' })
-  await $.tool.call({ tool: 'Read', file_path: SP } as never)
+  await $.tool.call({ tool: 'Read', file_path: SP } as never) // the same plan again: still finishing
   let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
-  expect(await ui.find({ text: /^⎇ finishing-a-development-branch$/ })).toBeDefined()
+  expect(await ui.find({ text: /●finish$/ })).toBeDefined()
   await ui.unmount()
 
   await $.tool.call({ tool: 'Write', file_path: B, content: '' } as never)
   ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
-  expect(await ui.find({ text: /^⎇ finishing-a-development-branch$/ })).toBeUndefined()
+  expect(await ui.find({ text: /●plan ○execute ○review ○finish$/ })).toBeDefined()
+})
+
+const sdd = (answer = '') => ({ answer, durationMs: 0, isAborted: false, turnId: 'T', reason: 'answer' }) as never
+
+test('superpowers section: hidden until a superpowers skill, then pipeline and path badge', async ($, on) => {
+  mock.clock(on)
+  on('skill.prompt', () => ({ text: '' }))
+  on('turn.complete', () => ({ text: '' }))
+  await $.skill.prompt({ skill: 'commit', text: '' })
+  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
+  expect(await ui.find({ text: /SUPERPOWERS/ })).toBeUndefined()
+  await ui.unmount()
+
+  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
+  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
+  expect(await ui.find({ text: /^⚡ SUPERPOWERS$/ })).toBeDefined()
+  expect(await ui.find({ text: /^●brainstorm$/ })).toBeDefined()
+  await ui.unmount()
+
+  await $.turn.complete(sdd('This looks bounded, so I will present a short design here.'))
+  await $.skill.prompt({ skill: 'superpowers:test-driven-development', text: '' })
+  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
+  expect(await ui.find({ text: /^BOUNDED$/ })).toBeDefined()
+  expect(await ui.find({ text: /^●brainstorm ○execute ○finish$/ })).toBeDefined()
+  expect(await ui.find({ text: /^\+ tdd$/ })).toBeDefined()
+  await ui.unmount()
+
+  // past brainstorming a reply no longer moves the badge
+  await $.skill.prompt({ skill: 'superpowers:executing-plans', text: '' })
+  await $.turn.complete(sdd('a spike would be overkill'))
+  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
+  expect(await ui.find({ text: /^BOUNDED$/ })).toBeDefined()
+  expect(await ui.find({ text: /^✓brainstorm ●execute ○finish$/ })).toBeDefined()
+})
+
+test('a spec makes the path architectural', async ($, on) => {
+  mock.clock(on)
+  on('skill.prompt', () => ({ text: '' }))
+  on('tool.call', () => ({ result: {} }) as never)
+  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
+  await $.tool.call({ tool: 'Write', file_path: '/r/docs/superpowers/specs/2026-01-01-x-design.md', content: '' } as never)
+  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
+  expect(await ui.find({ text: /^ARCHITECTURAL$/ })).toBeDefined()
+  // too wide for the pane: the done stages fold into ✓…
+  expect(await ui.find({ text: /^✓… ●spec ○plan ○execute ○review ○finish$/ })).toBeDefined()
+})
+
+test('SDD agents show by role under superpowers, not under agents', async ($, on) => {
+  mock.clock(on)
+  const ids: Record<string, string> = { 'Implement Task 4: Wire detector': 'I4', 'Review Task 3 (spec + quality)': 'R3', 'Explore auth': 'X1' }
+  on('skill.prompt', () => ({ text: '' }))
+  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: ids[e.description] }))
+  on('turn.complete', () => ({ text: '' }))
+  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
+  for (const description of Object.keys(ids)) await $.agent.spawn({ prompt: 'p', description } as never)
+  await $.turn.complete({ ...(sdd('**Task quality:** Needs fixes') as object), agentId: 'R3' } as never)
+
+  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
+  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] impl #4 +Haiku 5\.5 00:00$/ })).toBeDefined()
+  expect(await ui.find({ text: /^⚠ review #3 +issues 00:00$/ })).toBeDefined()
+  // AGENTS lists only the plain one, but counts all three
+  expect(await ui.find({ text: /^  2 running · 1 done$/ })).toBeDefined()
+  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 3: Explore auth / })).toBeDefined()
+  expect(await ui.find({ text: /\d: (Implement|Review) Task/ })).toBeUndefined()
+})
+
+test('a narrow pane folds the pipeline and skills instead of overflowing', async ($, on) => {
+  mock.clock(on)
+  on('skill.prompt', () => ({ text: '' }))
+  for (const skill of ['brainstorming', 'writing-plans', 'using-git-worktrees', 'subagent-driven-development', 'requesting-code-review'])
+    await $.skill.prompt({ skill: `superpowers:${skill}`, text: '' })
+  const ui = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: 20 }, surface: 'terminal' } as never)
+  const W = 30 // the pane never draws narrower
+  expect((await ui.find({ text: /^✓… .*●review ○finish$/ }))?.text.length).toBeLessThanOrEqual(W - 4)
+  expect((await ui.find({ text: /^… → .*requesting-code-review$/ }))?.text.length).toBeLessThanOrEqual(W - 4)
+})
+
+test('agents spawned outside superpowers get no role', async ($, on) => {
+  mock.clock(on)
+  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'A1' }))
+  await $.agent.spawn({ prompt: 'p', description: 'Review diff' } as never)
+  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
+  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 1: Review diff / })).toBeDefined()
 })
 
 test('activity shows alongside open tasks', async ($, on) => {
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `claude plugin test .`
Expected: FAIL — among others `superpowers section: hidden until…` (no `⚡ SUPERPOWERS`) and `SDD agents show by role…`.

- [ ] **Step 3: Update types, detection and handlers**

Apply to `types/index.d.ts`, `hooks/superpowers.ts` and `hooks/register.tsx`:

```diff
diff --git a/hooks/register.tsx b/hooks/register.tsx
index 64fbffe..20cb46f 100644
--- a/hooks/register.tsx
+++ b/hooks/register.tsx
@@ -1,16 +1,18 @@
 import { atom, read, update } from 'claude-code'
 import type { BuiltinToolResults, EngineInterface, Register, Timer } from 'claude-code'
 
-import type { Activity, AgentRun, AgentStatus, Main, Plan, SkillUse, Task } from '../types'
+import type { Activity, AgentRun, AgentStatus, Main, Plan, SkillUse, Sp, Task } from '../types'
 import { isPlanPath, keepCompleted, ledgerOwns, ledgerPath, parsePlan } from './plan'
-import { skillName } from './superpowers'
-import { activityPanel, agentsPanel, FRAME_MS, mainPanel, skillsPanel, SPINNER, tasksPanel } from './view'
+import { addExtra, EMPTY_SP, extraOf, isSpecPath, pathFrom, reach, roleOf, skillName, stageOf, taskNOf, verdictOf } from './superpowers'
+import { activityPanel, agentsPanel, FRAME_MS, mainPanel, skillsPanel, spPanel, SPINNER, tasksPanel } from './view'
 
 const tasks = atom({ plugin: 'task-progress', key: 'tasks' } as const, {} as Record<string, Task>)
 const plan = atom({ plugin: 'task-progress', key: 'plan' } as const, { path: '', tasks: [] } as Plan)
 const agents = atom({ plugin: 'task-progress', key: 'agents' } as const, {} as Record<string, AgentRun>)
 const skills = atom({ plugin: 'task-progress', key: 'skills' } as const, [] as SkillUse[])
 const activity = atom({ plugin: 'task-progress', key: 'activity' } as const, [] as Activity[])
+const sp = atom({ plugin: 'task-progress', key: 'sp' } as const, EMPTY_SP)
+const updateSp = ($: EngineInterface, patch: (s: Sp) => Sp) => update($, sp, s => patch({ ...EMPTY_SP, ...s }))
 
 const MAX_AGENTS = 20
 const MAX_ACTIVITY = 10
@@ -37,7 +39,7 @@ const refreshPlan = async ($: EngineInterface, path: string) => {
     const tasks = parsePlan(text, owned)
     // same plan (maybe now in the main checkout): done stays done
     const same = !!prev?.path && base(prev.path) === base(path)
-    return { path, tasks: same ? keepCompleted(prev.tasks, tasks) : tasks, ...(same && prev.finishing ? { finishing: true } : {}) }
+    return { path, tasks: same ? keepCompleted(prev.tasks, tasks) : tasks }
   })
 }
 
@@ -82,22 +84,28 @@ const animate = async ($: EngineInterface) => {
   else ticker = void ticker?.cancel()
 }
 
-// todos win, unless all are done and a plan still has open work
+// a superpowers plan has an SDD ledger beside it; a plan-mode plan has none
+const isSpPlan = (p: Plan | undefined) => !!p?.path && ledgerPath(p.path) !== null
+const spTasks = (p: Plan | undefined) => (isSpPlan(p) ? p!.tasks : [])
+
+// TASKS: todos win, unless all are done and a plan-mode plan still has open work
 const shownTasks = (todos: Task[], p: Plan | undefined) => {
-  const planOpen = (p?.tasks ?? []).some(t => t.status !== 'completed')
-  return todos.some(t => t.status !== 'completed') || (todos.length > 0 && !planOpen) ? todos : (p?.tasks ?? [])
+  const pm = isSpPlan(p) ? [] : (p?.tasks ?? [])
+  const planOpen = pm.some(t => t.status !== 'completed')
+  return todos.some(t => t.status !== 'completed') || (todos.length > 0 && !planOpen) ? todos : pm
 }
 
-// the moment the shown list became all done; cleared once something is open again
+const allDone = (list: Task[]) => list.length > 0 && list.every(t => t.status === 'completed')
+
+// the moment each list became all done; cleared once something is open again
 const stampDone = async ($: EngineInterface) => {
-  const [todos, p, m] = await Promise.all([read($, tasks).then(t => Object.values(t ?? {})), read($, plan), read($, main)])
-  const list = shownTasks(todos, p)
-  const allDone = list.length > 0 && list.every(t => t.status === 'completed')
-  const stamped = typeof m?.doneAt === 'number'
-  if (allDone && !stamped) {
-    const at = await $.clock.now()
-    await setMain($, () => ({ doneAt: at }))
-  } else if (!allDone && stamped) await setMain($, () => ({ doneAt: null }))
+  const [todos, p, m, s] = await Promise.all([read($, tasks).then(t => Object.values(t ?? {})), read($, plan), read($, main), read($, sp)])
+  const tasksDone = allDone(shownTasks(todos, p))
+  const planDone = allDone(spTasks(p))
+  if (tasksDone === (typeof m?.doneAt === 'number') && planDone === (typeof s?.doneAt === 'number')) return
+  const at = await $.clock.now()
+  if (tasksDone !== (typeof m?.doneAt === 'number')) await setMain($, () => ({ doneAt: tasksDone ? at : null }))
+  if (planDone !== (typeof s?.doneAt === 'number')) await updateSp($, x => ({ ...x, doneAt: planDone ? at : null }))
 }
 
 // `Bash · Run tests`, `Read · plan.ts`: the tool and the most telling input it has
@@ -148,9 +156,15 @@ export const register: Register = on => {
       const status: AgentStatus = waiting ? 'waiting' : e.reason === 'error' || e.reason === 'aborted' ? 'failed' : 'done'
       await update($, agents, all => {
         const r = all?.[agentId]
-        return r ? { ...all, [agentId]: { ...r, status, ...(waiting ? {} : { endedAt: at }) } } : all
+        const verdict = r?.role === 'review' && !waiting ? verdictOf(e.answer) : undefined
+        return r ? { ...all, [agentId]: { ...r, status, ...(waiting ? {} : { endedAt: at }), ...(verdict ? { verdict } : {}) } } : all
       })
-    } else await setMain($, () => ({ isRunning: false }))
+    } else {
+      await setMain($, () => ({ isRunning: false }))
+      // brainstorming says out loud which path it takes
+      const path = pathFrom(e.answer)
+      if (path) await updateSp($, s => (s.current === 'brainstorm' ? { ...s, path } : s))
+    }
     await animate($)
     return done
   })
@@ -175,11 +189,14 @@ export const register: Register = on => {
     const { agentId, model = '' } = spawned as { agentId?: string; model?: string }
     if (agentId) {
       const startedAt = await $.clock.now()
+      // while superpowers runs, its implementers and reviewers get a role
+      const role = (await read($, sp))?.stages.length ? roleOf(e.description) : undefined
+      const taskN = role ? (taskNOf(e.description) ?? taskNOf(e.prompt)) : undefined
       // next after the highest still listed: one left running keeps its number
       await update($, agents, all =>
         trimAgents({
           ...all,
-          [agentId]: { n: Math.max(0, ...Object.values(all ?? {}).map(r => r.n)) + 1, label: e.description || e.subagentType, model, startedAt, status: 'running' },
+          [agentId]: { n: Math.max(0, ...Object.values(all ?? {}).map(r => r.n)) + 1, label: e.description || e.subagentType, model, startedAt, status: 'running', ...(role ? { role } : {}), ...(taskN ? { taskN } : {}) },
         }),
       )
       await animate($)
@@ -192,7 +209,10 @@ export const register: Register = on => {
     const name = skillName(e.skill)
     // the same skill twice in a row is one entry
     await update($, skills, all => (all?.at(-1)?.name === name ? all : [...(all ?? []), { name, at }].slice(-MAX_SKILLS)))
-    if (/(^|:)finishing-a-development-branch$/.test(e.skill)) await update($, plan, p => ({ ...(p ?? { path: '', tasks: [] }), finishing: true }))
+    const stage = stageOf(e.skill)
+    const extra = extraOf(e.skill)
+    if (stage) await updateSp($, s => reach(s, stage))
+    else if (extra) await updateSp($, s => addExtra(s, extra))
     return next(e)
   })
 
@@ -245,21 +265,30 @@ export const register: Register = on => {
     const planned = e.tool === 'ExitPlanMode' ? (ran.result as BuiltinToolResults['ExitPlanMode'] | undefined)?.filePath : undefined
     // Read too: a plan written in an earlier session is executed by reading it
     const written = (e.tool === 'Write' || e.tool === 'Edit' || e.tool === 'Read') && isPlanPath(e.file_path) ? e.file_path : undefined
-    const path = planned ?? written ?? (await read($, plan))?.path
+    const prev = await read($, plan)
+    const path = planned ?? written ?? prev?.path
     if (path) await refreshPlan($, path)
+    if ((e.tool === 'Write' || e.tool === 'Edit') && isSpecPath(e.file_path)) await updateSp($, s => reach(s, 'spec'))
+    // a superpowers plan reaches the plan stage; one already reached is only re-read
+    const base = (p: string) => p.slice(p.lastIndexOf('/') + 1)
+    if (written && ledgerPath(written)) {
+      const fresh = !prev?.path || base(prev.path) !== base(written)
+      await updateSp($, s => (fresh || !s.stages.includes('plan') ? reach(s, 'plan') : s))
+    }
     await stampDone($)
     if (!planned) return ran
     return { ...ran, context: [...(ran.context ?? []), `Mark each step done by ticking it (- [x], or 1. [x] for numbered steps) in ${planned} as you finish it.`] }
   })
 
   on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
-    const [m, todos, p, runs, used, acts, now] = await Promise.all([
+    const [m, todos, p, runs, used, acts, s, now] = await Promise.all([
       read($, main).then(x => ({ ...DEFAULT_MAIN, ...x })),
       read($, tasks).then(Object.values),
       read($, plan),
       read($, agents).then(a => Object.values(a ?? {})),
       read($, skills).then(s => s ?? []),
       read($, activity).then(a => a ?? []),
+      read($, sp).then(x => ({ ...EMPTY_SP, ...x })),
       $.clock.now(),
     ])
     const list = shownTasks(todos, p)
@@ -271,8 +300,9 @@ export const register: Register = on => {
     return (
       <Box flexDirection="column">
         {mainPanel(ui, m, v)}
-        {list.length > 0 ? tasksPanel(ui, list, m.doneAt, !!p?.finishing, v) : null}
-        {runs.length > 0 ? agentsPanel(ui, runs, v) : null}
+        {s.stages.length > 0 ? spPanel(ui, s, spTasks(p), runs, v) : null}
+        {list.length > 0 ? tasksPanel(ui, list, m.doneAt, v) : null}
+        {runs.some(r => !r.role) ? agentsPanel(ui, runs, v) : null}
         {used.length > 0 ? skillsPanel(ui, used.map(u => u.name), v) : null}
         {acts.length > 0 ? activityPanel(ui, acts, v) : null}
       </Box>
diff --git a/hooks/superpowers.ts b/hooks/superpowers.ts
index dc295d8..a0467de 100644
--- a/hooks/superpowers.ts
+++ b/hooks/superpowers.ts
@@ -21,6 +21,8 @@ const EXTRA_OF: Record<string, string> = {
   'verification-before-completion': 'verification',
 }
 
+export const isSpecPath = (p: string) => /\/docs\/superpowers\/specs\/[^/]+\.md$/.test(p)
+
 export const EMPTY_SP: Sp = { stages: [], extras: [], doneAt: null }
 
 /** `superpowers:brainstorming` → `brainstorming` */
diff --git a/types/index.d.ts b/types/index.d.ts
index 2e40402..f07e244 100644
--- a/types/index.d.ts
+++ b/types/index.d.ts
@@ -6,7 +6,19 @@ export type Task = { status: TaskStatus; label: string; n?: string }
 export type AgentStatus = 'running' | 'waiting' | 'done' | 'failed'
 
 /** A subagent the model spawned; kept once it ends (`endedAt`), up to the latest 20 */
-export type AgentRun = { n: number; label: string; model: string; startedAt: number; endedAt?: number; status: AgentStatus }
+export type AgentRun = {
+  n: number
+  label: string
+  model: string
+  startedAt: number
+  endedAt?: number
+  status: AgentStatus
+  /** Set when superpowers dispatched it; such an agent shows under SUPERPOWERS, not AGENTS */
+  role?: Role
+  taskN?: string
+  /** A reviewer's report: approved, or issues to fix */
+  verdict?: 'ok' | 'issues'
+}
 
 /** A skill the session ran, in order */
 export type SkillUse = { name: string; at: number }
@@ -14,8 +26,8 @@ export type SkillUse = { name: string; at: number }
 /** A main-loop tool call: `Bash · Run tests` */
 export type Activity = { id: number; at: number; label: string; status: 'running' | 'ok' | 'error' }
 
-/** The plan file progress is read from when there are no todos; `finishing` once finishing-a-development-branch ran on it */
-export type Plan = { path: string; tasks: Task[]; finishing?: boolean }
+/** The active plan: a superpowers plan shows under SUPERPOWERS, a plan-mode plan under TASKS */
+export type Plan = { path: string; tasks: Task[] }
 
 /** Main-loop vitals, drawn like Flightdeck's main panel */
 export type Main = {
@@ -51,6 +63,7 @@ declare module 'claude-code' {
       agents: Record<string, AgentRun>
       skills: SkillUse[]
       activity: Activity[]
+      sp: Sp
     }
   }
 }
```

- [ ] **Step 4: Add the section**

Apply to `hooks/view.tsx` (also: ACTIVITY's border turns gray so the yellow border is SUPERPOWERS' own):

```diff
diff --git a/hooks/view.tsx b/hooks/view.tsx
index 8e12d0c..1a89aa4 100644
--- a/hooks/view.tsx
+++ b/hooks/view.tsx
@@ -1,7 +1,7 @@
 import type { EngineInterface } from 'claude-code'
 
-import type { Activity, AgentRun, Main, Task } from '../types'
-import { fitTail } from './superpowers'
+import type { Activity, AgentRun, Main, Sp, Task } from '../types'
+import { fitTail, pipeline } from './superpowers'
 
 /** `$.ui.resolve(e)`: the surface's Box, Text, ... */
 export type UI = ReturnType<EngineInterface['ui']['resolve']>
@@ -138,14 +138,13 @@ export const progressLines = ({ Text }: UI, list: Task[], doneAt: number | null,
 }
 
 // ---- tasks
-export const tasksPanel = (ui: UI, list: Task[], doneAt: number | null, finishing: boolean, v: Frame) => {
+export const tasksPanel = (ui: UI, list: Task[], doneAt: number | null, v: Frame) => {
   const { Box, Text } = ui
   const allDone = list.every(t => t.status === 'completed')
   return (
     <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} width={v.W}>
       <Text color="green" bold>{allDone ? '✓ TASKS' : 'TASKS'}</Text>
       {progressLines(ui, list, doneAt, v)}
-      {finishing ? <Text color="cyan" wrap="truncate">{`${v.busy ? v.spin : '⎇'} finishing-a-development-branch`}</Text> : null}
     </Box>
   )
 }
@@ -167,19 +166,56 @@ export const agentsPanel = (ui: UI, all: AgentRun[], v: Frame) => {
   const live = all.filter(r => r.status === 'running' || r.status === 'waiting').sort((x, y) => y.startedAt - x.startedAt)
   const ended = all.filter(r => r.status === 'done' || r.status === 'failed').sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0))
   const failed = ended.filter(r => r.status === 'failed').length
+  // superpowers' own agents show under SUPERPOWERS; the header still counts them
+  const shown = (rs: AgentRun[]) => rs.filter(r => !r.role)
   return (
     <Box flexDirection="column" borderStyle="round" borderColor="magenta" paddingX={1} width={v.W}>
       <Text wrap="truncate">
         <Text color="magenta" bold>AGENTS</Text>
         <Text dimColor>{`  ${live.length} running · ${ended.length - failed} done${failed > 0 ? ` · ${failed} failed` : ''}`}</Text>
       </Text>
-      {[...live, ...ended.slice(0, ENDED_SHOWN)].map(r =>
+      {[...shown(live), ...shown(ended).slice(0, ENDED_SHOWN)].map(r =>
         agentRow(ui, r, `${r.n}: ${r.label}`, ` ${prettyModel(r.model)} ${mmss((r.endedAt ?? v.now) - r.startedAt)}`, '-', v),
       )}
     </Box>
   )
 }
 
+// ---- superpowers: path badge, pipeline, plan progress, its agents by role, extras
+const ROLES_SHOWN = 4
+export const spPanel = (ui: UI, sp: Sp, plan: Task[], runs: AgentRun[], v: Frame) => {
+  const { Box, Text } = ui
+  const mark = { done: '✓', current: v.busy ? v.spin : '●', todo: '○' }
+  const steps = pipeline(sp).map(s => `${mark[s.state]}${s.stage}`)
+  // the highest task first: that is where SDD is now
+  const roles = runs
+    .filter(r => r.role)
+    .sort((x, y) => Number(y.taskN ?? 0) - Number(x.taskN ?? 0) || y.startedAt - x.startedAt)
+    .slice(0, ROLES_SHOWN)
+  return (
+    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={v.W}>
+      <Box justifyContent="space-between">
+        <Text color="yellow" bold>⚡ SUPERPOWERS</Text>
+        {sp.path ? <Text color="magenta" bold>{sp.path.toUpperCase()}</Text> : null}
+      </Box>
+      <Text wrap="truncate">{fitTail(steps, ' ', v.W - 4, '✓…')}</Text>
+      {plan.length > 0 ? progressLines(ui, plan, sp.doneAt, v) : null}
+      {roles.map(r =>
+        agentRow(
+          ui,
+          r,
+          `${r.role} ${r.taskN ? `#${r.taskN}` : r.label}`,
+          ` ${r.verdict ? (r.verdict === 'ok' ? 'approved' : 'issues') : prettyModel(r.model)} ${mmss((r.endedAt ?? v.now) - r.startedAt)}`,
+          ' ',
+          v,
+          r.verdict === 'issues' ? '⚠' : undefined,
+        ),
+      )}
+      {sp.extras.length > 0 ? <Text dimColor wrap="truncate">{sp.extras.map(x => `+ ${x}`).join('  ')}</Text> : null}
+    </Box>
+  )
+}
+
 // ---- skills: every skill run, oldest dropped first when too wide
 export const skillsPanel = ({ Box, Text }: UI, names: string[], v: Frame) => (
   <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1} width={v.W}>
@@ -195,8 +231,8 @@ const hhmm = (at: number) => {
   return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
 }
 export const activityPanel = ({ Box, Text }: UI, items: Activity[], v: Frame) => (
-  <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} width={v.W}>
-    <Text color="yellow" bold>ACTIVITY</Text>
+  <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} width={v.W}>
+    <Text bold>ACTIVITY</Text>
     {items
       .slice(-ACTIVITY_SHOWN)
       .reverse()
```

- [ ] **Step 5: Run tests and typecheck**

Run: `claude plugin test .` — Expected: `37 pass`, `0 fail`.
Run: `bunx -p typescript tsc -p .` — Expected: no `error TS` lines.

- [ ] **Step 6: Commit**

```bash
git add types/index.d.ts hooks/superpowers.ts hooks/register.tsx hooks/view.tsx hooks/register.test.ts
git commit -m "feat: SUPERPOWERS 섹션 (경로, 파이프라인, plan 진행률, SDD 역할)"
```

---

### Task 5: README and version

**Files:**
- Modify: `README.md` (whole file below)
- Modify: `.claude-plugin/plugin.json` (`"version": "0.6.0"` → `"0.7.0"`)

The demo GIF and screenshot still show the old pane; re-recording them is out of scope for this plan.

- [ ] **Step 1: Replace `README.md`**

````markdown
# claude-task-progress

Claude Code mod: a pane docked to the right of the transcript that monitors any session, with a separate section for the superpowers workflow. Sections with nothing to show stay hidden.

1. **main** — model, working/idle, effort, permission mode, request count, context gauge (⟲ compactions), cost and rate limits (layout from [Flightdeck](https://github.com/scasella/claude-flightdeck), MIT)
2. **⚡ SUPERPOWERS** — shows once a superpowers skill runs (or a superpowers plan is opened):
   - the path brainstorming chose (`SPIKE` / `BOUNDED` / `ARCHITECTURAL`, read from its reply; a spec or plan makes it architectural)
   - the pipeline `✓brainstorm ✓spec ✓plan ●execute ○review ○finish`, shaped by the path; `worktree` joins once reached, and done stages fold into `✓…` when the pane is narrow
   - the plan's progress bar and current task (`docs/superpowers/plans/*.md`, `### Task N:` headings, completed by the SDD ledger or ticked steps), and when it all finished
   - SDD's agents by role: `impl #4  Haiku 5.5 01:12`, `review #3  approved 00:41` (`⚠ … issues` when the review wants fixes)
   - extras used along the way: `+ tdd  + debugging  + verification`
3. **TASKS** — todos (TodoWrite / TaskCreate), else a plan-mode plan (`~/.claude/plans/*.md`, its `- [ ]` checkboxes, else its numbered steps ticked as `1. [x]`): progress bar with `done/total · %` beside it, in-progress tasks in yellow, the current step below with its number (`▸ #2 Wiring`), and `✓ 모두 완료 · 오후 2:05` once every task is done
4. **AGENTS** — every other subagent as `1: Explore auth --- Haiku 5.5 01:23`, running ones first (⏸ when waiting on its own background work), then the latest 3 that ended (`✓` done, `✗` failed) with their final time. The header counts all agents: `2 running · 5 done · 1 failed`
5. **SKILLS** — every skill run, in order: `brainstorming → writing-plans → subagent-driven-development`
6. **ACTIVITY** — the main loop's latest 3 tool calls: `14:05 ⠹ Bash · Run tests`, `✓` once done, `✗` on error

While Claude or an agent works, spinners turn and a bright cell sweeps the in-progress part of each progress bar.

![task-progress demo](docs/images/task-progress.gif)

![task-progress screenshot](docs/images/task-progress.png)

The pane opens on session start. `/task-progress` reopens it, `/task-progress close` closes it. In a non-fullscreen terminal it sits inline above the prompt instead.

## Install

```
/plugin install task-progress --marketplace bob-park/claude-task-progress
```

Answer `y` to add the marketplace, then pick a scope.
````

- [ ] **Step 2: Bump the version**

In `.claude-plugin/plugin.json` change `"version": "0.6.0"` to `"version": "0.7.0"`.

- [ ] **Step 3: Final check**

Run: `claude plugin test .` — Expected: `37 pass`, `0 fail`.
Run: `bunx -p typescript tsc -p .` — Expected: no `error TS` lines.

- [ ] **Step 4: Commit**

```bash
git add README.md .claude-plugin/plugin.json
git commit -m "docs: README 새 섹션 설명, 버전 0.7.0"
```

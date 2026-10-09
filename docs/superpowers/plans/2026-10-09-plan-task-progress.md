# Plan-based Task Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the TASKS panel from the active plan file (superpowers plan + SDD ledger, or plan-mode plan) whenever no todos exist.

**Architecture:** A pure parser module `hooks/plan.ts` turns plan text (+ optional ledger text) into `Task[]`. `hooks/register.tsx` remembers the active plan path in a new `plan` atom, re-reads it after every successful main-loop tool call, and the render picks todos first, plan tasks second.

**Tech Stack:** Claude Code mod (TypeScript/TSX, `claude-code` API, `claude-code/testing`), run with `claude plugin test .`

**Spec:** `docs/superpowers/specs/2026-10-09-plan-task-progress-design.md`

## Global Constraints

- Todos (`tasks` atom) win when non-empty; plan tasks are shown only otherwise.
- Only main-loop tool calls (`!e.agentId`) set or refresh the active plan.
- Plan paths: `/docs/superpowers/plans/*.md` or `/.claude/plans/*.md` via Write/Edit; any `ExitPlanMode` `result.filePath`.
- Ledger: `<root>/.superpowers/sdd/<basename without .md>/progress.md`, `<root>` = plan path before `/docs/superpowers/plans/`; used only if its first line contains the plan's basename.
- ExitPlanMode hint, verbatim: `Mark each step done by ticking it (- [x]) in <path> as you finish it.`
- A failed read never fails the tool call and leaves stored plan tasks untouched.
- No new dependencies. No changes to the panel's rendering beyond choosing its list.

## Review Focus

- `### Task` / `- [ ]` inside fenced code blocks (plans quote templates) → ignored. Test in Task 1.
- Ledger whose first line names another plan → ignored. Test in Task 1.
- CRLF line endings in a plan → parsed the same as LF. Test in Task 1.
- Plan file deleted/unreadable after being active → previous tasks stay. Test in Task 2.
- Todos and plan both present → todos shown. Test in Task 2.

---

### Task 1: Plan parser

**Files:**
- Create: `hooks/plan.ts`
- Test: `hooks/plan.test.ts`

**Interfaces:**
- Consumes: `Task`, `TaskStatus` from `types/index.d.ts` (`{ status: 'pending' | 'in_progress' | 'completed'; label: string }`)
- Produces:
  - `isPlanPath(path: string): boolean`
  - `ledgerPath(planPath: string): string | null`
  - `ledgerOwns(planPath: string, ledger: string): boolean`
  - `parsePlan(text: string, ledger?: string): Task[]`

- [ ] **Step 1: Write the failing tests**

`hooks/plan.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'

import { isPlanPath, ledgerOwns, ledgerPath, parsePlan } from './plan'

const SP = '/r/docs/superpowers/plans/2026-01-01-x.md'
const spPlan = [
  '# X Plan',
  '',
  'Steps use checkbox (`- [ ]`) syntax.',
  '```markdown',
  '### Task 9: Template only',
  '- [ ] **Step 1: not real**',
  '```',
  '### Task 1: Parser',
  '- [x] **Step 1: Write test**',
  '- [x] **Step 2: Implement**',
  '### Task 2: Wiring',
  '- [x] **Step 1: Write test**',
  '- [ ] **Step 2: Implement**',
  '### Task 3: **Docs**',
  '- [ ] **Step 1: README**',
].join('\n')

test('plan paths and ledger path', () => {
  expect(isPlanPath(SP)).toBe(true)
  expect(isPlanPath('/Users/a/.claude/plans/happy-cat.md')).toBe(true)
  expect(isPlanPath('/r/docs/notes.md')).toBe(false)
  expect(ledgerPath(SP)).toBe('/r/.superpowers/sdd/2026-01-01-x/progress.md')
  expect(ledgerPath('/Users/a/.claude/plans/happy-cat.md')).toBeNull()
  expect(ledgerOwns(SP, '# SDD ledger — plan: docs/superpowers/plans/2026-01-01-x.md\n')).toBe(true)
  expect(ledgerOwns(SP, '# SDD ledger — plan: docs/superpowers/plans/other.md\n')).toBe(false)
})

test('superpowers plan: one task per heading, checkboxes complete a task, code fences ignored', () => {
  expect(parsePlan(spPlan)).toEqual([
    { status: 'completed', label: 'Parser' },
    { status: 'in_progress', label: 'Wiring' },
    { status: 'pending', label: 'Docs' },
  ])
})

test('superpowers plan: ledger completion lines complete tasks', () => {
  const plain = '### Task 1: A\n- [ ] s\n### Task 2: B\n- [ ] s\n### Task 3: C\n- [ ] s'
  expect(parsePlan(plain)).toEqual([
    { status: 'pending', label: 'A' },
    { status: 'pending', label: 'B' },
    { status: 'pending', label: 'C' },
  ])
  const ledger = '# SDD ledger — plan: x\nTask 1: complete (commits a..b, tests: t → pass)\n'
  expect(parsePlan(plain, ledger)).toEqual([
    { status: 'completed', label: 'A' },
    { status: 'in_progress', label: 'B' },
    { status: 'pending', label: 'C' },
  ])
})

test('plan-mode plan: one task per checkbox, CRLF ok', () => {
  expect(parsePlan('# Plan\r\n- [x] Read code\r\n  - [ ] Edit file\r\n- [ ] Run tests\r\n')).toEqual([
    { status: 'completed', label: 'Read code' },
    { status: 'in_progress', label: 'Edit file' },
    { status: 'pending', label: 'Run tests' },
  ])
})

test('plan-mode plan without checkboxes falls back to numbered items, else nothing', () => {
  expect(parsePlan('# Plan\n1. **Read** code\n   1. nested is skipped\n2. Edit')).toEqual([
    { status: 'pending', label: 'Read code' },
    { status: 'pending', label: 'Edit' },
  ])
  expect(parsePlan('# Plan\nJust prose.')).toEqual([])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `claude plugin test .`
Expected: `hooks/plan.test.ts` fails to load — cannot resolve `./plan`.

- [ ] **Step 3: Write the implementation**

`hooks/plan.ts`:

```ts
import type { Task } from '../types'

const TASK_HEADING = /^###\s+Task\s+(\d+):\s*(.+)$/
const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/
const NUMBERED = /^\d+\.\s+(.+)$/

const clean = (s: string) => s.replace(/\*\*/g, '').trim()

/** Plan lines outside fenced code blocks: plans quote templates inside fences */
const planLines = (text: string) => {
  let fenced = false
  return text.split(/\r?\n/).filter(l => {
    if (l.trimStart().startsWith('```')) fenced = !fenced
    else return !fenced
    return false
  })
}

export const isPlanPath = (p: string) => /\/(docs\/superpowers\/plans|\.claude\/plans)\/[^/]+\.md$/.test(p)

/** The SDD ledger beside a superpowers plan; null for any other plan */
export const ledgerPath = (planPath: string) => {
  const m = /^(.*)\/docs\/superpowers\/plans\/([^/]+)\.md$/.exec(planPath)
  return m ? `${m[1]}/.superpowers/sdd/${m[2]}/progress.md` : null
}

/** A ledger's first line names the plan it tracks */
export const ledgerOwns = (planPath: string, ledger: string) =>
  (ledger.split(/\r?\n/, 1)[0] ?? '').includes(planPath.slice(planPath.lastIndexOf('/') + 1))

/** Done items first get their status; the first open one is current once anything has started */
const withCurrent = (items: Array<{ label: string; done: boolean }>, started: boolean): Task[] => {
  const current = items.findIndex(i => !i.done)
  return items.map((i, n) => ({
    status: i.done ? 'completed' : started && n === current ? 'in_progress' : 'pending',
    label: i.label,
  }))
}

export const parsePlan = (text: string, ledger?: string): Task[] => {
  const lines = planLines(text)

  // superpowers: `### Task N:` headings, steps beneath, ledger lines `Task N: complete`
  const tasks: Array<{ n: string; label: string; steps: boolean[] }> = []
  for (const line of lines) {
    const h = TASK_HEADING.exec(line)
    if (h) tasks.push({ n: h[1]!, label: clean(h[2]!), steps: [] })
    else {
      const c = CHECKBOX.exec(line)
      if (c) tasks.at(-1)?.steps.push(c[1] !== ' ')
    }
  }
  if (tasks.length > 0) {
    const logged = new Set([...(ledger ?? '').matchAll(/^Task (\d+): complete/gm)].map(m => m[1]))
    const started = logged.size > 0 || tasks.some(t => t.steps.some(Boolean))
    return withCurrent(
      tasks.map(t => ({ label: t.label, done: logged.has(t.n) || (t.steps.length > 0 && t.steps.every(Boolean)) })),
      started,
    )
  }

  // plan mode: checkboxes, else top-level numbered items
  const items = lines.map(l => CHECKBOX.exec(l)).filter(m => m !== null).map(m => ({ label: clean(m[2]!), done: m[1] !== ' ' }))
  if (items.length > 0) return withCurrent(items, items.some(i => i.done))
  return lines.map(l => NUMBERED.exec(l)).filter(m => m !== null).map(m => ({ status: 'pending' as const, label: clean(m[1]!) }))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `claude plugin test .`
Expected: all tests in `hooks/plan.test.ts` and `hooks/register.test.ts` pass (7 pass, 0 fail).

- [ ] **Step 5: Commit**

```bash
git add hooks/plan.ts hooks/plan.test.ts
git commit -m "feat: plan 파일에서 task 진행률 파싱"
```

---

### Task 2: Wire the active plan into the pane

**Files:**
- Modify: `types/index.d.ts` (add `Plan`, extend `PluginState`)
- Modify: `hooks/register.tsx` (imports; atom near line 6; `tool.call` hook lines 109-132; render line 135 and 183)
- Modify: `README.md` (TASKS bullet)
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: `isPlanPath`, `ledgerPath`, `ledgerOwns`, `parsePlan` from `hooks/plan.ts` (Task 1)
- Produces: `Plan` type `{ path: string; tasks: Task[] }`; `plan` atom key `'plan'`

- [ ] **Step 1: Write the failing tests**

Append to `hooks/register.test.ts`:

```ts
const SP = '/r/docs/superpowers/plans/2026-01-01-x.md'
const LEDGER = '/r/.superpowers/sdd/2026-01-01-x/progress.md'
const PM = '/Users/a/.claude/plans/happy-cat.md'

// stands for the engine answering every tool
const answer = (e: { tool: string }) =>
  ({ result: e.tool === 'ExitPlanMode' ? { plan: null, isAgent: false, filePath: PM } : { oldTodos: [], newTodos: [] } }) as never

test('superpowers plan fills the tasks panel and follows the ledger', async ($, on) => {
  const files: Record<string, string> = {
    [SP]: '### Task 1: Parser\n- [ ] a\n### Task 2: Wiring\n- [ ] a\n### Task 3: Docs\n- [ ] a\n',
    [LEDGER]: '# SDD ledger — plan: docs/superpowers/plans/2026-01-01-x.md\nTask 1: complete (x)\n',
  }
  // stands for the disk
  on('fs.read', (_$, e) => {
    if (e.path in files) return files[e.path]!
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('tool.call', (_$, e) => answer(e))

  await $.tool.call({ tool: 'Write', file_path: SP, content: files[SP]! })
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 1\/3$/ })).toBeDefined()
  expect(await ui.find({ text: /^▸ Wiring$/ })).toBeDefined()
  await ui.unmount()

  // SDD's task-done script appends from Bash: any later tool call re-reads
  files[LEDGER] += 'Task 2: complete (y)\n'
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
  await ui.unmount()

  // plan gone: keep what we had
  delete files[SP]
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
  await ui.unmount()

  // todos win over the plan
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Only', 'pending')] })
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 0\/1$/ })).toBeDefined()
})

test('plan mode: ExitPlanMode makes its file the active plan and asks Claude to tick steps', async ($, on) => {
  on('fs.read', (_$, e) => {
    if (e.path === PM) return '# Plan\n- [x] Read code\n- [ ] Edit file\n'
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('tool.call', (_$, e) => answer(e))

  const ran = await $.tool.call({ tool: 'ExitPlanMode' } as never)
  expect(ran.context).toEqual([`Mark each step done by ticking it (- [x]) in ${PM} as you finish it.`])

  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 1\/2$/ })).toBeDefined()
  expect(await ui.find({ text: /^▸ Edit file$/ })).toBeDefined()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `claude plugin test .`
Expected: the two new tests FAIL (no ` 1/3` / no `context`); earlier tests still pass.

- [ ] **Step 3: Add the type**

`types/index.d.ts` — after the `Task` type add:

```ts
/** The plan file progress is read from when there are no todos */
export type Plan = { path: string; tasks: Task[] }
```

and change `PluginState`:

```ts
    'task-progress': { tasks: Record<string, Task>; main: Main; plan: Plan }
```

- [ ] **Step 4: Wire it in `hooks/register.tsx`**

Imports (top of file):

```ts
import type { Main, Plan, Task } from '../types'
import { isPlanPath, ledgerOwns, ledgerPath, parsePlan } from './plan'
```

After the `tasks` atom (line 6):

```ts
const plan = atom({ plugin: 'task-progress', key: 'plan' } as const, { path: '', tasks: [] } as Plan)

// a failed read keeps what the pane already shows
const refreshPlan = async ($: EngineInterface, path: string) => {
  const text = await $.fs.read(path).catch(() => null)
  if (typeof text !== 'string') return
  const at = ledgerPath(path)
  const ledger = at ? await $.fs.read(at).catch(() => null) : null
  const owned = typeof ledger === 'string' && ledgerOwns(path, ledger) ? ledger : undefined
  await update($, plan, () => ({ path, tasks: parsePlan(text, owned) }))
}
```

In the `tool.call` hook, replace the final `return ran` (line 131) with:

```ts
    if (e.agentId) return ran
    const planned = e.tool === 'ExitPlanMode' ? (ran.result as BuiltinToolResults['ExitPlanMode'] | undefined)?.filePath : undefined
    const written = (e.tool === 'Write' || e.tool === 'Edit') && isPlanPath(e.file_path) ? e.file_path : undefined
    const path = planned ?? written ?? (await read($, plan))?.path
    if (path) await refreshPlan($, path)
    if (!planned) return ran
    return { ...ran, context: [...(ran.context ?? []), `Mark each step done by ticking it (- [x]) in ${planned} as you finish it.`] }
```

In the render hook, replace line 135:

```ts
    const [m, todos, p] = await Promise.all([
      read($, main).then(x => ({ ...DEFAULT_MAIN, ...x })),
      read($, tasks).then(Object.values),
      read($, plan),
    ])
    const list = todos.length > 0 ? todos : (p?.tasks ?? [])
```

(`list` keeps its name, so lines 183-218 are unchanged.)

- [ ] **Step 5: Run tests and validate**

Run: `claude plugin test .`
Expected: all tests pass (9 pass, 0 fail).

Run: `claude plugin validate .`
Expected: no errors (lists the `plan` atom among the module's state).

If TypeScript rejects `e.file_path` after the `Write`/`Edit` narrowing, or the `context` spread on the `ran` union, cast exactly as the existing `TaskCreate` branch does (`ran.result as …`) — do not widen with `any`.

- [ ] **Step 6: README**

In `README.md`, replace the TASKS bullet with:

```markdown
2. **TASKS** — progress bar with `done/total · %` right next to it (in-progress tasks in yellow), and the current step on the line below. Tasks come from todos (TodoWrite / TaskCreate); with none, from the active plan: a superpowers plan (`docs/superpowers/plans/*.md`, `### Task N:` headings, completed by its SDD ledger or ticked steps) or a plan-mode plan (`~/.claude/plans/*.md`, its `- [ ]` checkboxes)
```

- [ ] **Step 7: Commit**

```bash
git add types/index.d.ts hooks/register.tsx hooks/register.test.ts README.md
git commit -m "feat: todo 가 없으면 활성 plan 파일로 task progress 표시"
```

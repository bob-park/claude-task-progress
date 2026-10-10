import { expect, mock, test } from 'claude-code/testing'
import type { AgentRun } from '../types'
import { pushActivity, withStatus } from './register'
import { doneTime } from './view'

const pane = {
  plugin: 'task-progress',
  component: 'Pane' as const,
  requestId: 'task-progress',
  props: { title: 'Task Progress', isFocused: false, bodyColumns: 46, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} },
}

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status, activeForm: `${content}ing` })

test('main panel shows idle, then working once a turn starts', async ($, on) => {
  mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /· main$/ })).toBeDefined()
  expect(await ui.find({ text: /○ idle/ })).toBeDefined()
  expect(await ui.find({ text: /TASKS/ })).toBeUndefined() // no tasks yet: no tasks panel
  await ui.unmount()

  await $.turn.start({ text: 'go', turnId: 'T1' })
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] working$/ })).toBeDefined() // spinner while working
})

test('tasks panel shows done/total next to the bar and the current step below', async ($, on) => {
  mock.clock(on)
  // stands for the engine answering the tool
  on('tool.call', () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
  const write = (todos: ReturnType<typeof todo>[]) => $.tool.call({ tool: 'TodoWrite', todos })

  await write([todo('a', 'completed'), todo('Build', 'in_progress'), todo('c', 'pending')])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane, surface } as never)
    expect((await ui.find({ text: /^ 1\/3$/ }))?.props.color).toBe('blue')
    expect(await ui.find({ text: /^ · 33%$/ })).toBeDefined()
    expect((await ui.find({ text: /^▓+$/ }))?.props.color).toBe('yellow')
    expect(await ui.find({ text: /^▸ Building$/ })).toBeDefined()
    await ui.unmount()
  }

  await write([todo('a', 'completed'), todo('Ship', 'pending')])
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^○ 다음: Shiping$/ })).toBeDefined()
  await ui.unmount()

  await write([todo('a', 'completed')])
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^✓ 모두 완료 · (오전|오후) \d{1,2}:\d{2}$/ })).toBeDefined()
})

test('done time reads as 오전/오후 h:mm, with the date once it is another day', () => {
  const at = new Date(2026, 9, 9, 14, 5).getTime()
  expect(doneTime(at, at + 60_000)).toBe('오후 2:05')
  expect(doneTime(new Date(2026, 9, 9, 0, 30).getTime(), at)).toBe('오전 12:30')
  expect(doneTime(at, new Date(2026, 9, 10, 9, 0).getTime())).toBe('10월 9일 오후 2:05')
})

const SP = '/r/docs/superpowers/plans/2026-01-01-x.md'
const LEDGER = '/r/.superpowers/sdd/2026-01-01-x/progress.md'
const PM = '/Users/a/.claude/plans/happy-cat.md'

// stands for the engine answering every tool
const answer = (e: { tool: string }) =>
  ({ result: e.tool === 'ExitPlanMode' ? { plan: null, isAgent: false, filePath: PM } : { oldTodos: [], newTodos: [] } }) as never

test('superpowers plan fills the tasks panel and follows the ledger', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    [SP]: '### Task 1: Parser\n- [ ] a\n### Task 2: Wiring\n- [ ] a\n### Task 3: Docs\n- [ ] a\n',
    [LEDGER]: '# SDD ledger — plan: docs/superpowers/plans/2026-01-01-x.md\nTask 1: complete (x)\n',
  }
  // stands for the disk
  on('fs.read', (_$, e) => {
    if (e.path in files) return { value: files[e.path]! }
    return { deny: `ENOENT: ${e.path}` }
  })
  on('tool.call', (_$, e) => answer(e))

  await $.tool.call({ tool: 'Write', file_path: SP, content: files[SP]! })
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 1\/3$/ })).toBeDefined()
  expect(await ui.find({ text: /^▸ #2 Wiring$/ })).toBeDefined()
  await ui.unmount()

  // SDD's task-done script appends from Bash: any later tool call re-reads
  files[LEDGER] += 'Task 2: complete (y)\n'
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
  await ui.unmount()

  // finishing the branch drops the ledger: done tasks stay done
  delete files[LEDGER]
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
  expect(await ui.find({ text: /^▸ #3 Docs$/ })).toBeDefined()
  await ui.unmount()

  // plan gone: keep what we had
  delete files[SP]
  await $.tool.call({ tool: 'Bash', command: 'true' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
  await ui.unmount()

  // todos get their own TASKS section beside the plan
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Only', 'pending')] })
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 0\/1$/ })).toBeDefined()
  expect(await ui.find({ text: /^ 2\/3$/ })).toBeDefined()
})

test('a superpowers plan shows under SUPERPOWERS, not TASKS, with its done time', async ($, on) => {
  mock.clock(on)
  on('fs.read', (_$, e) => (e.path === SP ? { value: '### Task 1: A\n- [x] a\n' } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  await $.tool.call({ tool: 'Read', file_path: SP } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^⚡ SUPERPOWERS$/ })).toBeDefined()
  expect(await ui.find({ text: /TASKS$/ })).toBeUndefined()
  expect(await ui.find({ text: /^✓ 모두 완료 · (오전|오후) \d{1,2}:\d{2}$/ })).toBeDefined()
})

test('plan mode: ExitPlanMode makes its file the active plan and asks Claude to tick steps', async ($, on) => {
  mock.clock(on)
  on('fs.read', (_$, e) => {
    if (e.path === PM) return { value: '# Plan\n- [x] Read code\n- [ ] Edit file\n' }
    return { deny: `ENOENT: ${e.path}` }
  })
  on('tool.call', (_$, e) => answer(e))

  const ran = await $.tool.call({ tool: 'ExitPlanMode' } as never)
  expect(ran.context).toEqual([`Mark each step done by ticking it (- [x], or 1. [x] for numbered steps) in ${PM} as you finish it.`])

  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 1\/2$/ })).toBeDefined()
  expect(await ui.find({ text: /^▸ Edit file$/ })).toBeDefined() // checkboxes carry no number
})

test('reading a plan written in an earlier session makes it the active plan', async ($, on) => {
  mock.clock(on)
  on('fs.read', (_$, e) => (e.path === SP ? { value: '### Task 1: A\n- [x] a\n### Task 2: B\n- [ ] a\n' } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', (_$, e) => answer(e))

  await $.tool.call({ tool: 'Read', file_path: SP } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 1\/2$/ })).toBeDefined()
})

test('activity lists the latest main-loop tool calls, newest on top, ✗ on error', async ($, on) => {
  mock.clock(on)
  on('tool.call', (_$, e) => (e.tool === 'Read' ? { result: {}, isError: true } : { result: {} }) as never)
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ACTIVITY$/ })).toBeUndefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Bash', command: 'bun test', description: 'Run tests' } as never)
  await $.tool.call({ tool: 'Read', file_path: '/r/a/missing.ts' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/r/a/plan.ts' } as never)
  await $.tool.call({ tool: 'Grep', pattern: 'TODO' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ACTIVITY$/ })).toBeDefined()
  const rows = await ui.findAll({ text: /^[✓✗⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] \w+ · / })
  expect(rows.map(r => r.text)).toEqual(['✓ Grep · TODO', '✓ Edit · plan.ts', '✗ Read · missing.ts']) // the latest 3
  expect(await ui.find({ text: /^\d\d:\d\d $/ })).toBeDefined()
})

test('a tool call shows as running until it returns', async ($, on) => {
  mock.clock(on)
  let running = false
  on('tool.call', async () => {
    const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
    running = !!(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Bash · Run tests$/ }))
    await ui.unmount()
    return { result: {} } as never
  })
  await $.tool.call({ tool: 'Bash', command: 'bun test', description: 'Run tests' } as never)
  expect(running).toBe(true)
})

test('skills list every skill run in order, a repeat in a row once', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  for (const skill of ['superpowers:brainstorming', 'superpowers:brainstorming', 'commit', 'superpowers:writing-plans'])
    await $.skill.prompt({ skill, text: '' })
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^SKILLS$/ })).toBeDefined()
  expect(await ui.find({ text: /^brainstorming → commit → writing-plans$/ })).toBeDefined()
})

test('agents list below the tasks: num, label, model and mm:ss', async ($, on) => {
  const clock = mock.clock(on)
  // stands for the engine starting and ending agents
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: e.description === 'Explore auth' ? 'A1' : 'A2' }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  const end = (agentId: string) =>
    $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'T', agentId, reason: 'answer' } as never)

  await $.agent.spawn({ prompt: 'p', description: 'Explore auth' } as never)
  await clock.advance(41_000)
  await $.agent.spawn({ prompt: 'p', description: 'Review diff' } as never)
  await clock.advance(42_000)

  // the latest on top
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^AGENTS$/ })).toBeDefined()
  expect(await ui.find({ text: /^  2 running · 0 done$/ })).toBeDefined()
  const rows = await ui.findAll({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] \d: / })
  expect(rows.map(r => r.text)).toEqual([
    expect.stringMatching(/^. 2: Review diff -+ Haiku 5\.5 00:42$/),
    expect.stringMatching(/^. 1: Explore auth -+ Haiku 5\.5 01:23$/),
  ])
  await ui.unmount()

  // a finished one stays below the running ones with ✓ and its final time
  await end('A1')
  await clock.advance(10_000)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect((await ui.findAll({ text: /^. \d: / })).map(r => r.text)).toEqual([
    expect.stringMatching(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 2: Review diff -+ Haiku 5\.5 00:52$/),
    expect.stringMatching(/^✓ 1: Explore auth -+ Haiku 5\.5 01:23$/),
  ])
  await ui.unmount()

  // a new prompt keeps them; a failed one is ✗ and counted
  await $.turn.start({ text: 'next', turnId: 'T2' })
  await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'T', agentId: 'A2', reason: 'error' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^  0 running · 1 done · 1 failed$/ })).toBeDefined()
  expect(await ui.find({ text: /^✗ 2: Review diff / })).toBeDefined()
  expect(await ui.find({ text: /^✓ 1: Explore auth / })).toBeDefined()
})

test('agents show the latest 3 ended ones, and keep at most 20', async ($, on) => {
  const clock = mock.clock(on)
  let k = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `A${++k}` }))
  on('turn.complete', () => ({ text: '' }))
  for (let i = 1; i <= 22; i++) {
    await $.agent.spawn({ prompt: 'p', description: `Job ${i}` } as never)
    await clock.advance(1000)
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'T', agentId: `A${i}`, reason: 'answer' } as never)
  }
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^  0 running · 20 done$/ })).toBeDefined()
  expect((await ui.findAll({ text: /^✓ \d+: / })).map(r => r.text.split(' -')[0])).toEqual(['✓ 22: Job 22', '✓ 21: Job 21', '✓ 20: Job 20'])
})

test('a TaskCreate task shows its number on the current line', async ($, on) => {
  mock.clock(on)
  on('tool.call', (_$, e) => ({ result: e.tool === 'TaskCreate' ? { task: { id: '7', subject: 'x' } } : {} }) as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Ship', description: 'd' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^▸ #7 Ship$/ })).toBeDefined()
})

test('header shows working while an agent runs after the main turn ended', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'A1' }))
  await $.agent.spawn({ prompt: 'p', description: 'Background scan' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] working$/ })).toBeDefined()
})

test('a new plan shows once every todo is done', async ($, on) => {
  mock.clock(on)
  on('fs.read', (_$, e) => (e.path === SP ? { value: '### Task 1: A\n- [ ] a\n### Task 2: B\n- [ ] a\n' } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', (_$, e) => ({ result: e.tool === 'TaskCreate' ? { task: { id: '1', subject: 'x' } } : {} }) as never)

  await $.tool.call({ tool: 'TaskCreate', subject: 'Old', description: 'd' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 0\/2$/ })).toBeDefined()
})

test('an agent waiting on its background work stays running, and a resumed one runs again', async ($, on) => {
  mock.clock(on)
  const status: Record<string, string> = { A1: 'waiting', A2: 'completed' }
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: e.description === 'Scan' ? 'A1' : 'A2' }))
  on('agent.list', () => ({ value: Object.entries(status).map(([id, s]) => ({ id, status: s, description: '', type: 'general-purpose' })) }) as never)
  on('turn.step', async function* () { return { answer: '', toolUses: [] } as never })
  on('turn.complete', () => ({ text: '' }))
  const end = (agentId: string) =>
    $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'T', agentId, reason: 'answer' } as never)

  await $.agent.spawn({ prompt: 'p', description: 'Scan' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'Lint' } as never)
  await end('A1')
  await end('A2')
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^⏸ 1: Scan / })).toBeDefined()
  expect(await ui.find({ text: /^✓ 2: Lint / })).toBeDefined()
  expect(await ui.find({ text: /^  1 running · 1 done$/ })).toBeDefined() // waiting counts as running
  await ui.unmount()

  // A2 is woken again: its next step puts it back to running
  for await (const _ of $.turn.step({ agentId: 'A2', model: 'claude-haiku-5-5' } as never)) void _
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 2: Lint / })).toBeDefined()
})

test('finish shows on the pipeline until another plan starts a new cycle', async ($, on) => {
  mock.clock(on)
  const B = '/r/docs/superpowers/plans/2026-02-01-next.md'
  on('fs.read', (_$, e) => (e.path === SP || e.path === B ? { value: '### Task 1: A\n- [x] a\n' } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  on('skill.prompt', () => ({ text: '' }))

  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:finishing-a-development-branch', text: '' })
  await $.tool.call({ tool: 'Read', file_path: SP } as never) // the same plan again: still finishing
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /●finish$/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Write', file_path: B, content: '' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /●plan ○execute ○review ○finish$/ })).toBeDefined()
})

const sdd = (answer = '') => ({ answer, durationMs: 0, isAborted: false, turnId: 'T', reason: 'answer' }) as never

test('superpowers section: hidden until a superpowers skill, then pipeline and path badge', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  on('turn.complete', () => ({ text: '' }))
  await $.skill.prompt({ skill: 'commit', text: '' })
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /SUPERPOWERS/ })).toBeUndefined()
  await ui.unmount()

  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^⚡ SUPERPOWERS$/ })).toBeDefined()
  expect(await ui.find({ text: /^●brainstorm$/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete(sdd('This looks bounded, so I will present a short design here.'))
  await $.skill.prompt({ skill: 'superpowers:test-driven-development', text: '' })
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^BOUNDED$/ })).toBeDefined()
  expect(await ui.find({ text: /^●brainstorm ○execute ○finish$/ })).toBeDefined()
  expect(await ui.find({ text: /^\+ tdd$/ })).toBeDefined()
  await ui.unmount()

  // past brainstorming a reply no longer moves the badge
  await $.skill.prompt({ skill: 'superpowers:executing-plans', text: '' })
  await $.turn.complete(sdd('a spike would be overkill'))
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^BOUNDED$/ })).toBeDefined()
  expect(await ui.find({ text: /^✓brainstorm ●execute ○finish$/ })).toBeDefined()
})

test('a spec makes the path architectural', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  on('tool.call', () => ({ result: {} }) as never)
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  await $.tool.call({ tool: 'Write', file_path: '/r/docs/superpowers/specs/2026-01-01-x-design.md', content: '' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ARCHITECTURAL$/ })).toBeDefined()
  // too wide for the pane: the done stages fold into ✓…
  expect(await ui.find({ text: /^✓… ●spec ○plan ○execute ○review ○finish$/ })).toBeDefined()
})

test('SDD agents show by role under superpowers, not under agents', async ($, on) => {
  mock.clock(on)
  const ids: Record<string, string> = { 'Implement Task 4: Wire detector': 'I4', 'Review Task 3 (spec + quality)': 'R3', 'Explore auth': 'X1' }
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: ids[e.description] }))
  on('turn.complete', () => ({ text: '' }))
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  for (const description of Object.keys(ids)) await $.agent.spawn({ prompt: 'p', description } as never)
  await $.turn.complete({ ...(sdd('**Task quality:** Needs fixes') as object), agentId: 'R3' } as never)

  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] impl #4 +Haiku 5\.5 00:00$/ })).toBeDefined()
  expect(await ui.find({ text: /^⚠ review #3 +issues 00:00$/ })).toBeDefined()
  // AGENTS lists only the plain one, but counts all three
  expect(await ui.find({ text: /^  2 running · 1 done$/ })).toBeDefined()
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 3: Explore auth / })).toBeDefined()
  expect(await ui.find({ text: /\d: (Implement|Review) Task/ })).toBeUndefined()
})

test('a narrow pane folds the pipeline and skills instead of overflowing', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  for (const skill of ['brainstorming', 'writing-plans', 'using-git-worktrees', 'subagent-driven-development', 'requesting-code-review'])
    await $.skill.prompt({ skill: `superpowers:${skill}`, text: '' })
  const ui = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: 20 }, surface: 'terminal' } as never)
  const W = 30 // the pane never draws narrower
  expect((await ui.find({ text: /^✓… .*●review ○finish$/ }))?.text.length).toBeLessThanOrEqual(W - 4)
  expect((await ui.find({ text: /^… → .*requesting-code-review$/ }))?.text.length).toBeLessThanOrEqual(W - 4)
})

test('a narrow pane keeps the current stage when it folds the pipeline', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  for (const skill of ['writing-plans', 'subagent-driven-development']) await $.skill.prompt({ skill: `superpowers:${skill}`, text: '' })
  const ui = await $.ui.mount({ ...pane, props: { ...pane.props, bodyColumns: 20 }, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^✓… ●execute ○review ○finish$/ })).toBeDefined()
})

test('a running role agent without a task number stays in view after many tasks', async ($, on) => {
  mock.clock(on)
  let k = 0
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `A${++k}` }))
  on('turn.complete', () => ({ text: '' }))
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  for (let n = 1; n <= 3; n++) {
    for (const d of [`Implement Task ${n}: x`, `Review Task ${n} (spec + quality)`]) {
      await $.agent.spawn({ prompt: 'p', description: d } as never)
      await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 'T', agentId: `A${k}`, reason: 'answer' } as never)
    }
  }
  await $.agent.spawn({ prompt: 'p', description: 'Review code changes' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  // working first, then the latest spawned
  expect((await ui.findAll({ text: /^. (review|impl) / })).map(r => r.text.split(/ {2,}/)[0])).toEqual([
    expect.stringMatching(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] review Review code …$/),
    '✓ review #3',
    '✓ impl #3',
    '✓ review #2',
  ])
})

test('agents spawned outside superpowers get no role', async ($, on) => {
  mock.clock(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'A1' }))
  await $.agent.spawn({ prompt: 'p', description: 'Review diff' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 1: Review diff / })).toBeDefined()
})

test('activity shows alongside open tasks', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => ({ result: {} }) as never)
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('a', 'in_progress')] } as never)
  await $.tool.call({ tool: 'Bash', command: 'git push', description: 'Push branch' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^▸ aing$/ })).toBeDefined()
  expect(await ui.find({ text: /^✓ Bash · Push branch$/ })).toBeDefined()
})

test('an agent saved without a status (0.6) reads as running until it ends', () => {
  const old = { n: 1, label: 'Old scan', model: '', startedAt: 0 } as unknown as AgentRun
  expect(withStatus(old).status).toBe('running')
  expect(withStatus({ ...old, endedAt: 5 }).status).toBe('done')
  expect(withStatus({ ...old, status: 'failed', endedAt: 5 }).status).toBe('failed')
})

test('a new activity row takes the next id after the kept rows, never one in use', () => {
  const kept = [{ id: 1, at: 0, label: 'Read · old.ts', status: 'error' as const }]
  const { id, list } = pushActivity(kept, { at: 1, label: 'Bash · New', status: 'running' })
  expect(id).toBe(2)
  expect(list.map(a => a.id)).toEqual([1, 2])
  // capped at the latest 10
  const many = Array.from({ length: 10 }, (_, k) => ({ id: k + 1, at: 0, label: 'x', status: 'ok' as const }))
  expect(pushActivity(many, { at: 1, label: 'y', status: 'running' }).list.map(a => a.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
})

test('a tool call that throws settles its activity row as ✗', async ($, on) => {
  mock.clock(on)
  on('tool.call', () => {
    throw new Error('boom')
  })
  await $.tool.call({ tool: 'Bash', command: 'x', description: 'Explodes' } as never).catch(() => undefined)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^✗ Bash · Explodes$/ })).toBeDefined()
})

test('a review without a task number in its description takes none from its prompt', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'D1' }))
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  await $.agent.spawn({ prompt: 'The plan says: ### Task 3: Parser', description: 'Review spec document' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] review Review spec / })).toBeDefined()
  expect(await ui.find({ text: /review #3/ })).toBeUndefined()
})

test('after finish, a plain review agent lists under AGENTS again', async ($, on) => {
  mock.clock(on)
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'A1' }))
  await $.skill.prompt({ skill: 'superpowers:finishing-a-development-branch', text: '' })
  await $.agent.spawn({ prompt: 'p', description: 'Review diff' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 1: Review diff / })).toBeDefined()
})

test("SDD's whole-branch reviewer reaches the review stage", async ($, on) => {
  mock.clock(on)
  let k = 0
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `A${++k}` }))
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  await $.agent.spawn({ prompt: 'p', description: 'Review Task 1 (spec + quality)' } as never)
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[●⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]execute$/ })).toBeDefined() // a per-task review is still execute (spinning: agents run)
  await ui.unmount()
  await $.agent.spawn({ prompt: 'p', description: 'Review code changes' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^✓execute [●⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]review$/ })).toBeDefined()
})

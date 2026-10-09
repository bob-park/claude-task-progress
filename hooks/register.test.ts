import { expect, mock, test } from 'claude-code/testing'

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
  expect(await ui.find({ text: /^✓ 모두 완료$/ })).toBeDefined()
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

  // todos win over the plan
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('Only', 'pending')] })
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 0\/1$/ })).toBeDefined()
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

test('with no todos or plan, a running turn shows what Claude is doing', async ($, on) => {
  mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }) as never)

  await $.turn.start({ text: 'go', turnId: 'T1' })
  await $.tool.call({ tool: 'Bash', command: 'bun test', description: 'Run tests' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Bash · Run tests$/ })).toBeDefined()
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
  await end('A1')
  await clock.advance(5_000)

  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^AGENTS$/ })).toBeDefined()
  expect(await ui.find({ text: /^✓ 1: Explore auth -+ Haiku 5\.5 01:23$/ })).toBeDefined()
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 2: Review diff -+ Haiku 5\.5 00:47$/ })).toBeDefined()
  await ui.unmount()

  // a new prompt clears the finished ones
  await $.turn.start({ text: 'go', turnId: 'T2' })
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /Explore auth/ })).toBeUndefined()
  expect(await ui.find({ text: /2: Review diff/ })).toBeDefined()
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
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 1: Scan / })).toBeDefined()
  expect(await ui.find({ text: /^✓ 2: Lint / })).toBeDefined()
  await ui.unmount()

  // A2 is woken again: its next step puts it back to running
  for await (const _ of $.turn.step({ agentId: 'A2', model: 'claude-haiku-5-5' } as never)) void _
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 2: Lint / })).toBeDefined()
})

test('finishing-a-development-branch shows under the tasks until another plan', async ($, on) => {
  mock.clock(on)
  const B = '/r/docs/superpowers/plans/2026-02-01-next.md'
  on('fs.read', (_$, e) => (e.path === SP || e.path === B ? { value: '### Task 1: A\n- [x] a\n' } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  on('skill.prompt', () => ({ text: '' }))

  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:finishing-a-development-branch', text: '' })
  await $.tool.call({ tool: 'Read', file_path: SP } as never)
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^⎇ finishing-a-development-branch$/ })).toBeDefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Write', file_path: B, content: '' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /finishing-a-development-branch/ })).toBeUndefined()
})

test('once every task is done, a running turn shows what Claude is doing', async ($, on) => {
  mock.clock(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }) as never)
  await $.tool.call({ tool: 'TodoWrite', todos: [todo('a', 'completed')] } as never)
  await $.turn.start({ text: 'go', turnId: 'T1' })
  await $.tool.call({ tool: 'Bash', command: 'git push', description: 'Push branch' } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^✓ 모두 완료$/ })).toBeDefined()
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Bash · Push branch$/ })).toBeDefined()
})

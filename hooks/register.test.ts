import { expect, test } from 'claude-code/testing'

const pane = {
  plugin: 'task-progress',
  component: 'Pane' as const,
  requestId: 'task-progress',
  props: { title: 'Task Progress', isFocused: false, bodyColumns: 46, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 20 }, view: {} },
}

const todo = (content: string, status: 'pending' | 'in_progress' | 'completed') => ({ content, status, activeForm: `${content}ing` })

test('main panel shows idle, then working once a turn starts', async ($, on) => {
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /· main$/ })).toBeDefined()
  expect(await ui.find({ text: /○ idle/ })).toBeDefined()
  expect(await ui.find({ text: /TASKS/ })).toBeUndefined() // no tasks yet: no tasks panel
  await ui.unmount()

  await $.turn.start({ text: 'go', turnId: 'T1' })
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /● working/ })).toBeDefined()
})

test('tasks panel shows done/total next to the bar and the current step below', async ($, on) => {
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
    if (e.path === PM) return { value: '# Plan\n- [x] Read code\n- [ ] Edit file\n' }
    return { deny: `ENOENT: ${e.path}` }
  })
  on('tool.call', (_$, e) => answer(e))

  const ran = await $.tool.call({ tool: 'ExitPlanMode' } as never)
  expect(ran.context).toEqual([`Mark each step done by ticking it (- [x]) in ${PM} as you finish it.`])

  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 1\/2$/ })).toBeDefined()
  expect(await ui.find({ text: /^▸ Edit file$/ })).toBeDefined()
})

test('reading a plan written in an earlier session makes it the active plan', async ($, on) => {
  on('fs.read', (_$, e) => (e.path === SP ? { value: '### Task 1: A\n- [x] a\n### Task 2: B\n- [ ] a\n' } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', (_$, e) => answer(e))

  await $.tool.call({ tool: 'Read', file_path: SP } as never)
  const ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 1\/2$/ })).toBeDefined()
})

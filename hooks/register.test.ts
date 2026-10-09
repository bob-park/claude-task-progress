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

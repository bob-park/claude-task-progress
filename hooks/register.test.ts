import { expect, test } from 'claude-code/testing'

test('shows done/total next to the bar from TodoWrite', async ($, on) => {
  // stands for the engine answering the tool
  on('tool.call', () => ({ result: { oldTodos: [], newTodos: [] } }) as never)

  await $.tool.call({
    tool: 'TodoWrite',
    todos: [
      { content: 'a', status: 'completed', activeForm: 'a' },
      { content: 'b', status: 'in_progress', activeForm: 'b' },
      { content: 'c', status: 'pending', activeForm: 'c' },
    ],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'task-progress',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10 },
    } as never)
    expect((await ui.find({ text: /^ {2}1\/3$/ }))?.props.color).toBe('blue')
    expect(await ui.find({ text: /^ · 33%$/ })).toBeDefined()
    // in_progress task shows as a yellow segment right after the done segment
    expect((await ui.find({ text: /^▓+$/ }))?.props.color).toBe('yellow')
  }
})

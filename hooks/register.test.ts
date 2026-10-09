import { expect, test } from 'claude-code/testing'

test('shows done / total from TodoWrite', async ($, on) => {
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
    expect((await ui.find({ text: /^1$/ }))?.props.color).toBe("blue")
    expect((await ui.find({ text: /^ \/ 3$/ }))?.props.color).toBe("white")
    expect(await ui.find({ text: / 33%$/ })).toBeDefined()
  }
})

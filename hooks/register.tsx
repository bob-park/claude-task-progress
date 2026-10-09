import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { TaskStatus } from '../types'

const tasks = atom({ plugin: 'task-progress', key: 'tasks' } as const, {} as Record<string, TaskStatus>)

const BAR_WIDTH = 30

export const register: Register = on => {
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran

    if (e.tool === 'TodoWrite') {
      // TodoWrite replaces the whole list
      const list = Object.fromEntries(e.todos.map((t, i) => [`todo:${i}`, t.status]))
      await update($, tasks, () => list)
    } else if (e.tool === 'TaskCreate' && ran.result && 'task' in ran.result && ran.result.task) {
      const id = ran.result.task.id
      await update($, tasks, all => ({ ...all, [id]: 'pending' }))
    } else if (e.tool === 'TaskUpdate' && e.status) {
      const { taskId, status } = e
      await update($, tasks, all => {
        const { [taskId]: _, ...rest } = all
        return status === 'deleted' ? rest : { ...rest, [taskId]: status }
      })
    }

    return ran
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const statuses = Object.values(await read($, tasks))
    if (e.props.hasSurvey || statuses.length === 0) return next(e)

    const total = statuses.length
    const done = statuses.filter(s => s === 'completed').length
    const filled = Math.round((done / total) * BAR_WIDTH)
    const percent = Math.round((done / total) * 100)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="row" justifyContent="space-between">
        <Text>
          <Text color="green">{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(BAR_WIDTH - filled)}</Text>
          {` ${percent}%`}
        </Text>
        <Text bold>
          <Text color="blue">{`${done}`}</Text>
          <Text color="white">{` / ${total}`}</Text>
        </Text>
      </Box>
    )
  })
}

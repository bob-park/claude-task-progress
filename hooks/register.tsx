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
    const active = statuses.filter(s => s === 'in_progress').length
    const filled = Math.round((done / total) * BAR_WIDTH)
    const activeCells = Math.round(((done + active) / total) * BAR_WIDTH) - filled
    const percent = Math.round((done / total) * 100)
    const allDone = done === total
    const { Box, Text } = $.ui.resolve(e)

    // count sits right after the bar so the eye doesn't travel across the terminal
    return (
      <Box flexDirection="row">
        <Text>
          <Text bold color={allDone ? 'green' : undefined}>{allDone ? '✓ Tasks ' : 'Tasks '}</Text>
          <Text color="green">{'█'.repeat(filled)}</Text>
          <Text color="yellow">{'▓'.repeat(activeCells)}</Text>
          <Text dimColor>{'░'.repeat(BAR_WIDTH - filled - activeCells)}</Text>
          <Text bold color="blue">{`  ${done}/${total}`}</Text>
          <Text dimColor>{` · ${percent}%`}</Text>
        </Text>
      </Box>
    )
  })
}

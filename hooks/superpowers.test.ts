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
  // only the first `droppable` parts may fold: the current stage and later ones always stay
  expect(fitTail(['✓aa', '✓bb', '●cccc', '○dddd'], ' ', 10, '✓…', 2)).toBe('✓… ●cccc ○dddd')
})

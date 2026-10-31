import { expect, test } from 'claude-code/testing'

import type { Sp } from '../types'
import { addExtra, EMPTY_SP, extraOf, fitTail, pathFrom, pipeline, reach, roleOf, sizeUp, skillName, stageOf, stageOfRun, stageTimes, taskNOf, verdictOf, withAt } from './superpowers'

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
  let sp = reach(EMPTY_SP, 'brainstorm', 1)
  expect(sp).toEqual({ stages: ['brainstorm'], current: 'brainstorm', extras: [], doneAt: null, at: { brainstorm: 1 } })
  sp = reach(sp, 'execute', 2)
  sp = reach(sp, 'plan', 3) // a late plan read
  expect(sp.current).toBe('execute')
  sp = reach(addExtra(sp, 'tdd'), 'finish', 4)
  expect(sp.current).toBe('finish')
  sp = reach(sp, 'brainstorm', 5)
  expect(sp).toEqual({ stages: ['brainstorm'], current: 'brainstorm', extras: [], doneAt: null, at: { brainstorm: 5 } })
})

test('stageTimes: each stage until the next one starts, current until now', () => {
  let sp = reach(EMPTY_SP, 'brainstorm', 0)
  sp = reach(sp, 'spec', 60_000)
  sp = reach(sp, 'plan', 90_000)
  sp = reach(sp, 'execute', 150_000)
  sp = reach(sp, 'worktree', 155_000) // SDD setup, out of order
  expect(stageTimes(sp, 300_000)).toEqual({ brainstorm: 60_000, spec: 30_000, plan: 60_000, execute: 150_000 })
  expect(stageTimes(reach(sp, 'finish', 400_000), 900_000).finish).toBeUndefined()
  expect(reach(reach(sp, 'finish', 400_000), 'brainstorm', 500_000).at).toEqual({ brainstorm: 500_000 })
  expect(reach(sp, 'spec', 999_999).at.spec).toBe(60_000) // first reach wins
})

test('sp saved without at reads as no times', () => {
  const old = { stages: ['brainstorm'], current: 'brainstorm', extras: [], doneAt: null } as unknown as Sp
  expect(stageTimes(withAt(old), 10)).toEqual({})
})

test('addExtra keeps each extra once', () => {
  expect(addExtra(addExtra(EMPTY_SP, 'tdd'), 'tdd').extras).toEqual(['tdd'])
})

test('7.0.1 sizing words, any case, inside Korean text', () => {
  expect(pathFrom('This is a small change, so I will describe it here.')).toBe('small')
  expect(pathFrom('규모는 작은 변경으로 보고 짧은 문서를 쓰겠습니다')).toBe('small')
  expect(pathFrom('This is a project, so a full design doc.')).toBe('project')
  expect(pathFrom('규모는 "프로젝트"로 보고 전체 문서를 쓰겠습니다')).toBeUndefined()
  expect(pathFrom('이건 spike 로 먼저 확인해 볼게요')).toBe('spike')
  expect(pathFrom('**분류: Architectural** — spec 경로로 가겠습니다')).toBe('project')
  expect(pathFrom('nothing here, unbounded')).toBeUndefined()
})

test('a project in ordinary English is not a size', () => {
  expect(pathFrom("I'd call this a small change rather than a project.")).toBeUndefined() // names both: ambiguous
  expect(pathFrom('This adds a project-wide setting')).toBeUndefined()
  expect(pathFrom('In a project like this one, tests live in hooks/')).toBe('project') // still reads as a size
})

test('a spec or plan puts a spike on the plan workflow', () => {
  let sp = reach({ ...EMPTY_SP, path: 'spike' }, 'brainstorm', 0)
  sp = reach(sp, 'spec', 1)
  expect(sp.path).toBeUndefined()
  expect(pipeline(sp).map(s => s.stage)).toEqual(['brainstorm', 'spec', 'plan', 'execute', 'review', 'finish'])
})

test('size only steps up', () => {
  expect(sizeUp(undefined, 'spike')).toBe('spike')
  expect(sizeUp('spike', 'small')).toBe('small')
  expect(sizeUp('small', 'project')).toBe('project')
  expect(sizeUp('project', 'spike')).toBe('project')
  expect(sizeUp('small', 'spike')).toBe('small')
})

test('pipeline: small and project draw the whole line, spike only what it reached', () => {
  const line = (sp: Partial<Sp>) => pipeline({ ...EMPTY_SP, ...sp }).map(s => `${s.state}:${s.stage}`)
  const full = ['done:brainstorm', 'done:spec', 'done:plan', 'current:execute', 'todo:review', 'todo:finish']
  expect(line({ path: 'small', stages: ['brainstorm', 'plan', 'execute'], current: 'execute' })).toEqual(full)
  expect(line({ path: 'project', stages: ['brainstorm', 'plan', 'execute'], current: 'execute' })).toEqual(full)
  expect(line({ stages: ['brainstorm', 'spec'], current: 'spec' })).toHaveLength(6) // unsized, spec written
  expect(line({ stages: ['plan'], current: 'plan' })).toHaveLength(6) // started at writing-plans
  expect(line({ stages: ['brainstorm'], current: 'brainstorm' })).toEqual(['current:brainstorm'])
  expect(line({ path: 'spike', stages: ['brainstorm'], current: 'brainstorm' })).toEqual(['current:brainstorm'])
  expect(line({ path: 'project', stages: ['worktree'], current: 'worktree' }).map(s => s.slice(s.indexOf(':') + 1))).toContain('worktree')
})

test('SDD dispatches get a role and task number; reports a verdict', () => {
  expect(roleOf('Implement Task 4: Wire detector')).toBe('impl')
  expect(roleOf('Review Task 3 (spec + quality)')).toBe('review')
  expect(roleOf('Re-review Task 3 fix round 1')).toBe('review')
  expect(roleOf('Review spec document')).toBe('review')
  expect(roleOf('Builder check on the design doc')).toBe('review') // 7.0.0 brainstorming
  expect(roleOf('Explore auth')).toBeUndefined()
  expect(roleOf('Fix Task 3: address review findings')).toBe('impl')
  expect(roleOf('Fix final review findings')).toBe('impl')
  expect(taskNOf('review task 3 (spec + quality)')).toBe('3')
  expect(taskNOf('Review Task 12 (spec + quality)')).toBe('12')
  expect(taskNOf('Implement Task 3b: AI worker')).toBe('3b') // a task added mid-run
  expect(taskNOf('Review Task 3B (spec + quality)')).toBe('3b')
  expect(taskNOf('Explore auth')).toBeUndefined()
  expect(verdictOf('**Task quality:** Approved')).toBe('ok')
  expect(verdictOf('✅ Spec compliant\n**Task quality:** Needs fixes')).toBe('issues')
  expect(verdictOf('Finding 1: NOT ADDRESSED')).toBe('issues')
  expect(verdictOf('nothing important left')).toBe('ok') // a builder check with no questions
  expect(verdictOf('done')).toBeUndefined()
})

test('fitTail keeps the latest parts behind a lead', () => {
  expect(fitTail(['a', 'b', 'c'], ' → ', 20, '…')).toBe('a → b → c')
  expect(fitTail(['alpha', 'beta', 'gamma'], ' → ', 14, '…')).toBe('… → gamma')
  expect(fitTail(['✓brainstorm', '✓plan', '●execute'], ' ', 17, '✓…')).toBe('✓… ✓plan ●execute')
  // only the first `droppable` parts may fold: the current stage and later ones always stay
  expect(fitTail(['✓aa', '✓bb', '●cccc', '○dddd'], ' ', 10, '✓…', 2)).toBe('✓… ●cccc ○dddd')
})

test('an agent belongs to the latest stage started by its start, a tie to the later stage', () => {
  const sp: Sp = { ...EMPTY_SP, stages: ['brainstorm', 'spec', 'plan', 'execute', 'review'], current: 'review', at: { brainstorm: 10, spec: 20, plan: 30, execute: 30, review: 50 } }
  expect(stageOfRun(sp, 15)).toBe('brainstorm')
  expect(stageOfRun(sp, 30)).toBe('execute') // plan and execute at the same ms
  expect(stageOfRun(sp, 49)).toBe('execute')
  expect(stageOfRun(sp, 60)).toBe('review')
  expect(stageOfRun(sp, 5)).toBeUndefined() // before this cycle
  expect(stageOfRun({ ...sp, at: {} }, 5)).toBe('review') // saved before stage times: the current stage
})

test('a stage reached out of order (SDD sets up a worktree) never takes the agents of the stage after it', () => {
  let sp = reach(reach(EMPTY_SP, 'brainstorm', 10), 'execute', 20)
  sp = reach(sp, 'worktree', 30)
  expect(stageOfRun(sp, 40)).toBe('execute')
})

import { expect, test } from 'claude-code/testing'

import { isPlanPath, keepCompleted, ledgerOwns, ledgerPath, parsePlan } from './plan'

const SP = '/r/docs/superpowers/plans/2026-01-01-x.md'
const spPlan = [
  '# X Plan',
  '',
  'Steps use checkbox (`- [ ]`) syntax.',
  '```markdown',
  '### Task 9: Template only',
  '- [ ] **Step 1: not real**',
  '```',
  '### Task 1: Parser',
  '- [x] **Step 1: Write test**',
  '- [x] **Step 2: Implement**',
  '### Task 2: Wiring',
  '- [x] **Step 1: Write test**',
  '- [ ] **Step 2: Implement**',
  '### Task 3: **Docs**',
  '- [ ] **Step 1: README**',
].join('\n')

test('plan paths and ledger path', () => {
  expect(isPlanPath(SP)).toBe(true)
  expect(isPlanPath('/Users/a/.claude/plans/happy-cat.md')).toBe(true)
  expect(isPlanPath('/r/docs/notes.md')).toBe(false)
  expect(ledgerPath(SP)).toBe('/r/.superpowers/sdd/2026-01-01-x/progress.md')
  expect(ledgerPath('/Users/a/.claude/plans/happy-cat.md')).toBeNull()
  expect(ledgerOwns(SP, '# SDD ledger — plan: docs/superpowers/plans/2026-01-01-x.md\n')).toBe(true)
  expect(ledgerOwns(SP, '# SDD ledger — plan: docs/superpowers/plans/other.md\n')).toBe(false)
})

test('superpowers plan: one task per heading, checkboxes complete a task, code fences ignored', () => {
  expect(parsePlan(spPlan)).toEqual([
    { status: 'completed', label: 'Parser', n: '1' },
    { status: 'in_progress', label: 'Wiring', n: '2' },
    { status: 'pending', label: 'Docs', n: '3' },
  ])
})

test('superpowers plan: ledger completion lines complete tasks', () => {
  const plain = '### Task 1: A\n- [ ] s\n### Task 2: B\n- [ ] s\n### Task 3: C\n- [ ] s'
  expect(parsePlan(plain)).toEqual([
    { status: 'pending', label: 'A', n: '1' },
    { status: 'pending', label: 'B', n: '2' },
    { status: 'pending', label: 'C', n: '3' },
  ])
  const ledger = '# SDD ledger — plan: x\nTask 1: complete (commits a..b, tests: t → pass)\n'
  expect(parsePlan(plain, ledger)).toEqual([
    { status: 'completed', label: 'A', n: '1' },
    { status: 'in_progress', label: 'B', n: '2' },
    { status: 'pending', label: 'C', n: '3' },
  ])
})

test('plan-mode plan: one task per checkbox, CRLF ok', () => {
  expect(parsePlan('# Plan\r\n- [x] Read code\r\n  - [ ] Edit file\r\n- [ ] Run tests\r\n')).toEqual([
    { status: 'completed', label: 'Read code' },
    { status: 'in_progress', label: 'Edit file' },
    { status: 'pending', label: 'Run tests' },
  ])
})

test('plan-mode plan without checkboxes falls back to numbered items, else nothing', () => {
  expect(parsePlan('# Plan\n1. **Read** code\n   1. nested is skipped\n2. Edit')).toEqual([
    { status: 'pending', label: 'Read code', n: '1' },
    { status: 'pending', label: 'Edit', n: '2' },
  ])
  expect(parsePlan('# Plan\nJust prose.')).toEqual([])
})

test('numbered items ticked with [x] show progress', () => {
  expect(parsePlan('# Plan\n1. [x] Read code\n2. [ ] **Edit**\n3. Run tests')).toEqual([
    { status: 'completed', label: 'Read code', n: '1' },
    { status: 'in_progress', label: 'Edit', n: '2' },
    { status: 'pending', label: 'Run tests', n: '3' },
  ])
})

test('keepCompleted: a task done before stays done when the ledger is gone', () => {
  const before = parsePlan('### Task 1: A\n- [ ] s\n### Task 2: B\n- [ ] s\n### Task 3: C\n- [ ] s', 'Task 1: complete\nTask 2: complete\n')
  const after = parsePlan('### Task 1: A\n- [ ] s\n### Task 2: B\n- [ ] s\n### Task 3: C\n- [ ] s')
  expect(keepCompleted(before, after)).toEqual([
    { status: 'completed', label: 'A', n: '1' },
    { status: 'completed', label: 'B', n: '2' },
    { status: 'in_progress', label: 'C', n: '3' },
  ])
})

test('7.0.1 ledger: bulleted lines, dispatched marks current, lettered tasks', () => {
  const plan = '### Task 1: A\n- [ ] s\n### Task 2: B\n- [ ] s\n### Task 3: C\n- [ ] s\n### Task 3b: Worker\n- [ ] s\n### Task 4: D\n- [ ] s\n### Task 10: J\n- [ ] s'
  const ledger = [
    '# SDD ledger — plan: x',
    '## Progress',
    '- Task 1: dispatched (base dd8d49c)',
    '- Task 1: minor (deferred): unused import',
    '- Task 1: complete (commits a..b, review clean)',
    '* Task 2: complete (commits b..c)',
    '> **Task 3: complete** (commits c..d)',
    '- Task 3b: dispatched (base f4171f5, opus)',
    '- Task 4: implementer DONE_WITH_CONCERNS',
  ].join('\n')
  expect(parsePlan(plan, ledger).map(t => `${t.n} ${t.status}`)).toEqual(['1 completed', '2 completed', '3 completed', '3b in_progress', '4 pending', '10 pending'])
})

test('7.0.1 ledger: a dispatched task without completions is current; complete never leaks to 10 or 1b', () => {
  const plan = '### Task 1: A\n- [ ] s\n### Task 1b: A2\n- [ ] s\n### Task 10: J\n- [ ] s'
  expect(parsePlan(plan, '- Task 10: dispatched').map(t => t.status)).toEqual(['pending', 'pending', 'in_progress'])
  expect(parsePlan(plan, '- Task 1: complete').map(t => t.status)).toEqual(['completed', 'in_progress', 'pending'])
})

test('lettered task keeps its own steps', () => {
  expect(parsePlan('### Task 3: C\n- [x] a\n### Task 3b: W\n- [ ] b').map(t => `${t.n} ${t.status}`)).toEqual(['3 completed', '3b in_progress'])
})

test('keepCompleted keeps the dispatched task current: a mid-run task at the end, parallel dispatch', () => {
  const plan = '### Task 1: A\n- [ ] s\n### Task 2: B\n- [ ] s\n### Task 3: C\n- [ ] s\n### Task 4: D\n- [ ] s\n### Task 3b: W\n- [ ] s'
  const late = parsePlan(plan, '- Task 1: complete\n- Task 2: complete\n- Task 3: complete\n- Task 3b: dispatched')
  expect(keepCompleted(late, late).map(t => `${t.n} ${t.status}`)).toEqual(['1 completed', '2 completed', '3 completed', '4 pending', '3b in_progress'])
  const parallel = parsePlan(plan, '- Task 1: complete\n- Task 3: dispatched\n- Task 4: dispatched')
  expect(keepCompleted(parallel, parallel).map(t => t.status)).toEqual(['completed', 'pending', 'in_progress', 'in_progress', 'pending'])
  // a task done before the ledger went away stays done, even if it was the dispatched one
  const gone = parsePlan(plan, '- Task 3b: dispatched')
  const before = parsePlan(plan, '- Task 1: complete\n- Task 2: complete\n- Task 3: complete\n- Task 4: complete\n- Task 3b: complete')
  expect(keepCompleted(before, gone).every(t => t.status === 'completed')).toBe(true)
})

test('a ledger note that only starts with complete is not a completion', () => {
  const plan = '### Task 1: A\n- [ ] s\n### Task 2: B\n- [ ] s'
  expect(parsePlan(plan, '- Task 2: complete rewrite of X requested by reviewer').map(t => t.status)).toEqual(['pending', 'pending'])
  expect(parsePlan(plan, '- Task 1: complete\n- **Task 2: complete**').map(t => t.status)).toEqual(['completed', 'completed'])
  expect(parsePlan(plan, 'Task 1: complete (commits a..b, tests: t → ok)\nTask 2: complete.').map(t => t.status)).toEqual(['completed', 'completed'])
})

test('upper-case task suffixes read as lower-case everywhere', () => {
  const plan = '### Task 3: C\n- [x] a\n### Task 3B: W\n- [ ] b\n### Task 4: D\n- [ ] c'
  expect(parsePlan(plan).map(t => `${t.n} ${t.status}`)).toEqual(['3 completed', '3b in_progress', '4 pending'])
  expect(parsePlan(plan, '- Task 4: dispatched\n- Task 3B: dispatched').map(t => `${t.n} ${t.status}`)).toEqual(['3 completed', '3b in_progress', '4 in_progress'])
})

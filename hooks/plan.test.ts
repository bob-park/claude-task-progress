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

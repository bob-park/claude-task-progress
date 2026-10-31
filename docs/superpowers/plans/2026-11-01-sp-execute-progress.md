# Execute Progress (7.0.1 ledgers) + Shimmering Current Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The SUPERPOWERS execute bar counts 7.0.1 ledgers as written, and the current-task line shimmers and ends with the live phase of its running agent.

**Architecture:** `hooks/plan.ts` `parsePlan` learns bulleted ledger lines, `dispatched` lines and lettered task numbers. `hooks/view.tsx` `spPanel` draws its current-task line with a per-character shimmer and a phase taken from the running role agent whose `taskN` matches.

**Tech Stack:** TypeScript Claude Code mod (`claude-code` engine API, Ink-like `Box`/`Text`), tests via `claude-code/testing`, run with `claude plugin test .`.

**Spec:** `docs/superpowers/specs/2026-11-01-sp-execute-progress-design.md`

## Global Constraints

- The bar keeps its block look (`███▓▓░░`) and sweep; no other panel changes. TASKS keeps its current-line look.
- Never show a task done or current that isn't; stage logic is untouched.
- `roleOf` stays as is (fix agents keep the `impl` role).
- Version bump to `0.8.1` (patch only, the user's decision) in `.claude-plugin/plugin.json`.
- Commit messages in Korean, `feat:`/`fix:` prefix, as the repo does.

## Review Focus

- A ledger line that merely mentions a task (`- Task 1: minor (deferred): …`, `- Task 3: implementer DONE_WITH_CONCERNS`) must not mark it done or started.
- A ledger line `Task 1: complete` must not complete `Task 10` or `Task 1b` (whole-token match).
- A dispatched task that is already complete is completed, not in_progress.
- A finished role agent for the current task (status `done`) shows no phase.
- When the current task is `Task 3b`, an agent `Implement Task 3: …` (taskN `3`) is not its phase.

---

### Task 1: Ledger parsing for 7.0.1

**Files:**
- Modify: `hooks/plan.ts` (`TASK_HEADING`, the ledger match and `started` inside `parsePlan`)
- Test: `hooks/plan.test.ts`

**Interfaces:**
- Produces: `parsePlan(text, ledger?)` unchanged signature; tasks may now have `n` like `'3b'`; a ledger-dispatched, not-complete task gets `status: 'in_progress'`.

- [ ] **Step 1: Write the failing tests** in `hooks/plan.test.ts`

```ts
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
  expect(parsePlan(plan, ledger).map(t => `${t.n} ${t.status}`)).toEqual([
    '1 completed', '2 completed', '3 completed', '3b in_progress', '4 pending', '10 pending',
  ])
})

test('7.0.1 ledger: a dispatched task without completions is current; complete never leaks to 10 or 1b', () => {
  const plan = '### Task 1: A\n- [ ] s\n### Task 1b: A2\n- [ ] s\n### Task 10: J\n- [ ] s'
  expect(parsePlan(plan, '- Task 10: dispatched').map(t => t.status)).toEqual(['pending', 'pending', 'in_progress'])
  expect(parsePlan(plan, '- Task 1: complete').map(t => t.status)).toEqual(['completed', 'in_progress', 'pending'])
})

test('lettered task keeps its own steps', () => {
  expect(parsePlan('### Task 3: C\n- [x] a\n### Task 3b: W\n- [ ] b').map(t => `${t.n} ${t.status}`)).toEqual(['3 completed', '3b in_progress'])
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `claude plugin test .`
Expected: the three new tests FAIL (all `pending` / `3b` missing); every other test passes.

- [ ] **Step 3: Implement in `hooks/plan.ts`**

- `TASK_HEADING`: task number `(\d+[a-z]?)`.
- Ledger line, multiline: `^[\s>*+-]*(?:\*\*)?Task\s+(\d+[a-z]?):\s*(complete|dispatched)\b` — `complete` adds to the done set, `dispatched` to a started set.
- When any task is dispatched and not done, exactly those tasks are `in_progress` (several at once for parallel dispatch) and every other open task is `pending`. Otherwise `withCurrent`'s first-open rule applies as today.

- [ ] **Step 4: Run to verify they pass**

Run: `claude plugin test .`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add hooks/plan.ts hooks/plan.test.ts
git commit -m "fix: 7.0.1 ledger의 목록형 완료 줄, dispatched, 3b 같은 task 번호를 진행률에 반영"
```

### Task 2: Shimmering current-task line with live phase

**Files:**
- Modify: `hooks/view.tsx` (`planNow` gains an optional phase + shimmer used only by `spPanel`; `spPanel` computes the phase)
- Modify: `.claude-plugin/plugin.json` (`"version": "0.8.1"`), `README.md` (the "on the execute row" bullet: the current task shimmers and shows its phase, e.g. `⠹ #4 Add verdict parser   review 00:41`)
- Test: `hooks/register.test.ts`, plus a pure-helper test in the same file

**Interfaces:**
- Consumes: Task 1's `parsePlan` statuses (`in_progress` for the running task); `AgentRun` fields `role`, `taskN`, `label`, `status`, `startedAt`.
- Produces (exported from `hooks/view.tsx`):
  - `phaseOf(run: AgentRun): string` — `'fix'` when `label` starts with `Fix` (case-insensitive), `'re-review'` when it starts with `Re-review`, else `run.role`.
  - `shimmer(text: string, f: number): Array<{ text: string; tone: 'hi' | 'mid' | 'base' }>` — highlight index `f % (text.length + GAP) - GAP / 2`; `hi` at the index, `mid` within ±2, `base` elsewhere; adjacent cells of the same tone merge into one segment. `GAP = 8`.

- [ ] **Step 1: Write the failing tests** in `hooks/register.test.ts`

```ts
test('shimmer: the bright cell walks across the text and merges runs', () => {
  const tones = (f: number) => shimmer('abcdefghij', f).map(s => `${s.tone}:${s.text}`)
  expect(tones(4)).toEqual(['hi:a', 'mid:bc', 'base:defghij'])
  expect(tones(8)).toEqual(['base:ab', 'mid:cd', 'hi:e', 'mid:fg', 'base:hij'])
  expect(tones(0)).toEqual(['base:abcdefghij']) // inside the gap
  expect(shimmer('abcdefghij', 8).map(s => s.text).join('')).toBe('abcdefghij')
})

test('phaseOf reads fix and re-review from the label', () => {
  const run = (label: string, role: 'impl' | 'review') => ({ n: 1, label, model: '', startedAt: 0, status: 'running' as const, role })
  expect(phaseOf(run('Implement Task 2: x', 'impl'))).toBe('impl')
  expect(phaseOf(run('Fix Task 2 review findings', 'impl'))).toBe('fix')
  expect(phaseOf(run('Review Task 2 (spec + quality)', 'review'))).toBe('review')
  expect(phaseOf(run('Re-review Task 2 fixes', 'review'))).toBe('re-review')
})

test('the current task line ends with the phase of its running agent', async ($, on) => {
  mock.clock(on)
  const files: Record<string, string> = {
    [SP]: '### Task 1: A\n- [ ] a\n### Task 2: Wire it\n- [ ] b\n### Task 3: C\n- [ ] c\n',
    [LEDGER]: '# SDD ledger — plan: docs/superpowers/plans/2026-01-01-x.md\n- Task 1: complete (x)\n- Task 2: dispatched\n',
  }
  on('fs.read', (_$, e) => (e.path in files ? { value: files[e.path]! } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  on('skill.prompt', () => ({ text: '' }))
  const ids: Record<string, string> = { 'Implement Task 2: Wire it': 'I2', 'Review Task 2 (spec + quality)': 'R2' }
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-5-5', agentId: ids[e.description] }))
  on('turn.complete', () => ({ text: '' }))
  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })

  let ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^ 1\/3$/ })).toBeDefined()
  expect(await ui.find({ text: /^▸ #2 Wire it$/ })).toBeDefined() // idle: no shimmer spinner, no phase yet
  await ui.unmount()

  await $.agent.spawn({ prompt: 'p', description: 'Implement Task 2: Wire it' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] #2 Wire it +impl 00:00$/ })).toBeDefined()
  await ui.unmount()

  await $.turn.complete({ agentId: 'I2', answer: 'DONE', reason: 'end' } as never)
  await $.agent.spawn({ prompt: 'p', description: 'Review Task 2 (spec + quality)' } as never)
  ui = await $.ui.mount({ ...pane, surface: 'terminal' } as never)
  expect(await ui.find({ text: /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] #2 Wire it +review 00:00$/ })).toBeDefined()
})
```

Import `phaseOf, shimmer` from `./view`. If the `turn.complete` call shape differs from what other tests in this file use, copy theirs (see the `sdd(...)` helper near line 389).

- [ ] **Step 2: Run to verify they fail**

Run: `claude plugin test .`
Expected: the three new tests FAIL (`phaseOf`/`shimmer` not exported; no phase on the line).

- [ ] **Step 3: Implement in `hooks/view.tsx`**

- Export `phaseOf` and `shimmer` as specified above.
- In `spPanel`, for the execute row's nested `now` line: when exactly one task is `in_progress`, find the newest (`n` highest) role agent with `status` `running` or `waiting` and `taskN === task.n`. If found, the right column is `` `${phaseOf(run)} ${mmss(v.now - run.startedAt)}` ``, laid out with `lineUp(icon, numbered(task), right, inner.W, ' ')` so the phase sits on the right edge; otherwise the line is `` `${icon} ${numbered(task)}` `` as today.
- Icon is `v.spin` while `v.busy`, else `▸`.
- While `v.busy`, draw that line as one outer `Text` (`wrap="truncate"`) whose children are `shimmer(line, v.f)` segments: `hi` → color `#fff3c4` bold, `mid` → `#f0cf6e`, `base` → `yellow`. Idle: a plain yellow `Text`.
- The completed / `○ 다음` branches of `planNow` and TASKS' `progressLines` are unchanged.

- [ ] **Step 4: Run to verify they pass**

Run: `claude plugin test .`
Expected: all tests PASS. Also `npx -y -p typescript@5.6.3 tsc --noEmit -p .` exits 0.

- [ ] **Step 5: Version and README, then commit**

Set `.claude-plugin/plugin.json` `"version": "0.8.1"`; update the README execute-row bullet as listed under Files.

```bash
git add hooks/view.tsx hooks/register.test.ts .claude-plugin/plugin.json README.md
git commit -m "feat: 진행 중인 task 줄 반짝임과 실시간 단계 표시, 버전 0.8.1"
```

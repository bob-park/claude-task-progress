# Superpowers 7.0.1 Tracking + Timeline Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the SUPERPOWERS stage and size detection for superpowers 7.0.1, and redraw the section as a vertical timeline with a time for each stage.

**Architecture:**
- Detection rules live in pure helpers in `hooks/superpowers.ts`; the event wiring is in `hooks/register.tsx`.
- `Sp` gains an `at` map that records when each stage started.
- `spPanel` in `hooks/view.tsx` is rewritten as one row per stage, with the plan bar and role agents nested under the current stage.

**Tech Stack:** TypeScript and TSX in a Claude Code plugin (`claude-code` hooks API, Ink-like `Box`/`Text`). Tests run with `claude plugin test .` (`claude-code/testing`).

**Spec:** `docs/superpowers/specs/2026-10-29-sp-timeline-design.md`

## Global Constraints

- Work on branch `feat/sp-timeline`.
- A stage never moves backwards. A stage never moves ahead of the real workflow (spec anti-goal).
- Size only moves up, in this order: `spike` → `small` → `project`. Sizing words count only while `current === 'brainstorm'`.
- Sizing words:
  - `small change` → small
  - `작은 변경` → small
  - `a project` → project
  - `spike` → spike
  - `bounded` → small
  - `architectural` → project
  - A bare `프로젝트` never sets the size.
- `finish` never shows a time. A stage reached out of order shows no time.
- State saved by older versions (no `at`) must still render. Normalize it with an exported pure helper. Tests can't seed atoms.
- Plugin version: `0.8.0` in `.claude-plugin/plugin.json`.
- Code style follows the files you touch: short `/** */` or `//` comments that explain why, arrow functions, no new files.

## Review Focus

1. **A Korean session whose sizing reply holds neither "작은 변경" nor English words.** Expected: no badge. The full stage line still draws once a spec is written. → Task 1, test `a spec without a size draws the full line, no badge`.
2. **Task reviews dispatched before every plan task is checked off (lower-case `review task 3`, or `Review the change`).** Expected: the stage stays `execute`. → Task 2, test `review waits for the plan to be done`.
3. **The main loop loads `receiving-code-review` after a "Needs fixes" report mid-plan.** Expected: the stage stays `execute`. → Task 2, same test.
4. **A pane loaded with state from 0.7.x, with no `at`.** Expected: it renders, and every stage shows without a time. → Task 3, test `sp saved without at reads as no times`.
5. **A narrow pane (`bodyColumns: 20`, drawn at 30).** Expected: no timeline row is wider than `W - 4`, and the time stays visible. → Task 4, test `a narrow pane cuts labels, keeps times`.

---

### Task 1: Size detection for 7.0.1

**Files:**
- Modify: `hooks/superpowers.ts` (`PATH_OF`, `pathFrom`, `reach`, `TEMPLATE`/`pipeline`)
- Modify: `hooks/register.tsx` (`turn.complete`, the main-loop branch)
- Test: `hooks/superpowers.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- Produces:
  - `pathFrom(text: string): SpPath | undefined`, which now reads 7.0.1 words.
  - `sizeUp(cur: SpPath | undefined, next: SpPath): SpPath`, which returns whichever ranks higher.
  - `reach()` no longer sets `path`.
  - `pipeline(sp)` draws the full template (`brainstorm, spec, plan, execute, review, finish`, plus `worktree` once reached) when `path` is `small` or `project`, or when `path` is unset and `spec` has been reached. A `spike`, or an unsized cycle without a spec, draws only the stages it has reached.

- [ ] **Step 1: Write the failing tests**

  In `superpowers.test.ts`, replace the `path is the last one…` test, the `pipeline draws…` test, and the `expect(sp.path).toBe('project')` line in `reach moves forward only…` with these:
  ```ts
  test('7.0.1 sizing words, any case, inside Korean text', () => {
    expect(pathFrom('This is a small change, so I will describe it here.')).toBe('small')
    expect(pathFrom('규모는 작은 변경으로 보고 짧은 문서를 쓰겠습니다')).toBe('small')
    expect(pathFrom('This is a project, so a full design doc.')).toBe('project')
    expect(pathFrom('규모는 "프로젝트"로 보고 전체 문서를 쓰겠습니다')).toBeUndefined()
    expect(pathFrom('이건 spike 로 먼저 확인해 볼게요')).toBe('spike')
    expect(pathFrom('**분류: Architectural** — spec 경로로 가겠습니다')).toBe('project')
    expect(pathFrom('nothing here, unbounded')).toBeUndefined()
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
    expect(line({ stages: ['brainstorm'], current: 'brainstorm' })).toEqual(['current:brainstorm'])
    expect(line({ path: 'spike', stages: ['brainstorm'], current: 'brainstorm' })).toEqual(['current:brainstorm'])
    expect(line({ path: 'project', stages: ['worktree'], current: 'worktree' }).map(s => s.slice(s.indexOf(':') + 1))).toContain('worktree')
  })
  ```

  In `register.test.ts`:
  - Replace `a spec makes it a project` with `a spec without a size draws the full line, no badge`. Steps: brainstorming, then a Write to the spec path. Assert:
    - `ui.find({ text: /^(SMALL|PROJECT|SPIKE)$/ })` is undefined.
    - The `○ finish` stage row exists. This uses the timeline text from Task 4, so for now assert on the old line, `/○finish$/`. Task 4 updates it.
  - Add `a small change stays small through its spec`. Steps: brainstorming, then `turn.complete(sdd('작은 변경이라 짧은 design doc을 쓸게요'))`, then a spec Write, then `turn.complete(sdd('a spike could help here'))`. Assert that `SMALL` is shown.

- [ ] **Step 2: Run the tests and confirm they fail**

  Run `claude plugin test .`. Expected: the new tests FAIL because `sizeUp` isn't defined, `small change` returns undefined, and PROJECT is shown after the spec.

- [ ] **Step 3: Implement**
  - `pathFrom`: the last match of the English words (word-bounded, case-insensitive) or `작은 변경`. Plain `\b` doesn't work around Hangul, so match the Korean phrase without it.
  - `sizeUp`: rank `spike < small < project`.
  - `reach`: remove the `path` line.
  - `pipeline`: change the template rule as described in Interfaces.
  - In `register.tsx` `turn.complete`: use `{ ...s, path: sizeUp(s.path, path) }` while `s.current === 'brainstorm'`.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run `claude plugin test .`. Expected: all pass.

- [ ] **Step 5: Commit**

  `git commit -am "fix: 7.0.1 규모 판정 (small change/작은 변경, 상향만), spec이 project를 강제하지 않음"`

---

### Task 2: Stage never runs ahead (review gate, subagent skills, task numbers, fix agents)

**Files:**
- Modify: `hooks/superpowers.ts` (`roleOf`, `taskNOf`)
- Modify: `hooks/register.tsx` (`agent.spawn`, `skill.prompt`, `tool.call`)
- Test: `hooks/superpowers.test.ts`, `hooks/register.test.ts`

**Interfaces:**
- Consumes: `isSpPlan` and `allDone` from `register.tsx` (they already exist).
- Produces:
  - `roleOf('Fix Task 3 findings') === 'impl'`
  - `taskNOf('review task 3') === '3'`
  - In `register.tsx`: `reviewReady = (p: Plan | undefined) => !isSpPlan(p) || allDone(p!.tasks)`.

- [ ] **Step 1: Write the failing tests**

  In `superpowers.test.ts`, extend `SDD dispatches get a role…`:
  ```ts
  expect(roleOf('Fix Task 3: address review findings')).toBe('impl')
  expect(roleOf('Fix final review findings')).toBe('impl')
  expect(taskNOf('review task 3 (spec + quality)')).toBe('3')
  ```

  In `register.test.ts`, add `review waits for the plan to be done`:
  - Setup:
    - `fs.read` serves an SP plan with `### Task 1: A\n- [x] a\n### Task 2: B\n- [ ] b\n`. Reuse the `SP` constant and its ledger handling from the `finish shows…` test.
    - Write it, then load SDD.
  - Spawn `Review the change` (a review role with no task number). Assert the stage row `execute` is still current: `/●execute/` now, the timeline form after Task 4.
  - Load `superpowers:receiving-code-review`. Assert it's still execute.
  - Re-serve the plan with both boxes `[x]` and Read it again. Then spawn `Final whole-branch review`. Assert `review` is now current.

  Add `a skill a subagent loads never moves the stage`:
  - Load SDD.
  - Stub `tool.call` so that for `tool: 'Skill'` it calls `$.skill.prompt({ skill: 'superpowers:requesting-code-review', text: '' })` before returning `{ result: {} }`.
  - Call `$.tool.call({ tool: 'Skill', skill: 'superpowers:requesting-code-review', agentId: 'A1' } as never)`.
  - Assert the stage is still execute.
  - Call the same thing without `agentId`, with the plan all done (or with no SP plan). Assert it moves to review.
  - If the test host can't nest `skill.prompt` inside a `tool.call` stub, do this instead: export `subagentSkill` bookkeeping as a pure helper (e.g. `skipStage(depth: number) => boolean`), unit-test that, and note it in the commit.

- [ ] **Step 2: Run the tests and confirm they fail**

  Run `claude plugin test .`. Expected: FAIL. `Fix` has no role, `review task 3` has no number, and the stage jumps to review early.

- [ ] **Step 3: Implement**
  - `roleOf`: treat `/^(implement|fix)\b/i` as `impl`.
  - `taskNOf`: make the regex case-insensitive.
  - `agent.spawn`: jump to review only when the role is `review`, there's no `taskN`, `current === 'execute'`, and `reviewReady(plan)`.
  - `skill.prompt`: when `stage === 'review'` and `!reviewReady(plan)`, skip. When a subagent Skill call is in flight, skip the stage but still record extras.
  - `tool.call`: when `e.tool === 'Skill' && e.agentId`, increment a module counter around `next(e)` and decrement it in `finally`. Mark it `// ponytail: one counter for all agents, a concurrent main-loop skill load is skipped too; key by agent if that shows up`.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run `claude plugin test .`. Expected: all pass.

- [ ] **Step 5: Commit**

  `git commit -am "fix: plan이 끝나기 전엔 review로 넘어가지 않음, 서브에이전트 스킬은 단계 불변, Fix 에이전트 역할"`

---

### Task 3: Stage start times

**Files:**
- Modify: `types/index.d.ts` (`Sp`)
- Modify: `hooks/superpowers.ts` (`EMPTY_SP`, `reach`, new `stageTimes`, `withAt`)
- Modify: `hooks/register.tsx` (every `reach` caller passes `await $.clock.now()`; `updateSp` and render normalize through `withAt`)
- Test: `hooks/superpowers.test.ts`

**Interfaces:**
- Produces:
  - `Sp.at: Partial<Record<Stage, number>>`, with `EMPTY_SP.at = {}`.
  - `reach(sp: Sp, stage: Stage, now: number): Sp` stamps `at[stage] = now` only on the first reach in a cycle. A new cycle resets `at`.
  - `withAt(sp: Sp): Sp` fills in a missing `at` with `{}`.
  - `stageTimes(sp: Sp, now: number): Partial<Record<Stage, number>>` returns the duration in ms of each reached stage, using these rules:
    - The end of a stage is the earliest `at` among stages later in `ORDER` that have been reached. The current stage ends at `now`.
    - A stage is omitted when it's `finish`, when it has no `at`, or when it's out of order. Out of order means its `at` is later than that of a stage after it in `ORDER`, e.g. `worktree` reached during execute.

- [ ] **Step 1: Write the failing tests**
  ```ts
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
  ```
  Update the existing `reach` tests for the new `now` argument and the `at` field.

- [ ] **Step 2: Run the tests and confirm they fail**

  Run `claude plugin test .`. Expected: FAIL because `stageTimes` and `withAt` aren't defined.

- [ ] **Step 3: Implement** the code described in Interfaces, and wire `now` through `register.tsx`.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run `claude plugin test .`. Expected: all pass.

- [ ] **Step 5: Commit**

  `git commit -am "feat: superpowers 단계별 시작 시각과 소요 시간"`

---

### Task 4: Timeline panel (mockup C), version 0.8.0

**Files:**
- Modify: `hooks/view.tsx` (`spPanel`, new `dur`)
- Modify: `hooks/register.tsx` (`spPanel` call passes `now` through `v`; no change if it already does)
- Modify: `.claude-plugin/plugin.json` (version `0.8.0`)
- Modify: `README.md` (the SUPERPOWERS section's description and ASCII example, if it has them)
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes:
  - `pipeline(sp)`, `stageTimes(sp, now)` (Task 3), `progressLines`, `agentRow`, `lineUp`, `doneTime`.
- Produces:
  - `dur(ms: number): string` gives `mm:ss` under one hour and `h:mm:ss` from one hour on.
  - `spPanel(ui, sp, plan, runs, v)` keeps its signature.

**Layout** (copied from the spec):
```
╭─ ⚡ SUPERPOWERS ─────────────────── SMALL ──╮
│ ✓ brainstorm                         04:10 │
│ ✓ spec                               01:05 │
│ ✓ plan                               02:30 │
│ ⠹ execute ███████▓▓░░░░░░░ 3/7       05:02 │
│   │ ⠹ impl #4 Add verdict parser     01:12 │
│   │ ✓ rev  #3 approved               00:48 │
│ ○ review                                   │
│ ○ finish                                   │
│ + tdd                                      │
╰────────────────────────────────────────────╯
```

- The header is unchanged.
- One row per `pipeline` step:
  - `✓` green for done.
  - The spinner while busy, otherwise `●`, in yellow bold, for current.
  - `○` dim for todo.
  - The time from `stageTimes` is right-aligned with `dur`. There's no time when it's missing.
- When the current row is `execute` and `plan.length > 0`, the bar and ` done/total` sit inline on that row. Keep the green/yellow/dim cells and the sweep from `progressLines`. You may factor the bar out of `progressLines` into a shared helper so the colors aren't duplicated. When everything is done, a nested `✓ completed · <doneTime>` line follows.
- Role agents go under the current stage only, prefixed with `  │ `. Use the same selection and order as today (live first, latest, `ROLES_SHOWN`). They're drawn with width `W - 4`.
- Extras stay last.
- No row is wider than `W - 4`. A long label is cut with `…` before the time is dropped (`lineUp`).

- [ ] **Step 1: Write the failing tests**

  Rewrite these tests to the timeline form:
  - `superpowers section…`
  - `finish shows on the pipeline…`
  - `SDD agents show by role…`
  - `a narrow pane folds the pipeline…`
  - `a narrow pane keeps the current stage…`
  - Task 1 and Task 2's stage assertions

  Each stage is its own row, matched like `/^● brainstorm/`, `/^✓ brainstorm +\d\d:\d\d$/` or `/^○ finish$/`. Add:
  - `timeline nests the plan bar and role agents under execute`:
    - Setup: an SP plan with 1 of 3 done, SDD, and `Implement Task 2: x` spawned.
    - Assert a row matching `/ 1\/3/` that also starts the `execute` row.
    - Assert a row `/^  │ [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] impl #2/`.
    - Assert `○ review` and `○ finish` are rows with no time.
  - `a narrow pane cuts labels, keeps times`:
    - Setup: `bodyColumns: 20` (drawn at 30), all of brainstorm through execute reached.
    - Assert every row text found under SUPERPOWERS is `length <= 26`.
    - Assert the done rows still end in `\d\d:\d\d`.
  - `dur`: `dur(65_000) === '01:05'`, `dur(3_725_000) === '1:02:05'`.

- [ ] **Step 2: Run the tests and confirm they fail**

  Run `claude plugin test .`. Expected: FAIL because the old one-line pipeline is still drawn.

- [ ] **Step 3: Implement** `spPanel` and `dur`, bump the version to `0.8.0`, and update the README's SUPERPOWERS text to match.

- [ ] **Step 4: Run the tests and confirm they pass**

  Run `claude plugin test .`. Expected: all pass, with no test left asserting the old single-line pipeline.

- [ ] **Step 5: Commit**

  `git commit -am "feat: superpowers 세로 타임라인 패널, 버전 0.8.0"`

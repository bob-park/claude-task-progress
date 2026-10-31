# SUPERPOWERS 단계별 agent 유지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** role이 붙은 agent가 자기가 시작된 단계 밑에 남고, 단계마다 최대 5줄 + `… N more`로 보인다.

**Architecture:** 저장 형식은 바꾸지 않는다. `sp.at`(단계 첫 도달 시각)과 `AgentRun.startedAt`을 비교해서 agent의 단계를 정하는 순수 함수를 `superpowers.ts`에 둔다. `view.tsx`의 `spPanel`은 이 함수로 agent를 단계별로 묶어서 그린다.

**Tech Stack:** TypeScript/TSX Claude Code plugin(`claude-code` hooks API, `Box`/`Text`). 테스트는 `claude plugin test .`(`claude-code/testing`)로 돌린다.

**Spec:** `docs/superpowers/specs/2026-10-30-sp-stage-agents-design.md`

## Global Constraints

- 단계마다 agent 행은 최대 5줄이고, 넘치면 `… N more` 한 줄을 더 붙인다(N = 숨은 수).
- 정렬: 실행 중(`running`/`waiting`) → 문제(`verdict === 'issues'` 또는 `status === 'failed'`) → `n` 내림차순. 끝난 단계와 현재 단계에 같은 규칙을 쓴다.
- `types/index.d.ts`는 건드리지 않는다. 등록 로직(role/stage 판정)도 건드리지 않는다.
- `register.tsx`는 `MAX_AGENTS`만 20에서 50으로 바꾼다. 내 결정이다: 10-task 사이클이면 agent가 22개라, 20개 상한에서는 brainstorm의 builder check과 앞쪽 ⚠ review가 지워지고 `… N more`가 실제보다 적게 센다.

## Review Focus

1. **mock clock처럼 단계 전환과 agent 시작이 같은 ms인 경우:** 단계 순서(`ORDER`)상 뒤쪽 단계에 넣는다. → Task 1 `stageOfRun` 테스트.
2. **0.7 이전에 저장된 sp(`at`이 비어 있음):** agent가 사라지면 안 된다. 현재 단계(`sp.current`)에 넣는다. → Task 1.
3. **이전 사이클의 agent(현재 사이클 첫 단계보다 먼저 시작):** 어느 단계에도 넣지 않는다(`undefined`). → Task 1.
4. **5개를 넘는 단계에 오래된 ⚠ review가 있는 경우:** ⚠가 5줄 안에 보이고, 나머지는 `… N more`로 접힌다. → Task 2.
5. **finish에 도달한 뒤:** execute와 review의 agent는 각자 단계 밑에 남고, finish 밑에는 아무것도 없다. → Task 2.

---

### Task 1: agent의 단계 판정

**Files:**
- Modify: `hooks/superpowers.ts` (`stageTimes` 아래에 추가)
- Test: `hooks/superpowers.test.ts`

**Interfaces:**
- Produces: `export const stageOfRun = (sp: Sp, startedAt: number): Stage | undefined`

- [ ] **Step 1: 실패하는 테스트 작성** (`superpowers.test.ts`, import에 `stageOfRun` 추가)

```ts
test('an agent belongs to the latest stage started by its start, a tie to the later stage', () => {
  const sp: Sp = { ...EMPTY_SP, stages: ['brainstorm', 'spec', 'plan', 'execute', 'review'], current: 'review', at: { brainstorm: 10, spec: 20, plan: 30, execute: 30, review: 50 } }
  expect(stageOfRun(sp, 15)).toBe('brainstorm')
  expect(stageOfRun(sp, 30)).toBe('execute') // plan and execute at the same ms
  expect(stageOfRun(sp, 49)).toBe('execute')
  expect(stageOfRun(sp, 60)).toBe('review')
  expect(stageOfRun(sp, 5)).toBeUndefined() // before this cycle
  expect(stageOfRun({ ...sp, at: {} }, 5)).toBe('review') // saved before stage times: the current stage
})
```

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test . 2>&1 | grep -E "stageOfRun|an agent belongs|fail"`
Expected: FAIL(`stageOfRun` 없음)

- [ ] **Step 3: `stageOfRun` 구현**

`at`이 비어 있으면 `sp.current`를 돌려준다. 아니면 `ORDER` 순서로 `sp.stages`를 돌면서 `at[s] <= startedAt`이고 `at[s] >= 지금까지 고른 단계의 at`인 단계를 고른다. `>=`라서 시각이 같으면 뒤 단계가 이긴다. 없으면 `undefined`를 돌려준다.

- [ ] **Step 4: 통과 확인**

Run: `claude plugin test . 2>&1 | tail -4`
Expected: `0 fail`

- [ ] **Step 5: Commit**

```bash
git add hooks/superpowers.ts hooks/superpowers.test.ts
git commit -m "feat: agent 시작 시각으로 superpowers 단계 판정"
```

### Task 2: 단계마다 agent 그리기, 5줄 + more

**Files:**
- Modify: `hooks/view.tsx:203-273` (`spPanel`)
- Modify: `hooks/register.tsx:17` (`MAX_AGENTS = 50`)
- Modify: `README.md:10` (SUPERPOWERS의 agent 설명), `.claude-plugin/plugin.json` (`"version": "0.9.0"`)
- Test: `hooks/register.test.ts`

**Interfaces:**
- Consumes: `stageOfRun(sp, startedAt)` (Task 1)

- [ ] **Step 1: 실패하는 테스트 작성** (`register.test.ts`, 기존 helper `pane`, `sdd`, `mock.clock` 사용)

```ts
test('each stage keeps its agents: issues first, 5 rows, then … more', async ($, on) => {
  const clock = mock.clock(on)
  let k = 0
  on('fs.read', (_$, e) => (e.path === SP ? { value: [1, 2, 3, 4, 5, 6].map(n => `### Task ${n}: T\n- [x] a\n`).join('') } : { deny: `ENOENT: ${e.path}` }))
  on('tool.call', () => ({ result: {} }) as never)
  on('skill.prompt', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `A${++k}` }))
  on('turn.complete', () => ({ text: '' }))
  const done = (answer = '') => $.turn.complete({ ...(sdd(answer) as object), agentId: `A${k}` } as never)
  await $.skill.prompt({ skill: 'superpowers:brainstorming', text: '' })
  await $.agent.spawn({ prompt: 'p', description: 'Builder check' } as never)
  await done('nothing important left')
  await clock.advance(1000)
  await $.tool.call({ tool: 'Write', file_path: SP, content: '' } as never)
  await $.skill.prompt({ skill: 'superpowers:subagent-driven-development', text: '' })
  for (let n = 1; n <= 6; n++) {
    await $.agent.spawn({ prompt: 'p', description: `Implement Task ${n}: x` } as never)
    await done()
    await $.agent.spawn({ prompt: 'p', description: `Review Task ${n} (spec + quality)` } as never)
    await done(n === 1 ? '**Task quality:** Needs fixes' : 'Approved')
  }
  await clock.advance(1000)
  await $.agent.spawn({ prompt: 'p', description: 'Review code changes' } as never)
  await done('Approved')
  await clock.advance(1000)
  await $.skill.prompt({ skill: 'superpowers:finishing-a-development-branch', text: '' })
  const ui = await $.ui.mount({ ...pane, props: { ...pane.props, scroll: { offset: 0, bodyRows: 60 } }, surface: 'terminal' } as never)
  const rows = (await ui.findAll({ text: /^(. (brainstorm|spec|plan|execute|review|finish)\b|. (impl|review) |  … \d+ more$)/ })).map(r => r.text.split(/ {2,}/)[0])
  expect(rows).toEqual([
    '✓ brainstorm', '✓ review Builder c…',
    '✓ spec', '✓ plan',
    expect.stringMatching(/^✓ execute /),
    '⚠ review #1', '✓ review #6', '✓ impl #6', '✓ review #5', '✓ impl #5', '  … 7 more',
    '✓ review', '✓ review Review c…',
    expect.stringMatching(/^. finish$/),
  ])
})
```

Builder check의 정확한 잘림(`Builder c…`)과 execute 행의 막대 부분은 폭에 따라 달라질 수 있다. 잘림 위치가 다르면 실제 렌더 결과에 맞춰 정규식으로 바꾸되, 순서와 `… 7 more`는 그대로 둔다. `findAll`이 nested 행 텍스트를 이렇게 돌려주는지는 기존 테스트 `a running role agent without a task number…`가 증명한다.

- [ ] **Step 2: 실패 확인**

Run: `claude plugin test . 2>&1 | grep -E "each stage keeps|fail"`
Expected: FAIL(지금은 agent가 현재 단계인 finish 밑에만 4줄 보인다)

- [ ] **Step 3: `spPanel` 수정**

- `ROLES_SHOWN`을 5로 바꾼다.
- `roles` 대신 `rolesOf(stage: Stage): JSX.Element[]`를 만든다. `runs.filter(r => r.role && stageOfRun(sp, r.startedAt) === stage)`를 Global Constraints의 정렬로 줄 세우고 앞 5개를 지금의 `agentRow` 행으로 만든다. 남는 게 있으면 `nested(\`more${stage}\`, <Text dimColor>{\`  … ${rest} more\`}</Text>)`를 붙인다.
- `flatMap`에서 `...(s.state === 'current' ? roles : [])`를 `...rolesOf(s.stage)`로 바꾼다. execute의 `planNow` 행은 지금처럼 agent 행보다 먼저 온다.
- 위 주석을 "its agents under the stage they started in"으로 고친다.

- [ ] **Step 4: `MAX_AGENTS` 50, README, 버전**

`register.tsx:17`을 `const MAX_AGENTS = 50`으로 바꾼다. README의 "under the current stage, its agents by role, working ones first"는 "under each stage, the agents that ran in it: working ones first, then ones with issues, then the latest, 5 at most and `… N more`"로 바꾼다. `plugin.json`의 version은 `0.9.0`으로 올린다.

- [ ] **Step 5: 기존 테스트 갱신, 전체 통과 확인**

`a running role agent without a task number stays in view after many tasks`는 이제 5줄을 기대해야 한다. 기대 배열 끝에 `'✓ impl #2'`를 더한다. 다른 기존 테스트는 바꾸지 않는다. 실패하면 구현을 고친다.

Run: `claude plugin test . 2>&1 | tail -4`
Expected: `0 fail`

- [ ] **Step 6: Commit**

```bash
git add hooks/view.tsx hooks/register.tsx hooks/register.test.ts README.md .claude-plugin/plugin.json
git commit -m "feat: superpowers 단계마다 agent 유지, 최대 5줄과 more, 버전 0.9.0"
```

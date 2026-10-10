# Monitor redesign — design

## Problem

The pane only monitors well when superpowers runs: TASKS falls back to a superpowers
plan, `finishing-a-development-branch` is special-cased, and AGENTS drops an agent as
soon as it ends. A session without superpowers shows little beyond the main panel, and
a session with superpowers mixes its workflow into the generic panels.

## Goal

Keep the main panel as is. Move everything superpowers-specific into its own
SUPERPOWERS section that tracks the whole workflow (stages, path classification,
plan progress, SDD subagents by role). Add generic sections that monitor any session:
todos, subagent history, skills used, and tool activity.

Success: a session without superpowers shows TASKS / AGENTS / SKILLS / ACTIVITY as
they happen; a superpowers session additionally shows SUPERPOWERS with the current
stage, the spike/bounded/architectural badge, plan progress and SDD agents by role.

## Layout (mockup A)

Sections stack top to bottom; a section with nothing to show is hidden.

```
╭──────────────────────────────────────────────╮
│ Opus 5.5 · main                   ⠹ working  │
│ effort ▮▮▮▯ high   mode auto   42 req        │
│ ctx ▰▰▰▰▱▱▱▱▱▱ 41% 82k/200k                  │
│ $3.12   5h ▰▰▱▱▱ 38%  7d ▰▱▱▱▱ 12%           │
╰──────────────────────────────────────────────╯
╭─ ⚡ SUPERPOWERS ──────────── ARCHITECTURAL ──╮
│ ✓… ✓plan ●execute ○review ○finish            │
│ ██████▓▓▓░░░░░░░░░░░░░░░░░ 3/8 · 37%         │
│ ⠹ #4 Wire skill detector                     │
│ ⠹ impl #4                   Haiku 5.5 01:12  │
│ ✓ review #3                  approved 00:41  │
│ ⚠ review #2                    issues 01:05  │
│ + tdd  + verification                        │
╰──────────────────────────────────────────────╯
╭─ TASKS ──────────────────────────────────────╮
│ ████████████░░░░░░░░░░░░░░ 2/5 · 40%         │
│ ▸ #3 Run tests                               │
╰──────────────────────────────────────────────╯
╭─ AGENTS  2 running · 5 done ─────────────────╮
│ ⠹ 7 Explore auth ---------- Haiku 5.5 00:23  │
│ ✓ 6 Review diff ----------- Opus 5.5  02:10  │
│ ✗ 5 Run e2e --------------- Sonnet 5.5 01:02 │
╰──────────────────────────────────────────────╯
╭─ SKILLS ─────────────────────────────────────╮
│ brainstorming → writing-plans → sdd → tdd    │
╰──────────────────────────────────────────────╯
╭─ ACTIVITY ───────────────────────────────────╮
│ 14:05 ⠹ Bash · Run tests                     │
│ 14:05 ✓ Edit · register.tsx                  │
│ 14:04 ✓ Read · plan.ts                       │
╰──────────────────────────────────────────────╯
```

## Files

| File | Role |
|---|---|
| `hooks/register.tsx` | Event handlers; they only update state |
| `hooks/view.tsx` (new) | One render function per section; `ui.render` composes them |
| `hooks/superpowers.ts` (new) | Pure functions: stage of a skill, path from text, SDD role and task number, pipeline truncation |
| `hooks/plan.ts` | Unchanged |
| `types/index.d.ts` | State types below |

## State

Atoms under plugin `task-progress`:

- `main`, `tasks` (todos), `plan`: unchanged, except `plan.finishing` is dropped (now `sp.stages` holds `finish`).
- `agents: Record<string, AgentRun>` — now a history. `AgentRun` gains
  `status: 'running' | 'waiting' | 'done' | 'failed'`, `role?: 'impl' | 'review'`,
  `taskN?: string`, `verdict?: 'ok' | 'issues'` (`role`, `taskN` and `verdict` from superpowers only). Kept across prompts; only the latest 20 are stored.
- `skills: Array<{ name: string; at: number }>` (new) — every `skill.prompt`, in order;
  a repeat of the last one is not added again; the latest 30 are kept.
- `activity: Array<{ at: number; label: string; status: 'running' | 'ok' | 'error' }>` (new) —
  the last 10 main-loop tool calls.
- `sp` (new): `{ path?: 'spike' | 'bounded' | 'architectural'; stages: Stage[]; current?: Stage; extras: string[]; doneAt: number | null }`,
  `Stage = 'brainstorm' | 'spec' | 'plan' | 'worktree' | 'execute' | 'review' | 'finish'`.
  Empty `stages` means superpowers has not run: the section is hidden.

## Section ownership

- **SUPERPOWERS**: the superpowers plan (`docs/superpowers/plans/*.md`) progress, the
  pipeline, the path badge, and agents with a `role`.
- **TASKS**: todos; with none (or all done while the plan-mode plan has open tasks), the
  plan-mode plan (`~/.claude/plans/*.md`). A superpowers plan never shows here.
- **AGENTS**: agents without a `role`. The header counts every agent, roles included.

No agent is listed in two sections.

## Detection

**Stages.** A `skill.prompt` whose `e.skill` matches `(^|:)<name>$`:

| Stage | Trigger |
|---|---|
| brainstorm | `brainstorming` |
| spec | main-loop Write/Edit to `docs/superpowers/specs/*.md` |
| plan | `writing-plans`, or a main-loop Write/Edit/Read of a superpowers plan that is new (not the active plan) or before `plan` was reached |
| worktree | `using-git-worktrees` (shown only once reached) |
| execute | `subagent-driven-development`, `executing-plans`, `dispatching-parallel-agents` |
| review | `requesting-code-review`, `receiving-code-review` |
| finish | `finishing-a-development-branch` |

Reaching a stage adds it to `stages` if absent and moves `current` forward only: a
stage earlier than `current` (a late plan Read) leaves `current` alone. Once `finish`
was reached, any earlier stage starts a new cycle from an empty `sp`.
`test-driven-development`, `systematic-debugging` and `verification-before-completion`
add to `extras` (shown as `+ tdd`, `+ debugging`, `+ verification`).

**Pipeline shape.** Drawn stages depend on `path`:

- architectural: brainstorm, spec, plan, [worktree], execute, review, finish
- bounded: brainstorm, execute, finish
- spike, or no path yet: only the stages in `stages`

A drawn stage before `current` is `✓` (a skipped one counts as passed), `current` is `●`
(the spinner while busy), the rest `○`. Too wide for the pane: the leading done stages collapse to `✓…`; the current and later stages never fold (the line is clipped instead).

**Path badge.** While `current` is `brainstorm`, each main-loop `turn.complete` result
text is matched with `/\b(spike|bounded|architectural)\b/gi`; the last match sets
`path`. Reaching `spec` or `plan` sets `architectural` regardless.

**SDD roles.** superpowers 6.4.1 dispatches `Implement Task N: …`, one combined
`Review Task N (spec + quality)`, `Re-review Task N fix round R`, and document reviews
(`Review spec document`, `Review plan document`, `Review code changes`). An
`agent.spawn` while `sp.stages` is non-empty and `current` is not `finish` gets a role from its description alone
(prompts quote the spec, so they would mislead): `/^implement\b/i` → impl, else
`/review/i` → review, else none. `taskN` is the first `/\bTask\s+(\d+)/` in the
description only (prompts quote plan text). A review agent without a task number
spawned while `current` is `execute` is SDD's whole-branch review: it reaches `review`. When a review agent's turn completes, its answer sets
`verdict`: `/needs fixes|not addressed|❌/i` → issues, else `/approved|addressed|✅/i`
→ ok, else unset.

**Agent status.** `running` on spawn. `turn.complete` for the agent: `waiting` when
`$.agent.list()` reports it waiting (existing logic), `failed` when `reason` is `error`
or `aborted`, else `done`. A step after its end puts it back to `running` (existing logic).

**Skills / activity.** Every `skill.prompt` is recorded with its plugin prefix stripped.
Each main-loop `tool.call` pushes `running` before `next(e)` and becomes `error` (deny,
`isError`, or `next(e)` throwing) or `ok` after. A row's id is one past the highest kept
row's, so ids stay unique across a hot reload. An agent kept from 0.6 without `status`
reads as `running` until it has an `endedAt`, then `done`.

## Rendering

W is `bodyColumns`, as today.

- **main**: moved to `view.tsx` unchanged.
- **SUPERPOWERS** (when `sp.stages` is non-empty): title left, path badge right
  (uppercase); pipeline line; when a superpowers plan is active, the progress bar and
  current task line from today's TASKS code (sweep animation included), or
  `✓ 모두 완료 · <time>` from `sp.doneAt`; role agents, working ones first then the latest
  spawned, at most 4 lines, as `icon role #N … Model|approved|issues mm:ss` (a review that wants fixes
  shows `⚠`; one without a task number shows its description); `extras` on one line.
- **TASKS** (todos or a plan-mode plan): today's bar and current line; done time from `main.doneAt`.
- **AGENTS** (any agent without a role): running and waiting ones first (latest on
  top; waiting shows `⏸` and counts as running), then the latest 3 ended ones with
  `✓` (done) or `✗` (failed). Header `N running · M done`, plus `· K failed` when K > 0. Rows keep today's `n: label --- Model mm:ss`
  format; an ended row shows its final duration.
- **SKILLS**: `a → b → c` on one line; too wide drops the oldest behind `… →`.
- **ACTIVITY**: the latest 3 as `HH:MM icon Tool · target` (spinner / `✓` / `✗`), newest on top.

Border colors: main cyan, SUPERPOWERS yellow, TASKS green, AGENTS magenta, SKILLS blue,
ACTIVITY gray.

The redraw ticker runs while the main turn or any agent is running (unchanged).

## Error handling

A failed file read keeps what the pane shows; a failed `agent.list` is an empty list; a
heuristic miss only leaves a badge, role or verdict out. Hooks return `next(e)`'s
result unchanged, except the existing ExitPlanMode context line.

## Testing

`claude plugin test .` with `claude-code/testing`.

- `hooks/superpowers.test.ts` (new): stage of each skill name (prefixed and bare),
  path from text (case, last wins, inside Korean text), role and task number,
  pipeline truncation.
- `hooks/register.test.ts` (updated), mounting the pane:
  - no SUPERPOWERS before a superpowers skill; present after `brainstorming`
  - a reply containing "bounded" shows the BOUNDED badge
  - an implementer spawned during SDD shows under SUPERPOWERS, not AGENTS
  - an agent spawned before any superpowers skill gets no role
  - a narrow pane folds the pipeline and the skills line
  - a plain agent that ends stays under AGENTS with `✓`
  - SKILLS and ACTIVITY show
  - existing tests whose behaviour changed (ended agents now stay; activity shows
    even with tasks; the superpowers plan moved out of TASKS) are updated to it

## Docs and version

README sections rewritten for the new layout; version 0.7.0.

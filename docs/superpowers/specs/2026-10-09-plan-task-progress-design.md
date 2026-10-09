# Plan-based task progress — design

## Problem

The TASKS panel only learns about tasks from `TodoWrite` / `TaskCreate` / `TaskUpdate`.
Sessions without those tools (observed in this environment) never show progress, even
while superpowers executes a plan or Claude follows a plan-mode plan. Both leave
progress on disk instead:

- superpowers plan: `docs/superpowers/plans/*.md` with `### Task N: <title>` headings and
  `- [ ]` / `- [x]` steps, plus an SDD ledger at
  `<root>/.superpowers/sdd/<plan basename>/progress.md` whose first line is
  `# SDD ledger — plan: <plan path>` and which gains `Task <N>: complete (…)` lines.
- plan-mode plan: `~/.claude/plans/*.md`, written with Write/Edit; `ExitPlanMode`'s
  result carries its `filePath`.

## Goal

Show progress in the existing TASKS panel from the active plan file whenever no todos
exist. Success: running a superpowers plan, or a plan-mode plan, fills the TASKS bar
and its done count rises as tasks complete — with no todo tool available.

## Behaviour

**Source priority.** Todos (existing `tasks` atom) win when non-empty. Otherwise the
panel draws the plan tasks. Rendering is unchanged; both produce `Task[]`.

**Active plan.** After a successful main-loop (`!e.agentId`) tool call:

- `Write` / `Edit` / `Read` (a plan from an earlier session is executed by reading it) whose path matches `/docs/superpowers/plans/*.md` or
  `/.claude/plans/*.md` → that path becomes the active plan.
- `ExitPlanMode` with `result.filePath` → that path becomes the active plan.

Only one plan is active; a newer one replaces it.

**Refresh.** After every successful main-loop tool call while a plan is active, re-read
the plan (and, for superpowers plans, the ledger) and store the parsed tasks. This
catches the ledger lines that SDD's Bash scripts append.

**Superpowers parsing** (plan has at least one `### Task N:` heading):

- one task per heading, label = heading title after `Task N:`.
- completed if the ledger has `Task N: complete`, or the task has ≥1 step and all are `- [x]`.
- the first non-completed task is `in_progress` if any step in the plan is ticked or the
  ledger has any completion line; the rest are `pending`.
- ledger path: `<root>/.superpowers/sdd/<basename without .md>/progress.md`, where
  `<root>` is the plan path up to `/docs/superpowers/plans/`. The ledger is used only if
  its first line contains the plan's basename; otherwise it is ignored.

**Plan-mode parsing** (no `### Task N:` headings):

- one task per checkbox line (`- [ ]` / `- [x]`, any indent); label = text after the box.
- `[x]` → completed; first unchecked → `in_progress` if any box is ticked, else `pending`.
- no checkboxes → one `pending` task per top-level numbered item (`1. …`).
- nothing found → no tasks (panel stays hidden).

**Hint to Claude.** When `ExitPlanMode` succeeds with a `filePath`, the tool result gets
one context line: `Mark each step done by ticking it (- [x]) in <path> as you finish it.`

**Errors.** A failed read leaves the stored plan tasks untouched and never fails the
tool call. A missing ledger is normal (no ledger yet).

## Code layout

- `hooks/plan.ts` — pure `parsePlan(text: string, ledger?: string) → Task[]` and
  `ledgerPath(planPath) → string | null`. No engine imports.
- `hooks/register.tsx` — new `plan` atom `{ path: string; tasks: Task[] }`, the
  tool-call wiring above, and render picks `todos.length ? todos : plan.tasks`.
- `types/index.d.ts` — add `plan` to `PluginState`.

## Testing

- `hooks/plan.test.ts` — `parsePlan` on fixture strings: superpowers with/without
  ledger, foreign ledger ignored, checkbox plan, numbered fallback, empty.
- `hooks/register.test.ts` — Write a superpowers plan through `$.tool.call`, mount the
  pane, assert the count; todos still take priority.

## Out of scope

Plans written by subagents, multiple simultaneous plans, collision-suffixed SDD
workspace directories (`<slug>-<parent>`), README changes beyond one line.

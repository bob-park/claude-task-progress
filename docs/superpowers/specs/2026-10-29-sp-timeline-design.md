# Superpowers stage tracking for 7.0.1 + timeline panel — design

## Why

Against superpowers 7.0.1 the SUPERPOWERS section sometimes shows the wrong stage.
The user saw both of these in real sessions:

- a **small change** showed the **PROJECT** badge
- the stage jumped to **review** while tasks were still executing

The user also wants the section redesigned so the whole workflow reads at a glance.
They picked **mockup C, a vertical timeline** (`.superpowers/brainstorm/*/content/sp-panel-layout.html`).

Work happens on branch `feat/sp-timeline`.

## Goals

- Stage and size detection follow 7.0.1's skills as written
- SUPERPOWERS renders as the vertical timeline below, with a duration per stage

## Non-goals

- The other panels (main, TASKS, AGENTS, SKILLS, ACTIVITY) stay as they are
- No history of earlier cycles: a new cycle after `finish` still starts fresh

## Anti-goals

- The stage must never move backwards, and it must never run ahead of the real workflow.
  A redesign that looks better but still jumps early counts as a failure.

## How 7.0.1 behaves (what detection must match)

- brainstorming sizes the work in plain words, "a small change" or "a project". Both
  write a design doc to `docs/superpowers/specs/` and then go to writing-plans. A spike
  skips the doc and the plan.
- SDD runs one implementer per task (`Implement Task N…`), then a task reviewer
  (`Review Task N`), and on issues a fix loop (`Fix Task N`, `Re-review Task N`). It
  dispatches one whole-branch final review only after **every task is complete**, then a
  single fix subagent and a re-review, and finally `finishing-a-development-branch`.
- executing-plans (inline) has the same final review.
- Subagents may load skills themselves (an implementer runs TDD, for example).

## Detection fixes

1. **Size.** Writing a spec no longer sets `path = 'project'`. `pathFrom` reads the
   7.0.1 sizing words: `small change` → small, `a project` → project, `spike` → spike,
   plus 6.4.1's `bounded` / `architectural`, and Korean `작은 변경` → small. A bare
   `프로젝트` is too common in Korean replies, so it doesn't set the size; the English
   `a project` still does. (The user's decision.) As today, it applies only while
   `current === 'brainstorm'`. 7.0.1 lets the size step up ("If it grows mid-task… step
   up a size"), so only upgrades count: spike → small → project. A later "spike" or
   "small change" can't move the size back down. (My call.)
   - Builder's call (my proposal): if both words appear in one reply, the last one wins, as now.
2. **Template.** `small` uses the same stage line as `project`:
   brainstorm → spec → plan → execute → review → finish. Every stage is drawn, so the
   ones still ahead show as ○. `spike` keeps only the stages it has reached. A cycle that
   wrote a spec but has no size yet also draws the full line, without a badge. (The user's
   decision.) Replace the existing test that expects "small change" → undefined.
3. **Early review.** `taskNOf` matches `task N` in any case. The jump from execute to
   review needs two things together: a review-role agent with no task number, **and** a
   superpowers plan whose tasks are all completed. Before that, a review-role agent with
   no task number counts as a task-level review and leaves the stage alone. The main loop
   loading `requesting-code-review` or `receiving-code-review` passes through the same
   gate, a shared "plan all done" check, because 7.0.1 loads both mid-execution (the
   final-review template and handling a "Needs fixes" report). Without a superpowers
   plan (for example an ad-hoc review outside SDD), the gate doesn't apply. (My call,
   following the anti-goal.)
4. **Subagent skills.** A skill loaded inside a subagent never moves the stage. Extras
   (`+ tdd` and the like) still record. `skill.prompt` doesn't carry an `agentId`, but
   `tool.call` does: while a subagent's `Skill` tool call is in flight, `skill.prompt`
   skips stage changes. A `/name` typed by the user never goes through `tool.call`, so
   it still counts.
   - Known limit: if the main loop and a subagent load skills at the same instant, the
     main loop's stage change can be lost. Mark this with a `ponytail:` comment.
5. **Fix agents.** `roleOf` treats `Fix …` as `impl`, so fix-loop and final-fix agents
   show under SUPERPOWERS instead of AGENTS.

## Stage times

- `Sp` gains `at: Partial<Record<Stage, number>>`, the time each stage was first reached
  in this cycle. `reach()` stamps it, so the clock must be passed in or stamped by the caller.
- A stage's duration runs from its own start to the earliest later start among the reached
  stages. The current stage runs to `now`, with one exception: `finish` shows no time,
  because it's never left until a new cycle starts. Time spent waiting on the user still
  counts, since this is wall-clock time. (My call; no end timestamp needed.)
- A stage reached out of order (for example `worktree` during SDD setup, or a late `plan`
  read) can't produce a sensible duration. Show it without a time.
- State saved by an older version has no `at`. Normalize it to `{}` with an exported pure
  helper, the same way `withStatus` does (see memory: tests can't seed atoms).

## Layout (mockup C)

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

- One row per stage from `pipeline(sp)`: ✓ green for done, spinner or ● yellow for
  current, ○ dim for todo. Durations are right-aligned (`mm:ss`; `h:mm:ss` from one hour).
- The current row is **execute** and a superpowers plan exists: the row carries the plan
  bar and done/total. The plan bar's colors and sweep come from `progressLines`.
- Role agents (most recent `ROLES_SHOWN`, live ones first, as today) sit indented under
  the current stage with a `│` guide. They're never drawn under a todo stage.
- When the plan is all done, a `✓ completed · <doneTime>` line goes under execute, as today.
- Extras stay last.
- At narrow widths the label is cut with `…` before the time is dropped (reuse `lineUp`).

## Approaches considered

1. **Add `at` to the existing `Sp` (picked).** One new field, three files plus tests, and
   no new atom. Durations of out-of-order stages are approximate, so they're hidden.
2. A separate stage event log atom: exact intervals, but it records data nothing shows
   and needs more migration code.
3. Layout C without times: the smallest change, but C's right column loses its value.

The user picked 1.

## Testing

- One test per detection fix that reproduces the bug before the fix, in
  `hooks/superpowers.test.ts` (pure helpers) or `hooks/register.test.ts` (hook flow).
- One timeline render test: rows, durations, and nesting under the current stage.
- `claude plugin test .` passes.

## Left to the builder

- Exact colors and spacing within the mockup's look
- Whether `reach` takes `now` or the caller stamps `at`
- How durations render once past 99 minutes
- The version bump (the repo bumps the patch with each feature commit; this is a minor:
  0.8.0) and the README screenshot (separate, see memory `demo-recording`)

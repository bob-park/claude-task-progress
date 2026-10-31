# Execute progress that follows 7.0.1 ledgers + a shimmering current-task line — design

Size: a small change. Branch `feat/sp-execute-progress`.

## Why

During execute the SUPERPOWERS plan bar sticks at `0/N` and the current-task line shows
`○ 다음: #1` while work is well underway. Reproduced against a live vee-app SDD run
(`docs/superpowers/plans/2026-10-31-editor-bg-brush-subject.md`): Tasks 1–3 complete,
3b running, `parsePlan` returned all 8 tasks `pending`. Causes:

1. The ledger writes `- Task 1: complete (…)` as a list item; `parsePlan` only matches
   `Task N: complete` at line start.
2. 7.0.1 never ticks plan checkboxes, so with no ledger match nothing counts as started.
3. `### Task 3b:` (a task added mid-run) doesn't match `Task\s+(\d+):`, so it vanishes and
   its steps attach to Task 3.

The user also finds the current-task line too quiet and wants it to stand out.

## Goals

- The execute bar counts 7.0.1 ledgers as written, and the running task shows as current.
- The current-task line shimmers (mockup A: a bright highlight sweeps left to right across
  the text, like Claude Code's "Thinking…"), and ends with its live phase and time:
  `⠹ #3b AI worker process      review 00:41`.

## Non-goals

- The bar keeps its block look (`███▓▓░░`) and its sweep (the user's decision).
- No other panel changes.

## Anti-goals

- Never show a task done or current that isn't. Never move the stage (that logic stays).

## Approaches

1. Ledger only: current task and phase both from ledger lines. Simple, but the ledger is
   written after the fact, so a running reviewer still reads as `impl`.
2. **Ledger + live agents (picked by the user).** Done and current from the ledger, which
   survives compaction; phase from the superpowers role agent running now, which the mod
   already tracks (`role`, `taskN`, `verdict`). The line flips to `review` the moment the
   reviewer starts.
3. Agents only: nothing shows for inline executing-plans and it's lost on resume. Dropped.

## How

**Ledger parsing (`hooks/plan.ts`)**
- Task numbers may carry a letter suffix: `Task\s+(\d+[a-z]?)` in headings and ledger lines.
- Ledger lines may start with list/quote markers or bold: `- `, `* `, `> `, `**`. A
  `Task N: complete` line marks done; a `Task N: dispatched` line marks it started.
- Current task: a dispatched-but-not-complete task is `in_progress`; otherwise, as today,
  the first open task once anything has started.

**Phase (render time, `hooks/view.tsx`)**
- For the current task, take the newest running/waiting role agent whose `taskN` matches.
  Phase word: `fix` when its label starts with `Fix`, `re-review` for `Re-review`, else its
  role (`impl` / `review`). Time is that agent's elapsed time. No such agent → no phase.
- `roleOf` stays as is (fix agents keep the `impl` role for grouping).

**Shimmer**
- While `busy`, the current-task line is drawn per character: the highlight cell is bright
  (near white, bold), ±2 cells a lighter yellow, the rest yellow. It advances one cell per
  frame and wraps with a few cells of gap. Idle: plain yellow, `▸` instead of the spinner.
- Only the SUPERPOWERS current-task line shimmers; TASKS keeps its look.

## Known limit

Inline executing-plans writes no `dispatched` line and spawns no agents, so its first task
shows `○ 다음: #1` until the first completion.

## Testing

- `hooks/plan.test.ts`: the bulleted vee-app ledger shape counts done; `dispatched` marks
  in_progress; `### Task 3b:` parses with its own steps.
- `hooks/register.test.ts`: a running `Review Task 2` agent puts `review` on the current line.
- `claude plugin test .` passes.

## Left to the builder

- Exact highlight colors and gap length.
- Version bump (minor: 0.9.0) and README line for the phase.

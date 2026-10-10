# claude-task-progress

Claude Code mod: a pane docked to the right of the transcript that monitors any session, with a separate section for the superpowers workflow. Sections with nothing to show stay hidden.

1. **main** — model, working/idle, effort, permission mode, request count, context gauge (⟲ compactions), cost and rate limits (layout from [Flightdeck](https://github.com/scasella/claude-flightdeck), MIT)
2. **⚡ SUPERPOWERS** — shows once a superpowers skill runs (or a superpowers plan is opened):
   - the path brainstorming chose (`SPIKE` / `BOUNDED` / `ARCHITECTURAL`, read from its reply; a spec or plan makes it architectural)
   - the pipeline `✓brainstorm ✓spec ✓plan ●execute ○review ○finish`, shaped by the path; `worktree` joins once reached, and done stages fold into `✓…` when the pane is narrow
   - the plan's progress bar and current task (`docs/superpowers/plans/*.md`, `### Task N:` headings, completed by the SDD ledger or ticked steps), and when it all finished
   - SDD's agents by role: `impl #4  Haiku 5.5 01:12`, `review #3  approved 00:41` (`⚠ … issues` when the review wants fixes)
   - extras used along the way: `+ tdd  + debugging  + verification`
3. **TASKS** — todos (TodoWrite / TaskCreate), else a plan-mode plan (`~/.claude/plans/*.md`, its `- [ ]` checkboxes, else its numbered steps ticked as `1. [x]`): progress bar with `done/total · %` beside it, in-progress tasks in yellow, the current step below with its number (`▸ #2 Wiring`), and `✓ 모두 완료 · 오후 2:05` once every task is done
4. **AGENTS** — every other subagent as `1: Explore auth --- Haiku 5.5 01:23`, running ones first (⏸ when waiting on its own background work), then the latest 3 that ended (`✓` done, `✗` failed) with their final time. The header counts all agents: `2 running · 5 done · 1 failed`
5. **SKILLS** — every skill run, in order: `brainstorming → writing-plans → subagent-driven-development`
6. **ACTIVITY** — the main loop's latest 3 tool calls: `14:05 ⠹ Bash · Run tests`, `✓` once done, `✗` on error

While Claude or an agent works, spinners turn and a bright cell sweeps the in-progress part of each progress bar.

![task-progress demo](docs/images/task-progress.gif)

![task-progress screenshot](docs/images/task-progress.png)

The pane opens on session start. `/task-progress` reopens it, `/task-progress close` closes it. In a non-fullscreen terminal it sits inline above the prompt instead.

## Install

```
/plugin install task-progress --marketplace bob-park/claude-task-progress
```

Answer `y` to add the marketplace, then pick a scope.

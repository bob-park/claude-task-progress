# claude-task-progress

Claude Code mod: a pane docked to the right of the transcript with two sections:

1. **main** — model, working/idle, effort, permission mode, request count, context gauge (⟲ compactions), cost and rate limits (layout from [Flightdeck](https://github.com/scasella/claude-flightdeck), MIT)
2. **TASKS** — progress bar with `done/total · %` right next to it (in-progress tasks in yellow), and the current step on the line below

The pane opens on session start. `/task-progress` reopens it, `/task-progress close` closes it. In a non-fullscreen terminal it sits inline above the prompt instead.

## Install

```
/plugin install task-progress --marketplace bob-park/claude-task-progress
```

Answer `y` to add the marketplace, then pick a scope.

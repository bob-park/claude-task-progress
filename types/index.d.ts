export type TaskStatus = 'pending' | 'in_progress' | 'completed'

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { tasks: Record<string, TaskStatus> }
  }
}

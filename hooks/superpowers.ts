import type { Role, Sp, SpPath, Stage } from '../types'

/** Workflow order; a stage only moves forward within one cycle */
export const ORDER: Stage[] = ['brainstorm', 'spec', 'plan', 'worktree', 'execute', 'review', 'finish']

const STAGE_OF: Record<string, Stage> = {
  brainstorming: 'brainstorm',
  'writing-plans': 'plan',
  'using-git-worktrees': 'worktree',
  'subagent-driven-development': 'execute',
  'executing-plans': 'execute',
  'dispatching-parallel-agents': 'execute',
  'requesting-code-review': 'review',
  'receiving-code-review': 'review',
  'finishing-a-development-branch': 'finish',
}

const EXTRA_OF: Record<string, string> = {
  'test-driven-development': 'tdd',
  'systematic-debugging': 'debugging',
  'verification-before-completion': 'verification',
}

export const isSpecPath = (p: string) => /\/docs\/superpowers\/specs\/[^/]+\.md$/.test(p)

export const EMPTY_SP: Sp = { stages: [], extras: [], doneAt: null }

/** `superpowers:brainstorming` → `brainstorming` */
export const skillName = (skill: string) => skill.slice(skill.lastIndexOf(':') + 1)
export const stageOf = (skill: string): Stage | undefined => STAGE_OF[skillName(skill)]
export const extraOf = (skill: string): string | undefined => EXTRA_OF[skillName(skill)]

/** A stage before the current one never moves it back; after finish it starts a new cycle */
export const reach = (sp: Sp, stage: Stage): Sp => {
  const at = (s: Stage | undefined) => (s ? ORDER.indexOf(s) : -1)
  const base = sp.stages.includes('finish') && at(stage) < at('finish') ? EMPTY_SP : sp
  const stages = base.stages.includes(stage) ? base.stages : [...base.stages, stage]
  const current = at(base.current) > at(stage) ? base.current : stage
  // a spec or plan is only written for a project
  const path = stage === 'spec' || stage === 'plan' ? 'project' : base.path
  return { ...base, stages, ...(current ? { current } : {}), ...(path ? { path } : {}) }
}

export const addExtra = (sp: Sp, extra: string): Sp => (sp.extras.includes(extra) ? sp : { ...sp, extras: [...sp.extras, extra] })

// 7.0.0 sizes the work in plain words and names only a spike; 6.4.1 named three paths
const PATH_OF: Record<string, SpPath> = { spike: 'spike', bounded: 'small', architectural: 'project' }

/** The last spike (or 6.4.1 path) a reply names */
export const pathFrom = (text: string) => PATH_OF[[...text.matchAll(/\b(spike|bounded|architectural)\b/gi)].at(-1)?.[1]?.toLowerCase() ?? '']

// a small change or a spike goes through the normal workflow: only reached stages draw
const TEMPLATE: Record<SpPath, Stage[]> = {
  project: ['brainstorm', 'spec', 'plan', 'execute', 'review', 'finish'],
  small: [],
  spike: [],
}

export type Step = { stage: Stage; state: 'done' | 'current' | 'todo' }

/** The path's stages plus every stage reached, in order; before the current one counts as done */
export const pipeline = (sp: Sp): Step[] => {
  const template = sp.path ? TEMPLATE[sp.path] : []
  const at = sp.current ? ORDER.indexOf(sp.current) : -1
  return ORDER.filter(s => sp.stages.includes(s) || template.includes(s)).map(stage => {
    const i = ORDER.indexOf(stage)
    return { stage, state: i < at ? 'done' : i === at ? 'current' : 'todo' }
  })
}

/** SDD dispatches `Implement Task N: …`, `Review Task N (…)`, `Re-review Task N …`; 7.0.0 brainstorming a builder check */
export const roleOf = (description: string): Role | undefined =>
  /^implement\b/i.test(description) ? 'impl' : /review|builder/i.test(description) ? 'review' : undefined

export const taskNOf = (text: string) => /\bTask\s+(\d+)/.exec(text)?.[1]

/** A reviewer's report: `Needs fixes` / `NOT ADDRESSED` / ❌ before `Approved` / `ADDRESSED` / ✅ / a builder check's `nothing important left` */
export const verdictOf = (answer: string): 'ok' | 'issues' | undefined =>
  /needs fixes|not addressed|❌/i.test(answer) ? 'issues' : /approved|addressed|✅|nothing important left/i.test(answer) ? 'ok' : undefined

/** Joins parts; too wide drops the oldest (at most `droppable`) behind `lead` so the latest stay */
export const fitTail = (parts: string[], sep: string, width: number, lead: string, droppable = parts.length - 1) => {
  let rest = parts
  let line = rest.join(sep)
  while (line.length > width && parts.length - rest.length < droppable) {
    rest = rest.slice(1)
    line = [lead, ...rest].join(sep)
  }
  return line
}

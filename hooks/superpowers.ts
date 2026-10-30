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

export const EMPTY_SP: Sp = { stages: [], extras: [], doneAt: null, at: {} }

/** Saved before stage times (0.7) */
export const withAt = (sp: Sp): Sp => (sp.at ? sp : { ...sp, at: {} })

/** `superpowers:brainstorming` → `brainstorming` */
export const skillName = (skill: string) => skill.slice(skill.lastIndexOf(':') + 1)
export const stageOf = (skill: string): Stage | undefined => STAGE_OF[skillName(skill)]
export const extraOf = (skill: string): string | undefined => EXTRA_OF[skillName(skill)]

/** A stage before the current one never moves it back; after finish it starts a new cycle. `now` stamps a first reach */
export const reach = (sp: Sp, stage: Stage, now: number): Sp => {
  const at = (s: Stage | undefined) => (s ? ORDER.indexOf(s) : -1)
  const base = sp.stages.includes('finish') && at(stage) < at('finish') ? EMPTY_SP : withAt(sp)
  const stages = base.stages.includes(stage) ? base.stages : [...base.stages, stage]
  const current = at(base.current) > at(stage) ? base.current : stage
  // 7.0.1: a spike skips the doc and the plan, so writing one means the spike was declined
  const { path, ...rest } = base
  const keep = path && !(path === 'spike' && (stage === 'spec' || stage === 'plan')) ? { path } : {}
  return { ...rest, ...keep, stages, ...(current ? { current } : {}), at: { [stage]: now, ...base.at } }
}

/** How long each stage took: until the next one in order started, the latest until `now`. Finish never ends; a stage reached out of order has no sensible span */
export const stageTimes = (sp: Sp, now: number) => {
  const times: Partial<Record<Stage, number>> = {}
  for (const stage of sp.stages) {
    const start = sp.at[stage]
    const later = ORDER.slice(ORDER.indexOf(stage) + 1).flatMap(s => sp.at[s] ?? [])
    if (stage === 'finish' || start === undefined || later.some(t => t < start)) continue
    times[stage] = (later.length ? Math.min(...later) : now) - start
  }
  return times
}

/** The stage an agent ran in: the latest one started by its start, a tie going to the later stage. Before stage times (0.7), the current one; before the cycle, none */
export const stageOfRun = (sp: Sp, startedAt: number): Stage | undefined => {
  if (Object.keys(sp.at).length === 0) return sp.current
  let best: Stage | undefined
  for (const s of ORDER) {
    const t = sp.stages.includes(s) ? sp.at[s] : undefined
    if (t !== undefined && t <= startedAt && (best === undefined || t >= sp.at[best]!)) best = s
  }
  return best
}

export const addExtra =(sp: Sp, extra: string): Sp => (sp.extras.includes(extra) ? sp : { ...sp, extras: [...sp.extras, extra] })

// 7.0.1 sizes the work in plain words (a small change, a project) or names a spike; 6.4.1 named three paths
const PATH_OF: Record<string, SpPath> = { spike: 'spike', 'small change': 'small', '작은 변경': 'small', 'a project': 'project', bounded: 'small', architectural: 'project' }

/** The size a reply names; a bare `프로젝트` is too common to count, and a reply naming small and project both says neither */
export const pathFrom = (text: string): SpPath | undefined => {
  const named = [...text.matchAll(/\b(spike|small change|a project(?![-\w])|bounded|architectural)\b|(작은 변경)/gi)].map(m => PATH_OF[m.slice(1).find(Boolean)!.toLowerCase()]!)
  return named.includes('small') && named.includes('project') ? undefined : named.at(-1)
}

const SIZE: SpPath[] = ['spike', 'small', 'project']
/** 7.0.1 steps a size up when the work grows, never down */
export const sizeUp = (cur: SpPath | undefined, next: SpPath) => (cur && SIZE.indexOf(cur) > SIZE.indexOf(next) ? cur : next)

// a small change and a project both go through the plan workflow; a spike draws only reached stages
const FULL: Stage[] = ['brainstorm', 'spec', 'plan', 'execute', 'review', 'finish']
// an unsized cycle that wrote a spec or a plan is on the plan workflow too
const template = (sp: Sp) => ((sp.path ? sp.path !== 'spike' : sp.stages.some(s => s === 'spec' || s === 'plan')) ? FULL : [])

export type Step = { stage: Stage; state: 'done' | 'current' | 'todo' }

/** The path's stages plus every stage reached, in order; before the current one counts as done */
export const pipeline = (sp: Sp): Step[] => {
  const full = template(sp)
  const at = sp.current ? ORDER.indexOf(sp.current) : -1
  return ORDER.filter(s => sp.stages.includes(s) || full.includes(s)).map(stage => {
    const i = ORDER.indexOf(stage)
    return { stage, state: i < at ? 'done' : i === at ? 'current' : 'todo' }
  })
}

/** SDD dispatches `Implement Task N: …`, `Fix …`, `Review Task N (…)`, `Re-review Task N …`; 7.0.0 brainstorming a builder check */
export const roleOf = (description: string): Role | undefined =>
  /^(implement|fix)\b/i.test(description) ? 'impl' : /review|builder/i.test(description) ? 'review' : undefined

export const taskNOf = (text: string) => /\btask\s+(\d+)/i.exec(text)?.[1]

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

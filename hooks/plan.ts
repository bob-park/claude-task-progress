import type { Task } from '../types'

const TASK_HEADING = /^###\s+Task\s+(\d+):\s*(.+)$/
const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/
const NUMBERED = /^\d+\.\s+(?:\[([ xX])\]\s+)?(.+)$/

const clean = (s: string) => s.replace(/\*\*/g, '').trim()

/** Plan lines outside fenced code blocks: plans quote templates inside fences */
const planLines = (text: string) => {
  let fenced = false
  return text.split(/\r?\n/).filter(l => {
    if (l.trimStart().startsWith('```')) fenced = !fenced
    else return !fenced
    return false
  })
}

export const isPlanPath = (p: string) => /\/(docs\/superpowers\/plans|\.claude\/plans)\/[^/]+\.md$/.test(p)

/** The SDD ledger beside a superpowers plan; null for any other plan */
export const ledgerPath = (planPath: string) => {
  const m = /^(.*)\/docs\/superpowers\/plans\/([^/]+)\.md$/.exec(planPath)
  return m ? `${m[1]}/.superpowers/sdd/${m[2]}/progress.md` : null
}

/** A ledger's first line names the plan it tracks */
export const ledgerOwns = (planPath: string, ledger: string) =>
  (ledger.split(/\r?\n/, 1)[0] ?? '').includes(planPath.slice(planPath.lastIndexOf('/') + 1))

/** Done items first get their status; the first open one is current once anything has started */
const withCurrent = (items: Array<{ label: string; done: boolean }>, started: boolean): Task[] => {
  const current = items.findIndex(i => !i.done)
  return items.map((i, n) => ({
    status: i.done ? 'completed' : started && n === current ? 'in_progress' : 'pending',
    label: i.label,
  }))
}

export const parsePlan = (text: string, ledger?: string): Task[] => {
  const lines = planLines(text)

  // superpowers: `### Task N:` headings, steps beneath, ledger lines `Task N: complete`
  const tasks: Array<{ n: string; label: string; steps: boolean[] }> = []
  for (const line of lines) {
    const h = TASK_HEADING.exec(line)
    if (h) tasks.push({ n: h[1]!, label: clean(h[2]!), steps: [] })
    else {
      const c = CHECKBOX.exec(line)
      if (c) tasks.at(-1)?.steps.push(c[1] !== ' ')
    }
  }
  if (tasks.length > 0) {
    const logged = new Set([...(ledger ?? '').matchAll(/^Task (\d+): complete/gm)].map(m => m[1]))
    const started = logged.size > 0 || tasks.some(t => t.steps.some(Boolean))
    return withCurrent(
      tasks.map(t => ({ label: t.label, done: logged.has(t.n) || (t.steps.length > 0 && t.steps.every(Boolean)) })),
      started,
    )
  }

  // plan mode: checkboxes, else top-level numbered items (ticked as `1. [x]`)
  const items = lines.map(l => CHECKBOX.exec(l)).filter(m => m !== null).map(m => ({ label: clean(m[2]!), done: m[1] !== ' ' }))
  if (items.length > 0) return withCurrent(items, items.some(i => i.done))
  const numbered = lines.map(l => NUMBERED.exec(l)).filter(m => m !== null).map(m => ({ label: clean(m[2]!), done: !!m[1] && m[1] !== ' ' }))
  return withCurrent(numbered, numbered.some(i => i.done))
}

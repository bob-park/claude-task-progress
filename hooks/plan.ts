import type { Task } from '../types'

const TASK_HEADING = /^###\s+Task\s+(\d+[a-zA-Z]?):\s*(.+)$/
const CHECKBOX = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/
const NUMBERED = /^(\d+)\.\s+(?:\[([ xX])\]\s+)?(.+)$/

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
const withCurrent = (items: Array<{ label: string; done: boolean; n?: string }>, started: boolean): Task[] => {
  const current = items.findIndex(i => !i.done)
  return items.map((i, k) => ({
    status: i.done ? 'completed' : started && k === current ? 'in_progress' : 'pending',
    label: i.label,
    ...(i.n ? { n: i.n } : {}),
  }))
}

/** Re-read plan keeps what was done: finishing a branch drops the SDD ledger */
export const keepCompleted = (prev: Task[], next: Task[]): Task[] => {
  const done = new Set(prev.filter(t => t.status === 'completed').map(t => t.label))
  // the ledger already named what runs now (dispatched): keep it, only carry done over
  if (next.some(t => t.status === 'in_progress' && !done.has(t.label))) return next.map(t => (done.has(t.label) ? { ...t, status: 'completed' as const } : t))
  return withCurrent(
    next.map(t => ({ label: t.label, n: t.n, done: t.status === 'completed' || done.has(t.label) })),
    next.some(t => t.status !== 'pending') || next.some(t => done.has(t.label)),
  )
}

export const parsePlan = (text: string, ledger?: string): Task[] => {
  const lines = planLines(text)

  // superpowers: `### Task N:` headings (a task added mid-run reads `3b`), steps beneath; 7.0.1 ledger lines may be list items: `- Task N: complete`, `- Task N: dispatched`
  const tasks: Array<{ n: string; label: string; steps: boolean[] }> = []
  for (const line of lines) {
    const h = TASK_HEADING.exec(line)
    if (h) tasks.push({ n: h[1]!.toLowerCase(), label: clean(h[2]!), steps: [] })
    else {
      const c = CHECKBOX.exec(line)
      if (c) tasks.at(-1)?.steps.push(c[1] !== ' ')
    }
  }
  if (tasks.length > 0) {
    const lines = [...(ledger ?? '').matchAll(/^[\s>*+-]*(?:\*\*)?Task\s+(\d+[a-z]?):\s*(complete(?=\s*(?:[(*.]|$))|dispatched\b)/gim)]
    const logged = new Set(lines.filter(m => m[2]!.toLowerCase() === 'complete').map(m => m[1]!.toLowerCase()))
    const items = tasks.map(t => ({ label: t.label, n: t.n, done: logged.has(t.n) || (t.steps.length > 0 && t.steps.every(Boolean)) }))
    // a dispatched task still open is what runs now; several when dispatched in parallel
    const running = new Set(lines.filter(m => m[2]!.toLowerCase() === 'dispatched').map(m => m[1]!.toLowerCase()).filter(n => items.some(i => i.n === n && !i.done)))
    if (running.size > 0)
      return items.map(i => ({ status: i.done ? 'completed' : running.has(i.n) ? 'in_progress' : 'pending', label: i.label, n: i.n }))
    return withCurrent(items, logged.size > 0 || tasks.some(t => t.steps.some(Boolean)))
  }

  // plan mode: checkboxes, else top-level numbered items (ticked as `1. [x]`)
  const items = lines.map(l => CHECKBOX.exec(l)).filter(m => m !== null).map(m => ({ label: clean(m[2]!), done: m[1] !== ' ' }))
  if (items.length > 0) return withCurrent(items, items.some(i => i.done))
  const numbered = lines.map(l => NUMBERED.exec(l)).filter(m => m !== null).map(m => ({ label: clean(m[3]!), n: m[1]!, done: !!m[2] && m[2] !== ' ' }))
  return withCurrent(numbered, numbered.some(i => i.done))
}

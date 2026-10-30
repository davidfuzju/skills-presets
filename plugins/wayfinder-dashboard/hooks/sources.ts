/**
 * Where a repo's Wayfinder maps live, and reading them from there.
 *
 * The tracker is resolved exactly as /mattpocock-skills:wayfinder resolves it:
 * `docs/agents/issue-tracker.md` (written by /setup-matt-pocock-skills) names
 * it, and with no such file the skill defaults to local markdown, so this does
 * too. Remote trackers are read through the person's own `gh` / `glab`, which
 * already hold their login: the mod keeps no token and makes no network call
 * of its own.
 */

import type { EngineInterface } from 'claude-code'

import { blockedByLine, parseMap, parseTicket, questionOf, typeOf } from './tracker'
import type { Snapshot, Ticket } from './tracker'

export type TrackerKind = 'local' | 'github' | 'gitlab'

export type ReadResult = { kind: TrackerKind; snapshots: Snapshot[] } | { kind: TrackerKind; error: string }

export async function detectTracker($: EngineInterface, root: string): Promise<TrackerKind> {
  const doc = await $.fs.read(`${root}/docs/agents/issue-tracker.md`).catch(() => null)
  if (typeof doc !== 'string') return 'local'
  const heading = (/^#\s+(.+)$/m.exec(doc)?.[1] ?? '').toLowerCase()
  if (heading.includes('github')) return 'github'
  if (heading.includes('gitlab')) return 'gitlab'
  if (heading.includes('local')) return 'local'
  // A hand-written tracker doc: go by the commands it tells the skill to run.
  if (/\bglab\s/.test(doc)) return 'gitlab'
  if (/\bgh\s+(issue|api)\b/.test(doc)) return 'github'
  return 'local'
}

// ---------------------------------------------------------------------------
// Local markdown: .scratch/<effort>/map.md + issues/NN-slug.md
// ---------------------------------------------------------------------------

export async function readLocal($: EngineInterface, root: string, localRoot: string): Promise<Snapshot[]> {
  const scratch = `${root}/${localRoot}`
  const out: Snapshot[] = []
  for (const effort of await $.fs.list(scratch).catch(() => [])) {
    if (effort.kind !== 'dir') continue
    const dir = `${scratch}/${effort.name}`
    const map = await $.fs.read(`${dir}/map.md`).catch(() => null)
    if (typeof map !== 'string') continue
    const tickets: Ticket[] = []
    for (const file of await $.fs.list(`${dir}/issues`).catch(() => [])) {
      if (file.kind !== 'file') continue
      const text = await $.fs.read(`${dir}/issues/${file.name}`).catch(() => null)
      const ticket = typeof text === 'string' ? parseTicket(file.name, text) : null
      if (ticket !== null) tickets.push(ticket)
    }
    out.push(parseMap(effort.name, effort.name, map, tickets, 'local'))
  }
  return out
}

// ---------------------------------------------------------------------------
// Remote trackers, through the CLI the person is logged in with
// ---------------------------------------------------------------------------

async function cli($: EngineInterface, root: string, argv: string[]): Promise<unknown> {
  const run = await $.process.run(argv, { cwd: root, timeoutMs: 30_000 })
  if (run.exitCode !== 0) throw new Error((run.stderr || run.stdout).trim().split('\n')[0] || `${argv[0]} exited ${run.exitCode}`)
  return JSON.parse(run.stdout)
}

const TICKET_LABELS = ['wayfinder:grilling', 'wayfinder:prototype', 'wayfinder:research', 'wayfinder:task']

/** `Part of #12` at the top of a child body: the fallback parent link. */
const partOf = (body: string) => /^\s*Part of\s+#(\d+)/im.exec(body)?.[1]

// GitHub: one GraphQL query per refresh. `labels` matches ANY of the names, so
// the maps and every ticket come back together; sub-issues give the parent,
// issue dependencies give the edges, the last comment is the answer.
const GITHUB_QUERY = `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){
maps:issues(first:20,labels:["wayfinder:map"],states:[OPEN],orderBy:{field:UPDATED_AT,direction:DESC}){nodes{number title body}}
tickets:issues(first:100,labels:${JSON.stringify(TICKET_LABELS)},states:[OPEN,CLOSED],orderBy:{field:UPDATED_AT,direction:DESC}){nodes{
number title body state stateReason parent{number} labels(first:10){nodes{name}} assignees(first:1){totalCount}
blockedBy(first:20){nodes{number}} comments(last:1){nodes{body}}}}}}`

type GitHubIssue = {
  number: number
  title: string
  body: string
  state: 'OPEN' | 'CLOSED'
  stateReason: string | null
  parent: { number: number } | null
  labels: { nodes: { name: string }[] }
  assignees: { totalCount: number }
  blockedBy: { nodes: { number: number }[] }
  comments: { nodes: { body: string }[] }
}

let githubRepo: { root: string; owner: string; name: string } | null = null

export async function readGitHub($: EngineInterface, root: string): Promise<Snapshot[]> {
  if (githubRepo?.root !== root) {
    const repo = (await cli($, root, ['gh', 'repo', 'view', '--json', 'owner,name'])) as { owner: { login: string }; name: string }
    githubRepo = { root, owner: repo.owner.login, name: repo.name }
  }
  const { owner, name } = githubRepo
  const data = (await cli($, root, ['gh', 'api', 'graphql', '-F', `owner=${owner}`, '-F', `name=${name}`, '-f', `query=${GITHUB_QUERY}`])) as {
    data: { repository: { maps: { nodes: { number: number; title: string; body: string }[] }; tickets: { nodes: GitHubIssue[] } } }
  }
  const { maps, tickets } = data.data.repository
  return maps.nodes.map((map) => {
    const children = tickets.nodes.filter((t) => (t.parent?.number ?? Number(partOf(t.body ?? ''))) === map.number)
    const parsed: Ticket[] = children.map((t) => ({
      id: `#${t.number}`,
      title: t.title,
      type: typeOf(t.labels.nodes.map((l) => l.name).find((l) => l.startsWith('wayfinder:'))),
      state:
        t.state === 'CLOSED'
          ? t.stateReason === 'NOT_PLANNED'
            ? 'out-of-scope'
            : 'resolved'
          : t.assignees.totalCount > 0
            ? 'claimed'
            : 'open',
      blockedBy: [...new Set([...t.blockedBy.nodes.map((b) => `#${b.number}`), ...blockedByLine(t.body ?? '')])],
      question: questionOf(t.body ?? ''),
      answer: t.state === 'CLOSED' ? (t.comments.nodes[0]?.body ?? '') : '',
    }))
    return parseMap(`#${map.number}`, `#${map.number} ${map.title}`, map.body ?? '', parsed, 'issue')
  })
}

// GitLab (REST through `glab api`, which fills `:id` from the repo's remote).
// Blocking links are Premium; CE repos carry the `Blocked by:` line instead,
// so both are read. Links and the closing note cost a call per ticket, so they
// are fetched again only when that ticket's `updated_at` moves.

type GitLabIssue = {
  iid: number
  title: string
  description: string | null
  state: 'opened' | 'closed'
  labels: string[]
  assignees: unknown[]
  updated_at: string
}

const gitlabDetail = new Map<string, { updatedAt: string; blockers: string[]; answer: string }>()

export async function readGitLab($: EngineInterface, root: string): Promise<Snapshot[]> {
  const list = (query: string) => cli($, root, ['glab', 'api', `projects/:id/issues?per_page=100&${query}`]) as Promise<GitLabIssue[]>
  const maps = await list(`labels=${encodeURIComponent('wayfinder:map')}&state=opened`)
  if (maps.length === 0) return []
  const byIid = new Map<number, GitLabIssue>()
  for (const label of TICKET_LABELS) {
    for (const t of await list(`labels=${encodeURIComponent(label)}&state=all`)) byIid.set(t.iid, t)
  }

  const detail = async (t: GitLabIssue) => {
    const cacheKey = `${root}#${t.iid}`
    const cached = gitlabDetail.get(cacheKey)
    if (cached?.updatedAt === t.updated_at) return cached
    const links = (await cli($, root, ['glab', 'api', `projects/:id/issues/${t.iid}/links`]).catch(() => [])) as {
      iid: number
      link_type: string
    }[]
    let answer = ''
    if (t.state === 'closed') {
      const notes = (await cli($, root, ['glab', 'api', `projects/:id/issues/${t.iid}/notes?sort=desc&order_by=created_at&per_page=20`]).catch(
        () => [],
      )) as { body: string; system: boolean }[]
      answer = notes.find((n) => !n.system)?.body ?? ''
    }
    const fresh = {
      updatedAt: t.updated_at,
      blockers: links.filter((l) => l.link_type === 'is_blocked_by').map((l) => `#${l.iid}`),
      answer,
    }
    gitlabDetail.set(cacheKey, fresh)
    return fresh
  }

  const out: Snapshot[] = []
  for (const map of maps) {
    const tickets: Ticket[] = []
    for (const t of byIid.values()) {
      if (Number(partOf(t.description ?? '')) !== map.iid) continue
      const d = await detail(t)
      const body = t.description ?? ''
      tickets.push({
        id: `#${t.iid}`,
        title: t.title,
        type: typeOf(t.labels.find((l) => l.startsWith('wayfinder:'))),
        state: t.state === 'closed' ? 'resolved' : t.assignees.length > 0 ? 'claimed' : 'open',
        blockedBy: [...new Set([...d.blockers, ...blockedByLine(body)])],
        question: questionOf(body),
        answer: d.answer,
      })
    }
    out.push(parseMap(`#${map.iid}`, `#${map.iid} ${map.title}`, map.description ?? '', tickets, 'issue'))
  }
  return out
}

export async function readTracker($: EngineInterface, root: string, kind: TrackerKind, localRoot: string): Promise<ReadResult> {
  try {
    const snapshots =
      kind === 'github' ? await readGitHub($, root) : kind === 'gitlab' ? await readGitLab($, root) : await readLocal($, root, localRoot)
    return { kind, snapshots }
  } catch (error) {
    return { kind, error: error instanceof Error ? error.message : String(error) }
  }
}

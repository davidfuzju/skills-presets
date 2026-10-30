/**
 * The tracker-neutral model of a Wayfinder map, and the parsing every tracker
 * shares: the map body's sections and the ticket body conventions that
 * /mattpocock-skills:wayfinder writes on any tracker. Reading the local
 * markdown files lives here too; GitHub and GitLab are in sources.ts.
 *
 * Read-only: the skill owns every write. This only turns what it wrote into a
 * Snapshot the dashboard can draw and diff.
 */

export type TicketType = 'grilling' | 'prototype' | 'research' | 'task' | 'unknown'
export type TicketState = 'open' | 'claimed' | 'resolved' | 'out-of-scope'

export type Ticket = {
  id: string
  title: string
  type: TicketType
  state: TicketState
  blockedBy: string[]
  question: string
  answer: string
}

export type Snapshot = {
  /** Stable identity within the tracker: the effort directory, or `#<map issue>`. */
  key: string
  /** What the Start node shows: the effort name, or the map issue's title. */
  label: string
  destination: string
  fog: string
  tickets: Ticket[]
}

const TYPES = new Set(['grilling', 'prototype', 'research', 'task'])

/** `## Heading` sections, keyed by lowercased heading. HTML comments dropped. */
export function sections(markdown: string): Map<string, string> {
  const out = new Map<string, string>()
  const text = markdown.replace(/<!--[\s\S]*?-->/g, '')
  const parts = text.split(/^##\s+/m)
  for (const part of parts.slice(1)) {
    const newline = part.indexOf('\n')
    const heading = (newline < 0 ? part : part.slice(0, newline)).trim().toLowerCase()
    out.set(heading, (newline < 0 ? '' : part.slice(newline + 1)).trim())
  }
  return out
}

/** Ticket numbers are compared as numbers: `1`, `01` and `001` are one ticket. */
export function ticketId(raw: string): string {
  return String(Number(raw)).padStart(2, '0')
}

function headerLine(markdown: string, name: string): string | undefined {
  const head = markdown.split(/^##\s+/m)[0] ?? ''
  const match = new RegExp(`^\\s*\\**${name}\\**\\s*:\\s*(.*)$`, 'im').exec(head)
  return match?.[1]?.trim()
}

export function parseTicket(fileName: string, markdown: string): Ticket | null {
  const named = /^(\d+)-(.+)\.md$/.exec(fileName)
  if (named === null) return null
  const [, number = '0', slug = ''] = named
  const body = sections(markdown)
  const heading = /^#\s+(.+)$/m.exec(markdown)?.[1]?.trim()
  const status = (headerLine(markdown, 'Status') ?? '').toLowerCase()
  const blocked = headerLine(markdown, 'Blocked by') ?? ''
  return {
    id: ticketId(number),
    title: heading ?? slug.replace(/[-_]+/g, ' '),
    type: typeOf(headerLine(markdown, 'Type')),
    state: status.startsWith('resolved') ? 'resolved' : status.startsWith('claimed') ? 'claimed' : 'open',
    blockedBy: [...blocked.matchAll(/\d+/g)].map((m) => ticketId(m[0])),
    question: body.get('question') ?? '',
    answer: body.get('answer') ?? '',
  }
}

/** Issue references in a body: `#12`, or the local tracker's `issues/12-slug`. */
export function issueRefs(text: string, style: 'local' | 'issue'): string[] {
  return style === 'local'
    ? [...text.matchAll(/issues\/(\d+)-/g)].map((m) => ticketId(m[1] ?? '0'))
    : [...text.matchAll(/#(\d+)/g)].map((m) => `#${m[1]}`)
}

/** The `Blocked by: #3, #4` line a tracker without native blocking falls back to. */
export function blockedByLine(markdown: string): string[] {
  return issueRefs(headerLine(markdown, 'Blocked by') ?? '', 'issue')
}

/** `Type:` header line, or the `wayfinder:<type>` label a remote ticket carries. */
export function typeOf(raw: string | undefined): TicketType {
  const type = (raw ?? '').toLowerCase().replace(/^wayfinder:/, '')
  return TYPES.has(type) ? (type as TicketType) : 'unknown'
}

/** The `## Question` section, or the whole body when the ticket has none. */
export function questionOf(markdown: string): string {
  return sections(markdown).get('question') ?? markdown.replace(/^.*(Part of|Blocked by)\s*:?.*$/gim, '').trim()
}

const order = (id: string) => Number(id.replace(/^#/, ''))

export function parseMap(
  key: string,
  label: string,
  mapMarkdown: string,
  tickets: Ticket[],
  refStyle: 'local' | 'issue',
): Snapshot {
  const body = sections(mapMarkdown)
  const ruledOut = new Set(issueRefs(body.get('out of scope') ?? '', refStyle))
  return {
    key,
    label,
    destination: body.get('destination') ?? '',
    fog: body.get('not yet specified') ?? '',
    tickets: tickets
      .map((t) => (ruledOut.has(t.id) && t.state !== 'open' && t.state !== 'claimed' ? { ...t, state: 'out-of-scope' as const } : t))
      .sort((a, b) => order(a.id) - order(b.id)),
  }
}

/** What a reader sees on the board: the stored state plus the derived gate. */
export type Display = 'frontier' | 'blocked' | 'claimed' | 'resolved' | 'out-of-scope'

export function displayOf(ticket: Ticket, byId: Map<string, Ticket>): Display {
  if (ticket.state !== 'open') return ticket.state
  const isBlocked = ticket.blockedBy.some((id) => byId.get(id)?.state !== 'resolved')
  return isBlocked ? 'blocked' : 'frontier'
}

/** Whether the map has reached its destination: no fog, nothing left to decide. */
export function isComplete(snapshot: Snapshot): boolean {
  return (
    snapshot.fog.trim().length === 0 &&
    snapshot.tickets.length > 0 &&
    snapshot.tickets.every((t) => t.state === 'resolved' || t.state === 'out-of-scope')
  )
}

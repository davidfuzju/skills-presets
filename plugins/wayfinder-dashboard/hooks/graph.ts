/**
 * Diff two snapshots and draw them as one directed graph.
 *
 * The layout is computed over the UNION of before and after, so every node
 * keeps its place across the two views: toggling (or the animation) changes
 * only what actually changed, which is what makes the change findable on a
 * large map.
 */

import { displayOf, isComplete } from './tracker'
import type { Display, Snapshot, Ticket } from './tracker'

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export type Change =
  | { kind: 'added'; id: string; title: string }
  | { kind: 'removed'; id: string; title: string }
  | { kind: 'state'; id: string; title: string; from: Display; to: Display }
  | { kind: 'retitled'; id: string; from: string; to: string }
  | { kind: 'edge-added'; from: string; to: string }
  | { kind: 'edge-removed'; from: string; to: string }
  | { kind: 'destination' }
  | { kind: 'fog' }

const edgesOf = (s: Snapshot | null) =>
  new Set((s?.tickets ?? []).flatMap((t) => t.blockedBy.map((b) => `${b}>${t.id}`)))

export function displays(s: Snapshot | null): Map<string, Display> {
  const byId = new Map((s?.tickets ?? []).map((t) => [t.id, t]))
  return new Map([...byId.values()].map((t) => [t.id, displayOf(t, byId)]))
}

export function diff(before: Snapshot | null, after: Snapshot): Change[] {
  const out: Change[] = []
  const was = new Map((before?.tickets ?? []).map((t) => [t.id, t]))
  const now = new Map(after.tickets.map((t) => [t.id, t]))
  const wasShown = displays(before)
  const nowShown = displays(after)

  if (before !== null && before.destination !== after.destination) out.push({ kind: 'destination' })
  if (before !== null && before.fog !== after.fog) out.push({ kind: 'fog' })
  for (const t of after.tickets) {
    const old = was.get(t.id)
    if (old === undefined) {
      out.push({ kind: 'added', id: t.id, title: t.title })
      continue
    }
    if (old.title !== t.title) out.push({ kind: 'retitled', id: t.id, from: old.title, to: t.title })
    const from = wasShown.get(t.id) as Display
    const to = nowShown.get(t.id) as Display
    if (from !== to) out.push({ kind: 'state', id: t.id, title: t.title, from, to })
  }
  for (const t of before?.tickets ?? []) {
    if (!now.has(t.id)) out.push({ kind: 'removed', id: t.id, title: t.title })
  }
  const edgesBefore = edgesOf(before)
  const edgesAfter = edgesOf(after)
  for (const e of edgesAfter) {
    const [from = '', to = ''] = e.split('>')
    if (!edgesBefore.has(e) && was.has(to)) out.push({ kind: 'edge-added', from, to })
  }
  for (const e of edgesBefore) {
    const [from = '', to = ''] = e.split('>')
    if (!edgesAfter.has(e) && now.has(to)) out.push({ kind: 'edge-removed', from, to })
  }
  return out
}

export const DISPLAY_LABEL: Record<Display, string> = {
  frontier: '可决',
  blocked: '被挡',
  claimed: '进行中',
  resolved: '已决',
  'out-of-scope': '范围外',
}

export function describe(change: Change): string {
  switch (change.kind) {
    case 'added':
      return `+ 新增 ${change.id} ${change.title}`
    case 'removed':
      return `− 删除 ${change.id} ${change.title}`
    case 'state':
      return `~ ${change.id} ${change.title}：${DISPLAY_LABEL[change.from]} → ${DISPLAY_LABEL[change.to]}`
    case 'retitled':
      return `~ ${change.id} 改名：${change.from} → ${change.to}`
    case 'edge-added':
      return `+ 依赖 ${change.from} → ${change.to}`
    case 'edge-removed':
      return `− 依赖 ${change.from} → ${change.to}`
    case 'destination':
      return '~ 目的地改写'
    case 'fog':
      return '~ 迷雾（Not yet specified）改写'
  }
}

// ---------------------------------------------------------------------------
// Layout over the union of before and after
// ---------------------------------------------------------------------------

const W = 200
const H = 66
const GAP_X = 28
const GAP_Y = 54
const PAD = 24

type Box = { x: number; y: number }

export type Layout = {
  width: number
  height: number
  ticket: Map<string, Box>
  start: Box
  fog: Box
  destination: Box
}

export function layout(before: Snapshot | null, after: Snapshot): Layout {
  const tickets = new Map<string, Ticket>()
  for (const t of before?.tickets ?? []) tickets.set(t.id, t)
  for (const t of after.tickets) tickets.set(t.id, t)
  const parents = new Map<string, Set<string>>()
  for (const s of [before, after]) {
    for (const t of s?.tickets ?? []) {
      const set = parents.get(t.id) ?? new Set<string>()
      for (const b of t.blockedBy) if (tickets.has(b)) set.add(b)
      parents.set(t.id, set)
    }
  }

  // Longest-path depth; a cycle's back edge counts as depth 0.
  const depth = new Map<string, number>()
  const visiting = new Set<string>()
  const walk = (id: string): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    if (visiting.has(id)) return 0
    visiting.add(id)
    let best = 0
    for (const p of parents.get(id) ?? []) best = Math.max(best, walk(p) + 1)
    visiting.delete(id)
    depth.set(id, best)
    return best
  }
  const ids = [...tickets.keys()].sort((a, b) => Number(a) - Number(b))
  for (const id of ids) walk(id)

  const layers: string[][] = []
  for (const id of ids) (layers[depth.get(id) ?? 0] ??= []).push(id)

  // Order each layer by the mean position of its parents, so edges cross less.
  const order = new Map<string, number>()
  layers.forEach((layer, i) => {
    if (i > 0) {
      const mean = (id: string) => {
        const ps = [...(parents.get(id) ?? [])].map((p) => order.get(p) ?? 0)
        return ps.length === 0 ? Number.POSITIVE_INFINITY : ps.reduce((a, b) => a + b, 0) / ps.length
      }
      layer.sort((a, b) => mean(a) - mean(b) || Number(a) - Number(b))
    }
    layer.forEach((id, j) => order.set(id, j))
  })

  const widest = Math.max(2, ...layers.map((l) => l.length))
  const width = PAD * 2 + widest * W + (widest - 1) * GAP_X
  const rowY = (row: number) => PAD + row * (H + GAP_Y)
  const centred = (count: number, j: number) => (width - (count * W + (count - 1) * GAP_X)) / 2 + j * (W + GAP_X)

  const ticket = new Map<string, Box>()
  layers.forEach((layer, i) => layer.forEach((id, j) => ticket.set(id, { x: centred(layer.length, j), y: rowY(i + 1) })))
  const last = rowY(layers.length + 1)
  return {
    width,
    height: last + H + PAD,
    ticket,
    start: { x: centred(1, 0), y: rowY(0) },
    fog: { x: centred(2, 0), y: last },
    destination: { x: centred(2, 1), y: last },
  }
}

// ---------------------------------------------------------------------------
// SVG: one graph that carries both sides
//
// The after state is drawn as the map stands, and every difference from the
// before state is written onto it: a removed ticket stays as a ghost in its
// old place, a ticket whose state moved keeps its old state as a stripe and a
// chip ("可决→已决"), a removed edge stays as a red dashed line. On load the
// changes pulse once, so the eye lands on them without a second picture.
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const charWidth = (ch: string) => (/[⺀-￿]/.test(ch) ? 13 : 7)

/** Wrap to at most `lines` lines of about `max` px; CJK counts double. */
function wrap(text: string, max: number, lines: number): string[] {
  const out: string[] = []
  let line = ''
  let width = 0
  for (const ch of text.replace(/\s+/g, ' ').trim()) {
    const w = charWidth(ch)
    if (width + w > max) {
      out.push(line)
      if (out.length === lines) {
        out[lines - 1] = `${(out[lines - 1] ?? '').slice(0, -1)}…`
        return out
      }
      line = ''
      width = 0
    }
    line += ch
    width += w
  }
  if (line.length > 0) out.push(line)
  return out
}

const STYLE = `
.bg{fill:#fbfaf7}.ink{fill:#1f1f1c}.muted{fill:#77746c}.edge{stroke:#b9b5aa;fill:none;stroke-width:1.3}
.n-frontier{fill:#ffffff;stroke:#2f6fde;stroke-width:1.6}.n-blocked{fill:#f1efe9;stroke:#c3bfb3}
.n-claimed{fill:#fff6e2;stroke:#c98a16;stroke-width:1.4}.n-resolved{fill:#e7f2ea;stroke:#3a7d55;stroke-width:1.4}
.n-out-of-scope{fill:#f3f2ee;stroke:#c3bfb3;stroke-dasharray:4 3}.n-story{fill:#efede6;stroke:#c3bfb3}
.n-fog{fill:#efede6;stroke:#c3bfb3;stroke-dasharray:4 3}
.s-frontier{fill:#2f6fde}.s-blocked{fill:#a9a59a}.s-claimed{fill:#c98a16}.s-resolved{fill:#3a7d55}.s-out-of-scope{fill:#c3bfb3}
.ring{fill:none;stroke-width:3}.r-add{stroke:#1e9e5a}.r-chg{stroke:#e08a00}.r-del{stroke:#d64545;stroke-dasharray:6 4}
.e-add{stroke:#1e9e5a;stroke-width:2}.e-del{stroke:#d64545;stroke-dasharray:5 4;stroke-width:1.6}
.c-add{fill:#1e9e5a}.c-chg{fill:#e08a00}.c-del{fill:#d64545}.chip{fill:#fff;font-size:11px;font-weight:600}
.ghost{opacity:.4}
text{font:12px ui-sans-serif,system-ui,-apple-system,"PingFang SC",sans-serif}.t{font-size:13px;font-weight:500}.s{font-size:11px}
@media (prefers-color-scheme:dark){
.bg{fill:#1b1b19}.ink{fill:#ecebe6}.muted{fill:#9b988f}.edge{stroke:#55534c}
.n-frontier{fill:#20242c;stroke:#6d9cf0}.n-blocked{fill:#262622;stroke:#4a4842}.n-claimed{fill:#2c2618;stroke:#d9a03a}
.n-resolved{fill:#1d2a21;stroke:#5fae7c}.n-out-of-scope{fill:#22221f;stroke:#4a4842}.n-story,.n-fog{fill:#262622;stroke:#4a4842}
.s-frontier{fill:#6d9cf0}.s-resolved{fill:#5fae7c}.s-claimed{fill:#d9a03a}.s-blocked,.s-out-of-scope{fill:#5d5a52}}
`

const pulse = `<animate attributeName="stroke-opacity" values="0;1;0.25;1" dur="1.6s" fill="freeze"/>`
const fade = (from: number, to: number) =>
  `<animate attributeName="opacity" from="${from}" to="${to}" begin="0.2s" dur="0.8s" fill="freeze"/>`

const MARKER = (id: string, cls: string) =>
  `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="${cls}"/></marker>`

function edgePath(a: Box, b: Box): string {
  const x1 = a.x + W / 2
  const y1 = a.y + H
  const x2 = b.x + W / 2
  const y2 = b.y
  const mid = (y1 + y2) / 2
  return `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2 - 6}`
}

/** A small label riding the node's top-right corner: what changed. */
function chip(at: Box, text: string, cls: string): string {
  const width = [...text].reduce((sum, ch) => sum + (charWidth(ch) - 1), 0) + 14
  const x = at.x + W - width - 8
  const y = at.y - 9
  return `<g><rect x="${x}" y="${y}" width="${width}" height="18" rx="9" class="${cls}"/><text x="${x + 7}" y="${y + 13}" class="chip">${esc(text)}</text></g>`
}

const ring = (at: Box, cls: string) =>
  `<rect x="${at.x - 4}" y="${at.y - 4}" width="${W + 8}" height="${H + 8}" rx="11" class="ring ${cls}">${pulse}</rect>`

function nodeBody(t: Ticket, shown: Display, at: Box, tip: string[], oldShown?: Display): string {
  const title = wrap(t.title, W - 24, 2)
  const foot = `${t.id} · ${t.type} · ${DISPLAY_LABEL[shown]}`
  const lines = [t.title, t.question && `问题：${t.question}`, t.answer && `决定：${t.answer}`, ...tip].filter(Boolean)
  // The old state stays visible as the stripe on the left edge.
  const stripe =
    oldShown === undefined
      ? ''
      : `<rect x="${at.x}" y="${at.y}" width="6" height="${H}" rx="3" class="s-${oldShown}"/>`
  return `<title>${esc(lines.join('\n\n'))}</title>
<rect x="${at.x}" y="${at.y}" width="${W}" height="${H}" rx="8" class="n-${shown}"/>${stripe}
${title.map((l, i) => `<text x="${at.x + 12}" y="${at.y + 21 + i * 16}" class="ink t"${shown === 'out-of-scope' ? ' text-decoration="line-through"' : ''}>${esc(l)}</text>`).join('')}
<text x="${at.x + 12}" y="${at.y + H - 9}" class="muted s">${esc(foot)}</text>`
}

function storyNode(at: Box, label: string, text: string, cls: string, previous?: string): string {
  const lines = wrap(text || '（未写）', W - 20, 2)
  const tip = previous === undefined ? text : `${text}\n\n之前：${previous || '（未写）'}`
  return `<g><title>${esc(tip)}</title><rect x="${at.x}" y="${at.y}" width="${W}" height="${H}" rx="8" class="${cls}"/>
<text x="${at.x + 10}" y="${at.y + 16}" class="muted s">${esc(label)}</text>
${lines.map((l, i) => `<text x="${at.x + 10}" y="${at.y + 34 + i * 15}" class="ink">${esc(l)}</text>`).join('')}</g>${
    previous === undefined ? '' : ring(at, 'r-chg') + chip(at, '改写', 'c-chg')
  }`
}

/**
 * Draw `after`, with every difference from `before` marked on it. With no
 * `before` (the first version recorded) it is simply the map.
 */
export function renderSvg(before: Snapshot | null, after: Snapshot): string {
  const L = layout(before, after)
  const was = new Map((before?.tickets ?? []).map((t) => [t.id, t]))
  const wasShown = displays(before)
  const nowShown = displays(after)
  const eBefore = edgesOf(before)
  const eAfter = edgesOf(after)
  const hasDiff = before !== null
  const parts: string[] = []
  const arrow = (cls: string) => `marker-end="url(#${cls})"`

  for (const key of new Set([...eBefore, ...eAfter])) {
    const [from = '', to = ''] = key.split('>')
    const a = L.ticket.get(from)
    const b = L.ticket.get(to)
    if (a === undefined || b === undefined) continue
    const d = edgePath(a, b)
    if (!eAfter.has(key)) parts.push(`<path d="${d}" class="edge e-del" ${arrow('m-del')}/>`)
    else if (hasDiff && !eBefore.has(key)) parts.push(`<path d="${d}" class="edge e-add" ${arrow('m-add')}>${fade(0, 1)}</path>`)
    else parts.push(`<path d="${d}" class="edge" ${arrow('m')}/>`)
  }

  // Story edges for the map as it stands: roots hang off Start; sinks point at
  // Destination when decided, otherwise into the fog.
  const complete = isComplete(after)
  const ids = new Set(after.tickets.map((t) => t.id))
  const isBlocker = new Set(after.tickets.flatMap((t) => t.blockedBy))
  for (const t of after.tickets) {
    const at = L.ticket.get(t.id)
    if (at === undefined) continue
    if (t.blockedBy.every((b) => !ids.has(b))) parts.push(`<path d="${edgePath(L.start, at)}" class="edge" ${arrow('m')}/>`)
    if (!isBlocker.has(t.id) && t.state !== 'out-of-scope') {
      const target = t.state === 'resolved' || complete ? L.destination : L.fog
      parts.push(`<path d="${edgePath(at, target)}" class="edge" stroke-dasharray="3 3" ${arrow('m')}/>`)
    }
  }

  parts.push(storyNode(L.start, '起点', after.label, 'n-story'))
  if (!complete) {
    const fogBefore = hasDiff && before.fog !== after.fog ? before.fog : undefined
    parts.push(storyNode(L.fog, '迷雾 · Not yet specified', after.fog || '下一层还没推导出来', 'n-fog', fogBefore))
  }
  const destBefore = hasDiff && before.destination !== after.destination ? before.destination : undefined
  parts.push(storyNode(L.destination, '目的地', after.destination, 'n-story', destBefore))

  const now = new Map(after.tickets.map((t) => [t.id, t]))
  for (const id of L.ticket.keys()) {
    const at = L.ticket.get(id) as Box
    const old = was.get(id)
    const cur = now.get(id)
    if (cur === undefined) {
      if (old === undefined) continue
      parts.push(
        `<g opacity="1">${fade(1, 0.4)}${nodeBody(old, wasShown.get(id) as Display, at, ['（这一版删除了它）'])}</g>` +
          ring(at, 'r-del') +
          chip(at, '已删除', 'c-del'),
      )
      continue
    }
    const shown = nowShown.get(id) as Display
    if (hasDiff && old === undefined) {
      parts.push(`<g opacity="0">${fade(0, 1)}${nodeBody(cur, shown, at, [])}${ring(at, 'r-add')}${chip(at, '新增', 'c-add')}</g>`)
      continue
    }
    const oldShown = wasShown.get(id)
    const moved = hasDiff && oldShown !== undefined && oldShown !== shown
    const renamed = hasDiff && old !== undefined && old.title !== cur.title
    const tip = [
      moved ? `状态：${DISPLAY_LABEL[oldShown as Display]} → ${DISPLAY_LABEL[shown]}` : '',
      renamed ? `原标题：${old?.title}` : '',
    ].filter(Boolean)
    parts.push(`<g>${nodeBody(cur, shown, at, tip, moved ? oldShown : undefined)}</g>`)
    if (moved || renamed) {
      const label = moved ? `${DISPLAY_LABEL[oldShown as Display]}→${DISPLAY_LABEL[shown]}` : '改名'
      parts.push(ring(at, 'r-chg') + chip(at, label, 'c-chg'))
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}">
<style>${STYLE}</style>
<defs>${MARKER('m', 'muted')}${MARKER('m-add', 'c-add')}${MARKER('m-del', 'c-del')}</defs>
<rect width="100%" height="100%" class="bg"/>
${parts.join('\n')}
</svg>`
}

// ---------------------------------------------------------------------------
// Merged graph as data, for the browser page (Cytoscape draws and animates it)
// ---------------------------------------------------------------------------

export type DiffMark = 'add' | 'chg' | 'del'

export type GraphNode = {
  id: string
  kind: 'ticket' | 'start' | 'fog' | 'destination'
  title: string
  /** `#3 · research · 可决` for a ticket; the section name for a story node. */
  sub: string
  display?: Display
  /** The state it held in the version before, when that moved. */
  from?: Display
  diff?: DiffMark
  /** What the badge says: 新增 / 已删除 / 可决→已决 / 改名 / 改写. */
  badge?: string
  type?: string
  question?: string
  answer?: string
  blockedBy?: string[]
  /** The previous title or text, when it was rewritten. */
  previous?: string
}

export type GraphEdge = { id: string; source: string; target: string; kind: 'dep' | 'story'; diff?: DiffMark }

export const START = '__start'
export const FOG = '__fog'
export const DESTINATION = '__destination'

/**
 * `after`, with every difference from `before` marked on its elements: the same
 * reading as renderSvg, as data. Removed tickets and edges stay, marked `del`.
 */
export function mergedGraph(before: Snapshot | null, after: Snapshot): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const was = new Map((before?.tickets ?? []).map((t) => [t.id, t]))
  const now = new Map(after.tickets.map((t) => [t.id, t]))
  const wasShown = displays(before)
  const nowShown = displays(after)
  const hasDiff = before !== null
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  const ticketNode = (t: Ticket, display: Display): GraphNode => ({
    id: t.id,
    kind: 'ticket',
    title: t.title,
    sub: `${t.id} · ${t.type} · ${DISPLAY_LABEL[display]}`,
    display,
    type: t.type,
    question: t.question,
    answer: t.answer,
    blockedBy: t.blockedBy,
  })

  for (const t of after.tickets) {
    const shown = nowShown.get(t.id) as Display
    const node = ticketNode(t, shown)
    const old = was.get(t.id)
    if (hasDiff && old === undefined) {
      Object.assign(node, { diff: 'add', badge: '新增' })
    } else if (old !== undefined) {
      const oldShown = wasShown.get(t.id) as Display
      if (oldShown !== shown) Object.assign(node, { diff: 'chg', from: oldShown, badge: `${DISPLAY_LABEL[oldShown]}→${DISPLAY_LABEL[shown]}` })
      if (old.title !== t.title) Object.assign(node, { diff: 'chg', previous: old.title, badge: node.badge ?? '改名' })
    }
    nodes.push(node)
  }
  for (const t of before?.tickets ?? []) {
    if (!now.has(t.id)) nodes.push({ ...ticketNode(t, wasShown.get(t.id) as Display), diff: 'del', badge: '已删除' })
  }

  const eBefore = edgesOf(before)
  const eAfter = edgesOf(after)
  const ids = new Set(nodes.map((n) => n.id))
  for (const key of new Set([...eBefore, ...eAfter])) {
    const [source = '', target = ''] = key.split('>')
    if (!ids.has(source) || !ids.has(target)) continue
    const diff: DiffMark | undefined = !eAfter.has(key) ? 'del' : hasDiff && !eBefore.has(key) ? 'add' : undefined
    edges.push({ id: `${source}>${target}`, source, target, kind: 'dep', ...(diff ? { diff } : {}) })
  }

  const complete = isComplete(after)
  nodes.push({ id: START, kind: 'start', title: after.label, sub: '起点' })
  if (!complete) {
    const moved = hasDiff && before.fog !== after.fog
    nodes.push({
      id: FOG,
      kind: 'fog',
      title: after.fog || '下一层还没推导出来',
      sub: '迷雾 · Not yet specified',
      ...(moved ? { diff: 'chg' as const, badge: '改写', previous: before.fog } : {}),
    })
  }
  const destMoved = hasDiff && before.destination !== after.destination
  nodes.push({
    id: DESTINATION,
    kind: 'destination',
    title: after.destination || '（未写）',
    sub: '目的地',
    ...(destMoved ? { diff: 'chg' as const, badge: '改写', previous: before.destination } : {}),
  })

  const live = new Set(after.tickets.map((t) => t.id))
  const isBlocker = new Set(after.tickets.flatMap((t) => t.blockedBy))
  for (const t of after.tickets) {
    if (t.blockedBy.every((b) => !live.has(b))) edges.push({ id: `${START}>${t.id}`, source: START, target: t.id, kind: 'story' })
    if (!isBlocker.has(t.id) && t.state !== 'out-of-scope') {
      const target = t.state === 'resolved' || complete ? DESTINATION : FOG
      if (target === FOG && complete) continue
      edges.push({ id: `${t.id}>${target}`, source: t.id, target, kind: 'story' })
    }
  }
  // The way to the destination runs through the fog; this also keeps the
  // destination at the bottom while no decided ticket points at it yet.
  if (!complete) edges.push({ id: `${FOG}>${DESTINATION}`, source: FOG, target: DESTINATION, kind: 'story' })
  if (after.tickets.length === 0) {
    edges.push({ id: `${START}>${complete ? DESTINATION : FOG}`, source: START, target: complete ? DESTINATION : FOG, kind: 'story' })
  }
  return { nodes, edges }
}

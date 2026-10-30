/**
 * Wayfinder dashboard: a live, read-only view of the maps that
 * /mattpocock-skills:wayfinder keeps on this repo's issue tracker (local
 * markdown, GitHub or GitLab, resolved the way the skill resolves it).
 *
 * No commands and no tools: the person drives the map with Matt's skill as
 * usual. This mod notices the map change, records a snapshot per change, and
 * draws the whole directed graph with the change marked on it.
 *
 * The same map is also served as a live web page (web.ts): charting a new map
 * starts a local server and opens the page in the default browser, and every
 * later change animates onto the DAG there.
 *
 * How a change is noticed:
 * - Right after this session's own writes: a file tool (local tracker), or a
 *   `gh` / `glab` command or a GitHub / GitLab MCP tool (remote tracker).
 * - On a timer, for writes made anywhere else: every 5 s for local files,
 *   every 60 s for a remote tracker (5 min after an error). A webhook would
 *   need a public endpoint this machine does not have, so polling it is.
 */

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { View } from '../types'
import { describe, diff, displays, DISPLAY_LABEL, renderSvg } from './graph'
import { detectTracker, readTracker } from './sources'
import type { TrackerKind } from './sources'
import { ensureServer, openBrowser, urlFor, writeView } from './web'
import type { Entry } from './web'

const PANE = 'wayfinder'
const TITLE = 'Wayfinder'
const HISTORY_LIMIT = 40
const TICK_MS = 5_000
const REMOTE_MS = 60_000
const REMOTE_BACKOFF_MS = 300_000

const view = atom({ plugin: 'wayfinder-dashboard', key: 'view' } as const, { effort: null, index: null, replay: 0 } as View, {
  shape: 'view-2',
})
// Bumped whenever a snapshot is recorded or the sync status moves, so the pane redraws.
const rev = atom({ plugin: 'wayfinder-dashboard', key: 'rev' } as const, 0, { shape: 'rev-1' })

const DEFAULT_LOCAL_ROOT = '.scratch'

/** The source label shown in the pane and on the page; the local one carries the configured root. */
const trackerLabel = (kind: TrackerKind, localRoot: string): string =>
  kind === 'github' ? 'GitHub' : kind === 'gitlab' ? 'GitLab' : `本地 ${localRoot}/`

// Sync status, read by the pane. Module state: it starts over on a reload,
// and the first scan fills it again.
const sync: { kind: TrackerKind | null; at: number; error: string | null; lastRemote: number; serverError: string | null } = {
  kind: null,
  at: 0,
  error: null,
  lastRemote: 0,
  serverError: null,
}

const historyKey = (root: string, kind: TrackerKind, key: string) => `history:${root}:${kind}:${key}`

async function historyOf($: EngineInterface, root: string, kind: TrackerKind, key: string): Promise<Entry[]> {
  const stored = await $.store.get(historyKey(root, kind, key))
  return Array.isArray(stored) ? (stored as Entry[]) : []
}

async function mapsOf($: EngineInterface, root: string, kind: TrackerKind): Promise<string[]> {
  const prefix = `history:${root}:${kind}:`
  return (await $.store.keys()).filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length))
}

/** Rewrite the page's data from every recorded version of this tracker's maps. */
async function publish($: EngineInterface, root: string, kind: TrackerKind, localRoot: string): Promise<void> {
  const maps = await Promise.all((await mapsOf($, root, kind)).map(async (key) => ({ key, history: await historyOf($, root, kind, key) })))
  await writeView($, root, maps, { label: trackerLabel(kind, localRoot), syncAt: sync.at, error: sync.error })
}

/** Keep the page's server up; a failure shows in the pane, never stops a scan. */
async function serve($: EngineInterface, root: string): Promise<string | null> {
  try {
    const url = await ensureServer($, root)
    sync.serverError = null
    return url
  } catch (error) {
    sync.serverError = error instanceof Error ? error.message : String(error)
    return null
  }
}

/** Read the tracker; record a snapshot per map that moved. */
async function scan($: EngineInterface, localRoot: string): Promise<void> {
  const root = await $.session.root()
  const kind = await detectTracker($, root)
  const now = await $.clock.now()
  const result = await readTracker($, root, kind, localRoot)
  if (kind !== 'local') sync.lastRemote = now
  const statusMoved = sync.kind !== kind || sync.error !== ('error' in result ? result.error : null)
  sync.kind = kind
  sync.at = now
  sync.error = 'error' in result ? result.error : null
  if ('error' in result) {
    if (statusMoved) {
      await publish($, root, kind, localRoot)
      await update($, rev, (n) => n + 1)
    }
    return
  }

  let changed: string | null = null
  let charted: string | null = null
  for (const snapshot of result.snapshots) {
    const history = await historyOf($, root, kind, snapshot.key)
    const last = history.at(-1)
    if (last !== undefined && JSON.stringify(last.snapshot) === JSON.stringify(snapshot)) continue
    if (history.length === 0) charted ??= snapshot.key
    history.push({ at: now, snapshot })
    await $.store.set(historyKey(root, kind, snapshot.key), history.slice(-HISTORY_LIMIT))
    changed = snapshot.key
  }
  if (changed === null) {
    if (statusMoved) {
      await publish($, root, kind, localRoot)
      await update($, rev, (n) => n + 1)
    }
    return
  }
  await publish($, root, kind, localRoot)
  // A map just charted: bring up its page in the browser. Later changes reach
  // an open page by themselves.
  const url = await serve($, root)
  if (charted !== null && url !== null) await openBrowser($, `${url}?map=${encodeURIComponent(charted)}`)
  const effort = changed
  // Follow the change that just happened, and pulse it.
  await update($, view, (v): View => ({ effort, index: null, replay: v.replay + 1 }))
  await update($, rev, (n) => n + 1)
  await $.ui.open({ id: PANE, title: TITLE })
}

// One scan at a time: the timer and a tool call can land together.
let scanning: Promise<void> = Promise.resolve()
const rescan = ($: EngineInterface, localRoot: string) => {
  scanning = scanning.then(() => scan($, localRoot)).catch(() => undefined)
  return scanning
}

/** Whether a finished tool call may have written to the tracker in use. */
function mayHaveWritten(kind: TrackerKind | null, tool: string, input: unknown): boolean {
  const command = String((input as { command?: unknown }).command ?? '')
  if (kind === 'local' || kind === null) return /^(Write|Edit|MultiEdit|NotebookEdit|Bash)$/.test(tool)
  const cli = kind === 'github' ? /\bgh\s+(issue|api|project)\b/ : /\bglab\s+(issue|api)\b/
  if (tool === 'Bash') return cli.test(command)
  return tool.startsWith('mcp__') && new RegExp(kind, 'i').test(tool)
}

const stamp = (at: number) => {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export const register: Register = (on, options) => {
  const raw = typeof options.localRoot === 'string' ? options.localRoot.trim().replace(/^\/+|\/+$/g, '') : ''
  const localRoot = raw.length > 0 ? raw : DEFAULT_LOCAL_ROOT

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await rescan($, localRoot)
    const root = await $.session.root()
    if (sync.kind !== null && (await mapsOf($, root, sync.kind)).length > 0) {
      // A page left open from before reconnects to this server by itself.
      await publish($, root, sync.kind, localRoot)
      void serve($, root)
      await $.ui.open({ id: PANE, title: TITLE })
    }
    $.clock.every(TICK_MS, () => {
      const wait = sync.error === null ? REMOTE_MS : REMOTE_BACKOFF_MS
      if (sync.kind === 'local' || Date.now() - sync.lastRemote >= wait) void rescan($, localRoot)
    })
    return started
  })

  on('tool.call', { tool: /^(Write|Edit|MultiEdit|NotebookEdit|Bash|mcp__.+)$/ }, async ($, e, next) => {
    const ran = await next(e)
    if (mayHaveWritten(sync.kind, e.tool, e)) await rescan($, localRoot)
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await read($, rev)
    const v = await read($, view)
    const { Box, Text, Button } = $.ui.resolve(e)
    const root = await $.session.root()
    const kind = sync.kind ?? 'local'
    const maps = await mapsOf($, root, kind)
    const status = (
      <Text dimColor>
        来源：{trackerLabel(kind, localRoot)}
        {kind === 'local' ? '' : ' · 每 60 秒同步'}
        {sync.at > 0 ? ` · 上次 ${stamp(sync.at)}` : ''}
      </Text>
    )
    const failure = (
      <Box flexDirection="column">
        {sync.error !== null && <Text color="red">读取 {trackerLabel(kind, localRoot)} 失败：{sync.error}</Text>}
        {sync.serverError !== null && <Text color="red">网页服务没起来：{sync.serverError}</Text>}
      </Box>
    )
    const openPage = async () => {
      const url = await serve($, root)
      if (url !== null) await openBrowser($, `${url}?map=${encodeURIComponent(v.effort ?? '')}`)
      await update($, rev, (n) => n + 1)
    }

    if (maps.length === 0) {
      return (
        <Box flexDirection="column">
          <Text bold>这个仓库还没有 Wayfinder 地图</Text>
          <Text dimColor>用 /mattpocock-skills:wayfinder 开始找路，地图一写进 tracker，这里就会自动画出来。</Text>
          {status}
          {failure}
        </Box>
      )
    }

    const effort = v.effort !== null && maps.includes(v.effort) ? v.effort : (maps[0] as string)
    const history = await historyOf($, root, kind, effort)
    const index = v.index === null ? history.length - 1 : Math.min(Math.max(v.index, 0), history.length - 1)
    const after = history[index]?.snapshot
    if (after === undefined) return <Text dimColor>正在读取地图…</Text>
    const before = index > 0 ? (history[index - 1]?.snapshot ?? null) : null
    const changes = before === null ? [] : diff(before, after)
    const go = (patch: Partial<View>) => update($, view, (cur) => ({ ...cur, effort, ...patch, replay: cur.replay + 1 }))

    const counts = new Map<string, number>()
    for (const d of displays(after).values()) counts.set(d, (counts.get(d) ?? 0) + 1)
    const tally = [...counts].map(([d, n]) => `${DISPLAY_LABEL[d as keyof typeof DISPLAY_LABEL]} ${n}`).join(' · ')

    const header = (
      <Box flexDirection="column">
        {maps.length > 1 && (
          <Box flexDirection="row" flexWrap="wrap">
            {maps.map((key) => (
              <Button
                key={`map-${key}`}
                label={key}
                variant={key === effort ? 'primary' : 'secondary'}
                onPress={() => update($, view, (cur) => ({ ...cur, effort: key, index: null }))}
              />
            ))}
          </Box>
        )}
        <Box flexDirection="row" flexWrap="wrap">
          <Button key="prev" label="‹" onPress={() => go({ index: Math.max(0, index - 1) })} />
          <Text>
            {' '}
            第 {index + 1}/{history.length} 版 · {stamp(history[index]?.at ?? 0)}{' '}
          </Text>
          <Button key="next" label="›" onPress={() => go({ index: index + 1 >= history.length - 1 ? null : index + 1 })} />
          {v.index !== null && <Button key="latest" label="最新" onPress={() => go({ index: null })} />}
          <Button key="open-page" label="在浏览器打开 ↗" onPress={() => void openPage()} />
          {before !== null && <Button key="replay" label="▶ 重播变化" onPress={() => go({})} />}
        </Box>
        <Text dimColor>{tally}</Text>
        {before === null ? (
          <Text dimColor>这是记录到的第一版；之后每次变化都会标在图上。</Text>
        ) : changes.length === 0 ? (
          <Text dimColor>这一版只改了说明文字（Notes / Decisions so far），图没有变。</Text>
        ) : (
          changes.slice(0, 12).map((c) => <Text>{describe(c)}</Text>)
        )}
        {changes.length > 12 && <Text dimColor>……还有 {changes.length - 12} 处变化</Text>}
        {status}
        <Text dimColor>网页：{urlFor(root)}</Text>
        {failure}
      </Box>
    )

    if (e.surface === 'terminal') {
      // No SVG in a terminal: the same map as a list, changes marked inline.
      const shown = displays(after)
      const was = displays(before)
      return (
        <Box flexDirection="column">
          {header}
          <Text dimColor>目的地：{after.destination || '（未写）'}</Text>
          {after.tickets.map((t) => {
            const now = shown.get(t.id) ?? 'frontier'
            const old = was.get(t.id)
            const mark = before === null ? '' : old === undefined ? '[新] ' : old !== now ? `[${DISPLAY_LABEL[old]}→] ` : ''
            return (
              <Text>
                {mark}[{DISPLAY_LABEL[now]}] {t.id} {t.title}
                {t.blockedBy.length > 0 ? `  ← ${t.blockedBy.join(', ')}` : ''}
              </Text>
            )
          })}
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    // The replay counter rides in the markup so a press remounts the drawing
    // and the highlights pulse again.
    const source = renderSvg(before, after).replace('</svg>', `<!-- replay ${v.replay} --></svg>`)
    return (
      <Box flexDirection="column">
        {header}
        <Svg source={source} alt={`Wayfinder 地图 ${after.label}：${after.tickets.length} 个问题，${tally}`} isInteractive />
        <Text dimColor>绿框新增 · 橙框变化（左侧色条是旧状态）· 红虚线删除；悬停节点看问题、决定和改动前的样子。</Text>
      </Box>
    )
  })
}

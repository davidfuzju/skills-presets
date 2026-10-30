/**
 * The browser half: the mod writes everything the page needs to
 * `~/.claude/wayfinder-dashboard/<workspace>/view.json`, keeps a small local
 * server (server/serve.mjs, under node) running for it, and opens the page in
 * the default browser when a new map is charted. The server pushes every
 * rewrite of view.json to open pages, so the page follows the map live.
 *
 * One port per workspace, derived from its root, so a page left open
 * reconnects to the same address after the mod reloads and restarts it.
 */

import type { EngineInterface } from 'claude-code'

import { describe, diff, displays, DISPLAY_LABEL, mergedGraph } from './graph'
import type { Snapshot } from './tracker'

export type Entry = { at: number; snapshot: Snapshot }

/** FNV-1a: enough to keep two roots with the same basename apart. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function workspaceSlug(root: string): string {
  const base = (root.split(/[\\/]/).filter(Boolean).pop() ?? 'ws')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${base || 'ws'}-${fnv1a(root).toString(16).padStart(8, '0')}`
}

export const portFor = (root: string) => 47100 + (fnv1a(root) % 800)
export const urlFor = (root: string) => `http://127.0.0.1:${portFor(root)}/`

async function dataDirFor($: EngineInterface, root: string): Promise<string> {
  return `${await $.env.get('HOME')}/.claude/wayfinder-dashboard/${workspaceSlug(root)}`
}

export type TrackerStatus = { label: string; syncAt: number; error: string | null }

/** Everything the page draws: per map, per recorded version, the merged graph. */
export function buildView(maps: { key: string; history: Entry[] }[], tracker: TrackerStatus) {
  return {
    tracker,
    maps: maps.map(({ key, history }) => ({
      key,
      label: history.at(-1)?.snapshot.label ?? key,
      versions: history.map((entry, i) => {
        const before = i > 0 ? (history[i - 1]?.snapshot ?? null) : null
        const counts = new Map<string, number>()
        for (const d of displays(entry.snapshot).values()) counts.set(d, (counts.get(d) ?? 0) + 1)
        return {
          at: entry.at,
          changes: before === null ? [] : diff(before, entry.snapshot).map(describe),
          tally: [...counts].map(([d, n]) => `${DISPLAY_LABEL[d as keyof typeof DISPLAY_LABEL]} ${n}`).join(' · '),
          graph: mergedGraph(before, entry.snapshot),
        }
      }),
    })),
  }
}

export async function writeView(
  $: EngineInterface,
  root: string,
  maps: { key: string; history: Entry[] }[],
  tracker: TrackerStatus,
): Promise<void> {
  await $.fs.write(`${await dataDirFor($, root)}/view.json`, JSON.stringify(buildView(maps, tracker)))
}

// ---------------------------------------------------------------------------
// The server process
// ---------------------------------------------------------------------------

// Where node usually is when the app's PATH is thinner than a login shell's.
const NODES = ['node', '/opt/homebrew/bin/node', '/usr/local/bin/node']
const READY_MS = 5_000

let server: { root: string; ready: Promise<string> } | null = null

/** Start the page's server for this workspace unless one is up; resolves its URL. */
export function ensureServer($: EngineInterface, root: string): Promise<string> {
  if (server?.root === root) return server.ready
  const url = urlFor(root)
  const ready = (async () => {
    const dir = await dataDirFor($, root)
    const argv = [`${$.plugin.root}/server/serve.mjs`, dir, String(portFor(root)), `${$.plugin.root}/server/index.html`]
    let lastError = 'node not found'
    for (const node of NODES) {
      const started = await new Promise<boolean | string>((resolve) => {
        const timer = $.clock.after(READY_MS, () => resolve('the server did not report ready'))
        void (async () => {
          let isReady = false
          let isOurs = false
          try {
            for await (const chunk of $.process.spawn({ argv: [node, ...argv] })) {
              const said = /^(listening|in-use) /m.exec(chunk.text)?.[1]
              if (!isReady && said !== undefined) {
                isReady = true
                isOurs = said === 'listening'
                timer.cancel()
                resolve(true)
              }
            }
          } catch (error) {
            timer.cancel()
            resolve(error instanceof Error ? error.message : String(error))
          }
          // The child ended. "in-use" means another session's server already
          // serves this workspace's page, so keep counting on it; forget only
          // a server of ours that stopped, so the next change starts one again.
          if (isOurs && server?.root === root) server = null
          if (!isReady) resolve('the server exited before it was ready')
        })()
      })
      if (started === true) return url
      lastError = String(started)
    }
    server = null
    throw new Error(lastError)
  })()
  server = { root, ready }
  return ready
}

/** Open `url` in the default browser: macOS `open`, then `xdg-open`. */
export async function openBrowser($: EngineInterface, url: string): Promise<void> {
  for (const argv of [['open', url], ['xdg-open', url]]) {
    const run = await $.process.run(argv, { timeoutMs: 10_000 }).catch(() => null)
    if (run?.exitCode === 0) return
  }
}

import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'wayfinder-dashboard',
  component: 'Pane',
  requestId: 'wayfinder',
  props: {
    title: 'Wayfinder',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const MAP = `## Destination

家里有一个合规的泳池方案。

## Notes

## Decisions so far

## Not yet specified

规格、施工方。

## Out of scope
`

const ticket = (title: string, type: string, extra = '') => `# ${title}

Type: ${type}
${extra}

## Question

${title}
`

test('records each change to the tracker and draws before/after', async ($, on) => {
  // The tracker files, the store and the clock stand for the engine.
  const root = '/work/home'
  const files = new Map<string, string>([
    [`${root}/.scratch/pool/map.md`, MAP],
    [`${root}/.scratch/pool/issues/01-purpose.md`, ticket('泳池主要拿来做什么？', 'grilling')],
    [`${root}/.scratch/pool/issues/02-site.md`, ticket('泳池放在哪里？', 'grilling')],
    [`${root}/.scratch/pool/issues/03-size.md`, ticket('多大多深？', 'grilling', 'Blocked by: 01, 02')],
  ])
  const store = new Map<string, unknown>()
  let now = 1_000
  let opened = 0
  on('session.root', () => ({ value: root }))
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('clock.after', () => ({ value: undefined }))
  // The page's server and the browser are the host's (process.spawn is not
  // in the test engine); this test holds the data the page is drawn from.
  on('fs.list', (_, e) => {
    const prefix = `${e.path}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const p of files.keys()) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const cut = rest.indexOf('/')
      names.set(cut < 0 ? rest : rest.slice(0, cut), cut < 0 ? 'file' : 'dir')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('clock.now', () => ({ value: (now += 60_000) }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.open', () => {
    opened++
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  // The first scan runs after start; a tool call queues behind it.
  await $.tool.call({ tool: 'Read', file_path: 'x' } as never)
  await $.tool.call({ tool: 'Write', file_path: 'x', content: '' } as never)
  expect(opened).toBeGreaterThan(0)
  const key = `history:${root}:local:pool`
  expect((store.get(key) as unknown[]).length).toBe(1)
  const viewPath = [...files.keys()].find((p) => p.endsWith('/view.json')) as string
  expect(viewPath).toMatch(/^\/home\/me\/\.claude\/wayfinder-dashboard\/home-[0-9a-f]{8}\/view\.json$/)

  // The skill resolves 01 and charts 04 behind it.
  files.set(`${root}/.scratch/pool/issues/01-purpose.md`, ticket('泳池主要拿来做什么？', 'grilling', 'Status: resolved') + '\n## Answer\n\n孩子戏水为主\n')
  files.set(`${root}/.scratch/pool/issues/04-depth.md`, ticket('最深处要多深？', 'grilling', 'Blocked by: 1'))
  await $.tool.call({ tool: 'Write', file_path: 'x', content: '' } as never)
  await $.tool.call({ tool: 'Write', file_path: 'x', content: '' } as never)
  expect((store.get(key) as unknown[]).length).toBe(2)
  // Every change rewrites the page's data; the open page follows it.
  const page = JSON.parse(files.get(viewPath) as string)
  const latest = page.maps[0].versions[1]
  expect(latest.changes).toContain('+ 新增 04 最深处要多深？')
  const nodes = new Map(latest.graph.nodes.map((n: { id: string }) => [n.id, n]))
  expect(nodes.get('04')).toMatchObject({ diff: 'add', badge: '新增' })
  expect(nodes.get('01')).toMatchObject({ diff: 'chg', from: 'frontier', display: 'resolved', badge: '可决→已决' })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /\+ 新增 04 最深处要多深/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /~ 01 .*可决 → 已决/ })).toBeDefined()
  // A new ticket's own edges come with it; only edges between existing tickets are listed.
  expect(await ui.find({ type: 'Text', text: /依赖 01 → 04/ })).toBeUndefined()
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()

  // One graph carries both sides: the old state rides on the changed node.
  const source = String((svg as { props?: { source?: string } }).props?.source ?? '')
  expect(source).toContain('可决→已决')
  expect(source).toContain('新增')
  await ui.press({ key: 'replay' })
  await ui.press({ key: 'prev' })
  expect(await ui.find({ type: 'Text', text: /第 1\/2 版/ })).toBeDefined()
  await ui.press({ key: 'latest' })
  await ui.unmount()

  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /\[已决\] 01/ })).toBeDefined()
  await term.unmount()
})

const ok = (stdout: unknown) => ({
  value: { exitCode: 0, stdout: JSON.stringify(stdout), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

const gh = (n: number, extra: Record<string, unknown> = {}) => ({
  number: n,
  title: `问题 ${n}`,
  body: '## Question\n\n要决定什么',
  state: 'OPEN',
  stateReason: null,
  parent: { number: 1 },
  labels: { nodes: [{ name: 'wayfinder:grilling' }] },
  assignees: { totalCount: 0 },
  blockedBy: { nodes: [] },
  comments: { nodes: [] },
  ...extra,
})

test('reads a GitHub map through gh, and refreshes right after a gh write', async ($, on) => {
  const root = '/work/gh'
  const store = new Map<string, unknown>()
  let tickets = [gh(2), gh(3, { blockedBy: { nodes: [{ number: 2 }] } })]
  const calls: string[][] = []
  on('session.root', () => ({ value: root }))
  on('fs.read', (_, e) => {
    if (e.path.endsWith('docs/agents/issue-tracker.md')) return { value: '# Issue tracker: GitHub\n' }
    throw new Error('ENOENT')
  })
  on('process.run', (_, e) => {
    calls.push([...e.argv])
    if (e.argv[2] === 'view') return ok({ owner: { login: 'acme' }, name: 'pool' })
    return ok({
      data: {
        repository: {
          maps: { nodes: [{ number: 1, title: '家庭泳池', body: '## Destination\n\n能开工\n\n## Not yet specified\n\n施工方' }] },
          tickets: { nodes: tickets },
        },
      },
    })
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('clock.now', () => ({ value: 5 }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))

  await $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  const key = `history:${root}:github:#1`
  expect((store.get(key) as unknown[]).length).toBe(1)
  expect(calls.some((c) => c[0] === 'gh' && c[1] === 'api' && c[2] === 'graphql')).toBe(true)

  // A Read is not a write to GitHub: no refresh.
  const before = calls.length
  await $.tool.call({ tool: 'Bash', command: 'ls' } as never)
  expect(calls.length).toBe(before)

  // The skill resolves #2 with gh: the pane refreshes on the spot.
  tickets = [gh(2, { state: 'CLOSED', stateReason: 'COMPLETED', comments: { nodes: [{ body: '孩子戏水' }] } }), tickets[1] as ReturnType<typeof gh>]
  await $.tool.call({ tool: 'Bash', command: 'gh issue close 2 --comment "孩子戏水"' } as never)
  expect((store.get(key) as unknown[]).length).toBe(2)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /~ #2 问题 2：可决 → 已决/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /~ #3 问题 3：被挡 → 可决/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /来源：GitHub/ })).toBeDefined()
  await ui.unmount()
})

test('reads a GitLab CE map: Part of + Blocked by lines, closing note as the answer', async ($, on) => {
  const root = '/work/gl'
  const store = new Map<string, unknown>()
  on('session.root', () => ({ value: root }))
  on('fs.read', (_, e) => {
    if (e.path.endsWith('docs/agents/issue-tracker.md')) return { value: '# Issue tracker: GitLab\n' }
    throw new Error('ENOENT')
  })
  const issue = (iid: number, extra: Record<string, unknown> = {}) => ({
    iid,
    title: `问题 ${iid}`,
    description: `Part of #1\n\n## Question\n\n决定 ${iid}`,
    state: 'opened',
    labels: ['wayfinder:research'],
    assignees: [],
    updated_at: '2026-10-30T00:00:00Z',
    ...extra,
  })
  on('process.run', (_, e) => {
    const path = String(e.argv[2] ?? '')
    if (path.includes('wayfinder%3Amap')) return ok([{ iid: 1, title: '家庭泳池', description: '## Destination\n\n能开工' }])
    if (path.includes('wayfinder%3Aresearch'))
      return ok([issue(4, { state: 'closed' }), issue(5, { description: 'Part of #1\nBlocked by: #4\n\n## Question\n\n下一步' })])
    if (path.endsWith('/links')) return ok([])
    if (path.includes('/notes')) return ok([{ body: 'added label', system: true }, { body: '选砂缸过滤', system: false }])
    return ok([])
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('clock.now', () => ({ value: 5 }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  const history = store.get(`history:${root}:gitlab:#1`) as { snapshot: { tickets: { id: string; state: string; blockedBy: string[]; answer: string }[] } }[]
  const [four, five] = history[0]?.snapshot.tickets ?? []
  expect(four).toMatchObject({ id: '#4', state: 'resolved', answer: '选砂缸过滤' })
  expect(five).toMatchObject({ id: '#5', state: 'open', blockedBy: ['#4'] })
})

test('a configured localRoot points the local reader at another directory', { options: { localRoot: '.ai/wayfinder' } }, async ($, on) => {
  const root = '/work/fork'
  // The map lives under .ai/wayfinder, not .scratch: nothing is read from .scratch.
  const files = new Map<string, string>([
    [`${root}/.ai/wayfinder/pool/map.md`, MAP],
    [`${root}/.ai/wayfinder/pool/issues/01-purpose.md`, ticket('做什么用？', 'grilling')],
    [`${root}/.scratch/pool/map.md`, MAP],
  ])
  const store = new Map<string, unknown>()
  on('session.root', () => ({ value: root }))
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.write', () => ({ value: undefined }))
  on('clock.after', () => ({ value: undefined }))
  on('fs.list', (_, e) => {
    const prefix = `${e.path}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const p of files.keys()) {
      if (!p.startsWith(prefix)) continue
      const rest = p.slice(prefix.length)
      const cut = rest.indexOf('/')
      names.set(cut < 0 ? rest : rest.slice(0, cut), cut < 0 ? 'file' : 'dir')
    }
    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 0, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('clock.now', () => ({ value: 5 }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: root, surface: 'desktop', isInteractive: true })
  // The map under .ai/wayfinder was read and recorded; the .scratch one was never touched.
  expect((store.get(`history:${root}:local:pool`) as unknown[]).length).toBe(1)

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /来源：本地 \.ai\/wayfinder\// })).toBeDefined()
  await ui.unmount()
})

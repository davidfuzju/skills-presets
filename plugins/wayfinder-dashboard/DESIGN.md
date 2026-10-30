# Design notes — wayfinder-dashboard

Why this mod is shaped the way it is, and the decisions taken when it moved into this
repository. These notes record *why*, not *what*; the source is the authority for *what*.

Measured against Claude Code `2.1.306`–`2.1.309`, `mattpocock-skills` wayfinder maps, macOS.

---

## 1. Packaging: a second, separate plugin

This repository already ships one plugin — `skills-presets`, with `source: "./"` — a layer of
**classic shell + `jq` hooks** that enforces write-side workflow defaults (worktrees, `--no-ff`
merges, close-out). The dashboard is a different animal in every dimension, so it is a **second
plugin** at [`plugins/wayfinder-dashboard/`](.), listed separately in
[`marketplace.json`](../../.claude-plugin/marketplace.json), not folded into the existing one.

| | `skills-presets` | `wayfinder-dashboard` |
| --- | --- | --- |
| Mechanism | classic hooks (`hooks.json` events → `dispatch.sh`) | a function-hooks **mod** (a TypeScript hooks module) |
| Side on the tracker | **writes** (drives merges, closes tickets) | **reads only** — never writes, never invokes the skill |
| Purpose | enforce a policy | project a view |
| Dependencies | `jq` | `node` (page server), `gh` / `glab` (remote trackers) |
| Who wants it | anyone running `/implement` | anyone running `/wayfinder` |

Folding them together would put two unrelated mechanisms behind one install and one version, and
force anyone who wants the policy layer to also carry a web server and a Cytoscape page (or vice
versa). Keeping them apart costs one extra marketplace entry and buys independent installs,
versions and failure domains. The root plugin's `source: "./"` is unaffected: it loads only what
its own `hooks/hooks.json` names, so `plugins/` is just inert files to it.

## 2. Relationship to design rule B (*Zero domain logic*)

The repository's rule B says the preset layer never reimplements what a target skill already
documents — for `mattpocock-skills` it reads **one line** to identify the tracker kind and
delegates every operation back to the repo's own `docs/agents/issue-tracker.md`.

This mod keeps the half of rule B that matters and necessarily relaxes the other half:

- **Kept — no operations are reimplemented.** The dashboard performs *no* tracker operation.
  It never claims, resolves, merges, closes, opens, or labels anything; it issues no write of
  any kind and invokes the skill not at all. Every operation still belongs to the skill. The
  tracker **kind** is resolved the same one-line way rule B prescribes
  ([`sources.ts` `detectTracker`](./hooks/sources.ts)), with the same default to local markdown.
- **Relaxed — it parses the ticket format.** A visualization has to understand the data to draw
  it. You cannot render a graph of blocking relationships without reading the `Blocked by` line,
  and you cannot colour a node by state without reading `Status:` / the issue state. So this mod
  does hold a **read model** of the map and ticket format the skill writes.

Why that is acceptable, and how it is contained:

1. **It is a projection, not a reimplementation.** Rule B exists so the plugin does not grow a
   second, drifting copy of the skill's *behaviour*. Parsing-to-draw is a presentation concern:
   there is no behaviour to duplicate, because the mod changes nothing.
2. **The parsing is in one place.** Every format assumption lives in
   [`tracker.ts`](./hooks/tracker.ts) (the tracker-neutral model and the shared body parsing);
   [`sources.ts`](./hooks/sources.ts) only maps each tracker's raw shape onto that model. A
   change to the skill's format is a change to one file.
3. **It fails soft.** Unparseable input yields an empty or partial map, a `读取…失败` line in the
   pane, and a retry on the next scan — never a crash, never a write. The worst case is a view
   that lags the truth, which a human notices immediately.

The honest residual risk: if upstream changes the map's section names or the ticket-body
conventions, the graph silently misreads until `tracker.ts` is updated. That is the price of a
visualization and is called out in the README.

## 3. The local tracker path is configurable

Matt's skills default to `.scratch/<effort>/`, but some forks use `.ai/wayfinder/<slug>/`. The
local reader therefore takes its root from a `userConfig` field rather than hard-coding
`.scratch`:

```jsonc
// .claude-plugin/plugin.json
"userConfig": {
  "localRoot": { "type": "string", "title": "Local tracker directory", "default": ".scratch", ... }
}
```

`register(on, options)` reads `options.localRoot`, trims surrounding slashes, falls back to
`.scratch` when empty, and threads it through `scan → readTracker → readLocal`. It also feeds the
source label (`本地 .ai/wayfinder/`) in the pane and on the page. It is ignored for GitHub and
GitLab, whose locations are not paths. A test
([`wayfinder.test.tsx`](./hooks/wayfinder.test.tsx), the fourth case) pins that a configured
root reads from the new directory and leaves `.scratch` untouched.

## 4. Renamed `wayfinder` → `wayfinder-dashboard`; the old history does not carry over

The development mod was named `wayfinder`. On the way in it was renamed to `wayfinder-dashboard`
(plugin name, folder, the `$.state` namespace in [`types/index.d.ts`](./types/index.d.ts), the
atom `plugin` fields, and the test). Two reasons:

- **Clarity.** In the marketplace, `wayfinder-dashboard` reads as what it is and does not collide
  in a user's head with Matt's `/wayfinder` skill.
- **Safe coexistence during the cutover.** The development mod and the installed plugin must not
  both be active — two copies would double every hook. A *different* name at least keeps their
  `$.store` namespaces and `$.state` apart, so a brief overlap cannot corrupt state; it only
  double-fires hooks. The clean path is still to disable the dev mod once this one is installed.

The rename changes the `$.store` namespace, so **snapshot history recorded under the old name
does not carry over**. This is accepted: history is a convenience, re-accumulated from the first
change after install, and nothing else depends on it.

## 5. Where the code is, and what is verified

| File | Responsibility |
| --- | --- |
| `.claude-plugin/plugin.json` | manifest; the `localRoot` `userConfig` field |
| `hooks/hooks.json` | names the one hooks module |
| `hooks/register.tsx` | the mod: scan on start + timer + after writes, the pane (SVG / text), snapshot history in `$.store`, bring up the page on a first chart |
| `hooks/sources.ts` | tracker **kind** detection and the three readers (local / GitHub / GitLab) |
| `hooks/tracker.ts` | the tracker-neutral model and the body parsing every tracker shares |
| `hooks/graph.ts` | `diff` / `describe`; the single-graph SVG for the pane; `mergedGraph` (node/edge data for the page) |
| `hooks/web.ts` | write `view.json`, keep the per-workspace server up, open the browser |
| `server/serve.mjs` | zero-dependency node server: the page, the last valid `view.json`, SSE on change |
| `server/index.html` | the Cytoscape page: dagre layout, grow/fade/ghost animation, version timeline, SSE refetch |
| `types/index.d.ts` | the `$.state` contract (`view`, `rev`) |

`.claude-plugin/types/` is written by the engine per build and is `.gitignore`d (`*`); it exists
only so `tsc -p .` type-checks in a working tree where the mod has been loaded. A fresh clone
regenerates it when the mod loads, or is type-checked with the header `tsconfig.json` from the
plugin-authoring skill's declaration file.

**Verified**

- `claude plugin validate`, `tsc -p .`, and `claude plugin test` all pass (4 tests: local
  diff + `view.json`, GitHub adapter + refresh-after-write, GitLab CE adapter, configurable
  `localRoot`).
- The page's render, SSE push, animation, and replay were checked by hand against the real
  `serve.mjs` in a browser.

**Not verified by the suite**

- The `$.process.spawn` server start and the `open` / `xdg-open` browser launch: the test engine
  provides no `$.process.spawn`, and the type docs mark `$.process` as CLI-only, so that leg is
  exercised in a real session, not in CI.
- The GitHub and GitLab adapters have been run against mocked CLI output, not against a live
  wayfinder map on either host.

## 6. Replacing the development mod

Until this plugin is installed and confirmed working, the original development mod stays enabled
so nothing is lost. Once installed, **disable the development mod** so the same mod is not loaded
twice. The names differ, so state will not corrupt in the meantime, but both firing means
duplicate scans, two servers racing for the one per-workspace port (the loser prints `in-use`
and exits), and two browser-open attempts.

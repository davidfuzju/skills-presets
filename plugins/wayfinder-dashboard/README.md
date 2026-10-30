# wayfinder-dashboard

A live, **read-only** dashboard for the maps that
[`/mattpocock-skills:wayfinder`](https://github.com/mattpocock/skills) keeps on a repo's issue
tracker. It adds **no commands and no tools** — you drive the map with Matt's skill exactly as
before. This mod watches the tracker, records one snapshot per change, and draws the whole
directed graph with the change marked on it, in a pane beside the chat and on a live web page.

It is a function-hooks *mod* (a TypeScript hooks module), not the shell-and-`jq` preset layer
that `skills-presets` is. The two share nothing but this marketplace; install whichever you
want.

## What it does

- **Draws the map as a DAG.** Tickets are nodes; `Blocked by` links are edges; the map's
  Start, the fog (*Not yet specified*), and the Destination anchor the graph top and bottom.
  A ticket's colour is its state — frontier (decidable now), blocked, in progress, resolved,
  out of scope.
- **Records a version on every change** (up to 40 per map, in `$.store`), so you can page back
  through the map's history.
- **Marks the change on one graph, never two.** The after-state is drawn as the map stands,
  with each difference from the previous version written onto it: a new node grows from its
  blockers and fades in, a node whose state moved keeps its old state as a left-edge stripe and
  a chip (`可决→已决`), a removed node stays as a ghost, a removed edge stays as a red dashed
  line. The highlights pulse once so the eye lands on them.
- **Opens a web page the first time a map is charted** and pushes every later change to it live
  (Cytoscape.js + dagre, over Server-Sent Events). The pane has a `在浏览器打开 ↗` button to
  reopen it.
- **Degrades to a text list** in a terminal surface, with the same change marks inline.

## How a change is noticed

The mod never writes to the tracker; it only reads. It picks up a change two ways:

- **Right after this session's own writes** — a file tool for a local tracker, or a `gh` /
  `glab` command or a GitHub/GitLab MCP tool for a remote one — so your own edits show at once.
- **On a timer** for writes made anywhere else: every 5 s for local files, every 60 s for a
  remote tracker (5 min after an error). A webhook would need a public endpoint this machine
  does not have, so polling it is.

## Trackers

The tracker kind is resolved **exactly as the skill resolves it** — from the first heading of
`docs/agents/issue-tracker.md` (written by `/setup-matt-pocock-skills`), defaulting to local
markdown when that file is absent. The mod keeps no token and makes no network call of its own;
remote trackers are read through your own `gh` / `glab`, which already hold your login.

| Tracker | Read via | Notes |
| --- | --- | --- |
| Local markdown | `$.fs` | `<localRoot>/<effort>/map.md` + `issues/NN-*.md`. `localRoot` is configurable (below). |
| GitHub | `gh api graphql` | One query per refresh: maps (`wayfinder:map`) and up to 100 tickets (`wayfinder:*`), with sub-issue parents, issue-dependency edges, and the last comment as the answer. |
| GitLab | `glab api` (REST) | `Part of #N` for parenting; native blocking links **and** the `Blocked by:` line are both read, so a **GitLab CE** instance without the Premium blocking link still works. The last non-system note is the answer. |

## Install

```bash
claude plugin marketplace add davidfuzju/skills-presets
claude plugin install wayfinder-dashboard@skills-presets
```

Requires `node` on `PATH` (or at `/opt/homebrew/bin` or `/usr/local/bin`) for the web page's
server, and `gh` / `glab` for a remote tracker. The pane and the text fallback work without
`node`.

## Configuration

One `userConfig` field, editable from `/config`:

| Field | Default | What it does |
| --- | --- | --- |
| `localRoot` | `.scratch` | The directory under the repo root where a **local-markdown** tracker keeps its maps. Some forks of Matt's skills use `.ai/wayfinder` instead of `.scratch`. Ignored for GitHub and GitLab. |

## Known limits

- **It parses the ticket format.** A dashboard has to understand the data to draw it, so this
  mod reads the map's sections and the ticket-body conventions the skill writes. If upstream
  changes that format, the parser can misread until it is updated. See
  [DESIGN.md](./DESIGN.md) §2 for why this is acceptable and where it is contained.
- **Remote reads are capped and unpaged.** Up to 20 maps and 100 tickets per GitHub refresh;
  GitLab lists 100 per label. Larger trackers need pagination (roadmap).
- **The server/browser path is host-only.** It uses `$.process.spawn` and `open`/`xdg-open`,
  which the test engine does not provide, so that leg is exercised by hand, not by the test
  suite (see DESIGN.md §5).

## Roadmap

- Bundle Cytoscape for offline use (it is loaded from jsDelivr today).
- Paginate the GitHub and GitLab queries.
- GitLab epics carrying a map.
- Critical-path and cycle detection on the graph.
- A square icon for the plugin directory listing.

## License

MIT

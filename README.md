# skills-presets

A Claude Code plugin that enforces **your own workflow defaults on third-party skills you
don't own** — without forking them.

## The problem

Installed skill bundles are read-only, auto-updating, and versioned by path. Editing the
installed copy is pointless: the next update overwrites it. And most skills have no
configuration surface at all —
[`mattpocock-skills`](https://github.com/mattpocock/skills)' `implement` is eight lines long,
commits to whatever branch you happen to be on, and has no completion step.

So you either fork (and inherit maintenance forever) or you accept the defaults.

## The approach

Attach at the **hook layer** instead. Hooks see tool calls, not skill source, so they keep
working when upstream rewrites its prose. A target is only bound by the skill's *name*, which
almost never changes.

Adding another third-party skill is a data change: append an entry to
[`targets.json`](./targets.json) and create `policy/<name>/`.

| Target | Enforces |
| --- | --- |
| `mattpocock-skills` `/implement` | a worktree per ticket, `--no-ff` merges, kept worktrees, ticket claim + close-out checklist |

## Two design rules

**A. Scope never leaks.** `PreToolUse` matchers can only match a *tool name*, so a bare
`matcher: "Bash"` fires on every Bash call in every repo and every session. Every branch that
touches a generic tool (`Bash`, `ExitWorktree`) therefore checks a session gate file first and
exits immediately when no target skill is running. The gate is keyed by `session_id`, opened
when a target is invoked, and removed on `SessionEnd`. A second session in the same repo is
unaffected, and commands you type yourself never pass through a hook at all.

**B. Zero domain logic.** Anything the target skill already documents is delegated back to it,
never reimplemented. For `mattpocock-skills` this means reading only the *first line* of
`docs/agents/issue-tracker.md` to identify which of its four tracker kinds is in use
(GitHub / GitLab / local markdown / freeform), then pointing the agent at that file's own
Claim and Resolve conventions. That is what makes the freeform "other" tracker work — no
hardcoded implementation could.

## Install

```bash
claude plugin marketplace add davidfuzju/skills-presets
claude plugin install skills-presets@skills-presets
```

Hook changes take effect on the next session. Requires `jq`.

Works with or without the [rtk](https://github.com/rtkteam/rtk) proxy: rtk passes `git merge`
through untouched, and the rewrite regex tolerates an `rtk ` prefix either way, so no
detection is needed.

## Recommended session setup

**Leave the new-session worktree checkbox unchecked.** Let `/implement` create the worktree
itself: it gets a name carrying the ticket id, and there is nothing to reconcile.

Ticking the box launches the session in `.claude/worktrees/<random-name>`, and from a name
alone nothing can tell a freshly-created empty worktree apart from one the user has been
working in for an hour. So when `/implement` finds itself in a worktree that is not named for
the ticket, it measures what that worktree holds — uncommitted changes, unmerged commits, and
gitignored files — presents the options, and waits. It never switches or removes anything on
its own.

## Configuring it

Everything under `policy/` is plain Markdown injected into the agent's context. Edit it to
change the rules; no code changes needed.

| File | Injected when |
| --- | --- |
| `policy/<target>/implement-preflight.md` | the target skill is invoked |
| `policy/<target>/implement-closeout.md` | the run stops (once per run) |
| `policy/<target>/no-tracker.md` | the repo has no tracker configured |

## Known limits

- **The worktree rule is advisory.** `EnterWorktree` can only be called by the model; hooks
  cannot invoke tools. The injected instruction is the mechanism. It does land on a sanctioned
  path: `EnterWorktree`'s own contract accepts "project instructions (CLAUDE.md / memory)" as
  authorization, so one line in the target repo's `CLAUDE.md` gives you a second anchor.
- **Merges you type yourself are not covered.** Hooks only see the agent's tool calls. This is
  deliberate: `git config merge.ff false` would cover them, but changes behaviour outside the
  agent entirely.
- **The hook process still spawns on every Bash call.** Only the effect is gated, not the
  execution. The cost is one `bash` + `jq` that exits on its first line.

See [DESIGN.md](./DESIGN.md) for the measured hook contract, the gating rationale, and the
edge-case tables.

## License

MIT

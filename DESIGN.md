# Design notes

Why this plugin is shaped the way it is, and the measured evidence behind each decision.

> These notes document the **`mattpocock-skills` target** specifically. The plugin itself is a
> general preset layer; see [README](./README.md) and [`targets.json`](./targets.json) for how
> other third-party skills plug in.

Measured against Claude Code `2.1.263`, `mattpocock-skills@1.2.3`, `rtk@0.48.0`, macOS.

---

## 1. Two design rules

**A. Scope never leaks.** A `PreToolUse` matcher can only match a *tool name*. There is no
native "only while skill X is running" condition. So a bare `matcher: "Bash"` fires on every
Bash call, in every repo, in every session — which has nothing to do with the skill you meant
to configure. Every branch that touches a generic tool (`Bash`, `ExitWorktree`) therefore
checks a session gate file first and exits immediately when no target is running.

**B. Zero domain logic.** The plugin does not reimplement anything the target skill already
documents. For `mattpocock-skills` this means it never learns what an issue tracker is: it
reads one line to identify the kind, and delegates every actual operation back to the repo's
own `docs/agents/issue-tracker.md`.

---

## 2. Requirements to mechanisms

| Requirement | Hook | Mechanism | Strength | Scope |
| --- | --- | --- | --- | --- |
| A worktree per ticket | `UserPromptSubmit` / `PreToolUse:Skill` | inject preflight; the model calls `EnterWorktree` | advisory | matches the target only |
| Worktree name carries the ticket id | same | inject the naming *rule*; the model builds the slug after fetching the ticket | advisory | same |
| `--no-ff` merges | `PreToolUse:Bash` | gate + `updatedInput` rewrite | **hard** | this session, while a target runs |
| Worktrees are kept | `PreToolUse:ExitWorktree` | gate + `deny` on `action:"remove"` | **hard** | this session, while a target runs |
| Claim the ticket | preflight | point at the tracker file's **Claim** convention | advisory | this run |
| Close on completion | `Stop` | point at the **Resolve** convention, present a checklist | advisory + human gate | this run |

The `--no-ff` and keep-worktree rules are hard because `updatedInput` and `deny` do not depend
on the model cooperating. The rest are advisory because they require *tool calls* or *tracker
writes*, and a hook cannot perform either on the model's behalf.

---

## 3. Session gating

```
/implement #11  ──> UserPromptSubmit hook
                     ├─ write $TMPDIR/skills-presets-<session_id>.json   ← gate opens
                     └─ inject preflight

    ...the run proceeds...
       every Bash call   ──> hook fires, checks gate → open and it is a git merge → add --no-ff
       ExitWorktree      ──> hook fires, checks gate → open and action=remove → deny

Stop            ──> inject the close-out checklist (once only)
SessionEnd      ──> rm the gate file                                     ← gate closes
```

The gate file is keyed by `session_id`, so:

- a **second session** in the same repo is unaffected
- a session that never invokes a target notices nothing
- state is cleaned up on `SessionEnd`, leaving nothing behind

**Honest caveat:** the hook *process* is still spawned on every `Bash` call, because matchers
filter by tool name only. In the overwhelming majority of cases it exits on its first line.
The cost is one `bash` + `jq` invocation.

`hooks.json` supports an `if` field for command-level prefiltering
(`"if": "Bash(git merge:*)"`, used by the official `security-guidance` plugin), which would
avoid that spawn. It is deliberately not used here: when the `rtk` proxy is installed it
rewrites `git` commands in its own `PreToolUse` hook, and whether `if` is evaluated before or
after that rewrite has not been verified. The in-script gate is correct either way.

---

## 4. Where the code is

These notes record *why*, not *what* — duplicating source into docs guarantees drift.

| File | Responsibility |
| --- | --- |
| `hooks/hooks.json` | mount points |
| `hooks/dispatch.sh` | all logic, ~130 lines |
| `targets.json` | target registry: which skill invocation maps to which policy directory |
| `policy/<target>/implement-preflight.md` | injected when the target is invoked |
| `policy/<target>/implement-closeout.md` | the close-out checklist |
| `policy/<target>/no-tracker.md` | shown when the repo has no tracker configured |

Everything under `policy/` is plain Markdown. Changing the rules is not a code change.

---

## 5. Verifying an install

Hook changes only take effect in a **new session**. Before relying on any of this, confirm
which path `/implement` actually travels by installing this as the only hook and running it
once:

```bash
jq -c '{e:.hook_event_name,t:.tool_name,s:.tool_input.skill,p:(.prompt//""|.[0:80])}' >> /tmp/hook-probe.log
```

- only `UserPromptSubmit` appears → the `prompt` branch is doing the work
- `PreToolUse` with `tool_name:"Skill"` also appears → the `skill` branch is live too

Both branches are kept. The only cost of both firing is one duplicated injection, which the
model reconciles.

Acceptance checks:

| Check | How | Expected |
| --- | --- | --- |
| No leakage | new session, no `/implement`, run `git merge foo` | not rewritten |
| Session isolation | session A runs a target, session B merges in the same repo | B unaffected |
| Gate works | inside session A, `git merge foo` | becomes `git merge --no-ff foo`, with a system message |
| Worktree protection | during a run, `ExitWorktree` with `remove` | denied |
| Cleanup | after the session ends, `ls $TMPDIR/skills-presets-*` | that session's file is gone |

---

## 6. Known limits

### 6.1 The worktree rule is advisory

`EnterWorktree` can only be invoked by the model; hooks cannot call tools. So this rule cannot
be made hard the way `--no-ff` is. It does, however, land on an officially sanctioned path —
the tool's own contract reads:

> Use this tool ONLY when explicitly instructed to work in a worktree — either by the user
> directly, **or by project instructions (CLAUDE.md / memory)**.

The injected preflight is exactly such an instruction. Adding one line to the target repo's
`CLAUDE.md` gives a second anchor:

```markdown
Every implement run happens in its own worktree, named `ticket-<id>-<slug>`.
```

### 6.2 Merges you type yourself are not covered

An earlier draft set `git config --local merge.ff false`. It was removed on purpose: that
changes what happens when a *human* runs `git merge`, which is well outside the scope of
configuring a skill. The consequence is explicit — **hooks only observe the agent's tool
calls, so a merge you type in a terminal has nothing enforcing `--no-ff`**. Anyone who prefers
the trade the other way can add that one line back.

### 6.3 Tracker compatibility

| Tracker | Detected by (first line) | Ticket reference | Worktree name |
| --- | --- | --- | --- |
| GitHub | `# Issue tracker: GitHub` | `#11` | `ticket-11-<title slug>` |
| GitLab | `# Issue tracker: GitLab` | `#11` | same |
| Local markdown | `# Issue tracker: Local Markdown` | `.scratch/<feature>/issues/03-login.md` | `ticket-03-login` (the filename already carries it) |
| Freeform | none of the above | unknown | the model reads that file and decides |

Two consequences worth knowing:

- **The local-markdown tracker has no global numbering.** Tickets are numbered from `01`
  within each feature directory, so `/implement #11` is meaningless there. The preflight
  branches on tracker kind for this reason.
- **GitHub shares one number space between issues and PRs**, so `#42` may be either. The
  upstream template documents the resolution (try `gh pr view`, fall back to `gh issue view`);
  this plugin does not reimplement it.

### 6.4 Two matching surfaces need two patterns

A target is matched against two very different inputs, and `targets.json` gives each its own
pattern for that reason:

| Field | Matched against | Why it differs |
| --- | --- | --- |
| `match_prompt` | the user's raw prompt — free text | the bare word "implement" turns up constantly in ordinary requests, so only the slash-command form may count |
| `match_skill` | `tool_input.skill` — a short controlled name | anchored exactly, e.g. `implement` or `mattpocock-skills:implement` |

Sharing one pattern across both looks tidy and is wrong. A single
`(^|[/:[:space:]])implement\b` opened the gate on *"please implement this function"* and on
any sentence containing the word, injecting a whole preflight that told the agent to create a
worktree and claim a ticket. Verified behaviour, not a hypothetical:

| Prompt | Before | After |
| --- | --- | --- |
| `/implement #11` | opens | opens |
| `/mattpocock-skills:implement #11` | opens | opens |
| `please implement this function` | **opens** | no match |
| `we should implement caching` | **opens** | no match |
| `reimplemented it` | no match | no match |

The lesson generalises to any target added later: **anything matched against free-form user
text must require a syntactically distinctive form**, not a keyword.

### 6.5 Sessions that start inside a worktree

Claude Code's desktop app has a **worktree checkbox** on the new-session dialog. Ticking it
launches the session already inside `.claude/worktrees/<random-name>`, which breaks the naming
requirement in a quiet way: the worktree exists, so nothing looks wrong, but its name carries
no ticket id.

An earlier draft said only *"confirm the current worktree belongs to this ticket, and stop and
ask if not"*. That is too soft to rely on — a model can talk itself into "the user ticked the
box deliberately, so this is the worktree for this work" and carry on. Vague instructions to a
model are the same class of defect as a vague regex.

The preflight now computes the answer instead of asking the model to judge it, and branches on
three states:

| State | Detected by | Action |
| --- | --- | --- |
| Not in a worktree | `--git-common-dir` is the literal `.git` | `EnterWorktree` with `name` |
| In a worktree named `ticket-<ref>*` | basename match | nothing to do |
| In a worktree named anything else | basename mismatch | create a correctly named one, switch by `path`, remove the leftover |

The third case cannot be resolved automatically, and an earlier draft got this wrong by trying
to: it created the correctly-named worktree, switched into it, and removed the leftover. That
is safe only if the leftover is empty, and **a name cannot tell you whether it is**. A user who
ticked the box, worked for an hour, and then typed `/implement #2` looks identical from the
outside. Deciding for them destroys their working context.

Git's own safety nets do not cover this, which was measured rather than assumed:

| Leftover contains | `git worktree remove` without `--force` |
| --- | --- |
| Uncommitted or untracked changes | refuses |
| Commits not on the default branch | **succeeds — the directory is deleted**; only `git branch -d` then refuses, so the commits survive but the working tree does not |
| Only gitignored files (`.env`, `node_modules`, build output) | **succeeds silently** — git does not count them as dirty |

That last row also broke the first attempt at a recommendation rule, which keyed off
`git status --porcelain`. A worktree holding nothing but a `.env` full of secrets reports
clean. "Tracked-clean" is not "nothing to lose".

So the preflight now **measures three facts and hands the decision to the user**: uncommitted
changes, unmerged commits, and gitignored file count. It offers stay / switch-and-keep /
switch-and-remove, and only recommends removal when all three are empty. The hook computes the
facts so the question put to the user is concrete rather than "what do you want to do".

Two mechanics of the switch are worth recording:

- **Creating with plain `git worktree add` yields the exact name.** The random 6-character
  suffix comes from `EnterWorktree`'s `name` parameter, not from git, so a worktree created
  this way is exactly `ticket-11-add-login`.
- **`EnterWorktree` with `path` is the only way in.** Creating by `name` fails while already in
  a worktree session; the contract explicitly supports switching by `path` from inside one, and
  leaves the previous worktree on disk untouched.

**Removal has to go through git, not `ExitWorktree`.** `ExitWorktree` only ever operates on the
worktree the session entered *last*, so after a switch it would target the new one. That also
exposed a hole: `git worktree remove` bypassed the `ExitWorktree` deny entirely, so the
keep-the-worktree guarantee had a back door. The `Bash` branch now denies `git worktree remove`
for any path named `ticket-*`, while leaving other worktrees removable — which is what allows
an approved cleanup of the leftover.

The simplest way to avoid all of this is documented in the README: leave the checkbox unchecked
and let `/implement` create the worktree.

Detection uses `git rev-parse --git-common-dir` rather than a path glob: it returns the literal
`.git` in a main checkout and an absolute path to the main checkout's `.git` from inside any
linked worktree, so worktrees created outside `.claude/worktrees/` are recognised too.

### 6.6 Everything else

| Item | Note |
| --- | --- |
| `additionalContext` size cap | 8000 characters (`systemMessage` 4000, `permissionDecisionReason` 2000) |
| Hook process overhead | spawned on every Bash call, exits on the gate check |
| Merging must run in the main checkout | the branch is occupied by the worktree, so `git -C <main-checkout> merge`, and the main checkout must be clean |
| Repeat merges | keeping the worktree means later work merges again, still with `--no-ff` |
| Upstream upgrades | this attaches at the tool layer, so upstream rewording is harmless; only a renamed *skill* requires editing `targets.json` |
| Why not fork | the installed bundle lives at a versioned cache path and auto-updates, so edits are discarded on the next release |

---

## 7. rtk compatibility

**Conclusion: no detection is required. One implementation covers both cases.**

### 7.1 What rtk's hook actually does

Measured by feeding synthetic hook payloads to `rtk hook claude`:

| Command | rtk's response |
| --- | --- |
| `git merge foo` | **passes through** (no output) |
| `git merge --no-ff foo` | **passes through** |
| `git rev-parse --abbrev-ref HEAD` | **passes through** |
| `git status --porcelain` | rewritten to `rtk git status --porcelain` |
| `git worktree list` | rewritten |
| `git commit -m x` | rewritten |
| `rtk git status` (already prefixed) | passes through, never double-wrapped |

### 7.2 Why the two hooks cannot collide

The real risk is not the regex; it is **two `PreToolUse:Bash` hooks both returning
`updatedInput`**, where ordering is undefined. That situation does not arise here:

> The only command class this plugin rewrites is `git merge`, and that is precisely what rtk
> passes through. Whichever runs first, the other sees a command it does not act on.

Both orderings were checked anyway:

- rtk first (were it ever to start handling merges) → this plugin sees `rtk git merge foo`, and
  the optional `(rtk +)?` group still matches → `rtk git merge --no-ff foo`
- this plugin first → rtk sees `git merge --no-ff foo`, measured to pass through

### 7.3 Without rtk

rtk's hook is simply not registered, and `(rtk +)?` is optional, so the bare `git merge` form
matches. No branch, no detection, no configuration.

### 7.4 Why the `--porcelain` check still holds

Close-out needs to know whether the main checkout is clean, and `git status --porcelain` *is*
rewritten by rtk. Measured on the same repository:

| State | Native | Through rtk |
| --- | --- | --- |
| Clean | (empty) | (empty) |
| Untracked file present | `?? f.txt` | `?? f.txt` |

Byte-identical, so the check is unaffected. The policy still says **judge by whether the
output is empty, never parse individual lines**, in case rtk's formatting changes later.

### 7.5 Rewrite edge cases

A naive bash substitution (`${cmd/merge/merge --no-ff}`) replaces the first `merge` substring
anywhere in the command, which corrupts branch names:

```
git checkout merge-branch && git merge foo
  → git checkout merge --no-ff-branch && git merge foo     ← broken
```

The anchored regex is used instead. BSD sed (macOS) has no `\b`, so a trailing space is
appended and the subcommand is matched as the literal `merge `:

| Input | Output |
| --- | --- |
| `git merge foo` | `git merge --no-ff foo` |
| `rtk git merge foo` | `rtk git merge --no-ff foo` |
| `git -C /repo merge ticket/11-x` | `git -C /repo merge --no-ff ticket/11-x` |
| `git merge origin/merge-fix` | `git merge --no-ff origin/merge-fix` |
| `git checkout merge-branch && git merge foo` | only the second is rewritten |
| `git merge-base main HEAD` | unchanged |
| `git mergetool` | unchanged |
| `echo 'git merge'` | unchanged |

### 7.6 Recheck after an rtk upgrade

If rtk ever adds `git merge` to its filter list, the premise in §7.2 changes (both orderings
were verified safe, but it is worth knowing). Re-run the probe after upgrading:

```bash
printf '{"session_id":"p","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git merge foo"}}' | rtk hook claude
```

Empty output means it still passes through, and §7.2 holds.

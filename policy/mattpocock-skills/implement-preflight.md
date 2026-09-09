## skills-presets (active for this /implement run)

Ticket ref: **{{REF}}** — Tracker: **{{TRACKER}}** — Already in a worktree: **{{IN_WT}}**

### Ordered steps, do not skip

**1. Fetch the ticket first.** Follow this repo's `docs/agents/issue-tracker.md`, section
"When a skill says 'fetch the relevant ticket'". Do not guess the command: that file is the
single authority for how this repo's tracker works.

**2. Claim it (assign to the current user).** The same file documents this repo's **Claim**
operation. On GitHub that is `gh issue edit <n> --add-assignee @me`; on the local-markdown
tracker it is setting `Status: claimed` in the ticket file; GitLab and custom trackers each
have their own. Follow that file, never another repo's convention.

**3. Work in a worktree named for the ticket.**

Current worktree: **{{WT_NAME}}** — already named for this ticket: **{{WT_MATCHES}}**
Main checkout: `{{MAIN}}`

Project policy: every implement run happens in a worktree whose name carries the ticket id, so
it can be told apart at a glance. Take exactly one of these branches.

**(a) Not in a worktree** (`Already in a worktree` is `no`) — call `EnterWorktree` with
`name` = `ticket-<id>-<slug>`:

- GitHub / GitLab: `<id>` is the issue number, `<slug>` is the ticket title lowercased and
  hyphenated, truncated to 30 characters.
- Local markdown: the ticket filename already is `<NN>-<slug>.md`, so use it directly, e.g.
  `.scratch/auth/issues/03-login-form.md` becomes `ticket-03-login-form`.
- If no title is available, fall back to `ticket-<id>` rather than stalling.
- The harness appends a random 6-character suffix. That is expected; do not work around it.

**(b) Already in a worktree named for this ticket** (`already named` is `yes`) — nothing to do.

**(c) Already in a worktree with some other name** (`already named` is `no`) — **stop and ask
the user. Do not switch, do not create, do not remove anything until they have answered.**

This is what a session started with the worktree checkbox looks like. But it is also what a
session looks like when the user has been working in that worktree for an hour and only now
typed `/implement`. You cannot tell those apart from the name, and getting it wrong destroys
their working context. So the decision is theirs, not yours.

State of `{{WT_NAME}}`, already measured for you:

- Uncommitted or untracked changes: **{{WT_DIRTY}}**
- Commits not on the default branch: **{{WT_COMMITS}}**
- Gitignored files present (`.env`, `node_modules`, build output): **{{WT_IGNORED}}**

That third line matters more than it looks. `git worktree remove` deletes gitignored files
without counting them as dirty and without needing `--force`, so "no uncommitted changes" does
**not** mean "nothing to lose".

Put the situation to the user in plain terms — that this worktree's name carries no ticket id,
what it currently holds, and these three options:

1. **Stay here.** Work on ticket {{REF}} in this worktree as-is. The naming rule is waived for
   this run; everything else (the `--no-ff` merge, the close-out checklist) still applies.
2. **Switch, keep this one.** Create `ticket-<id>-<slug>`, move the session into it, and leave
   this worktree and its branch exactly where they are.
3. **Switch, then remove this one.** Recommend this *only* when all three facts are clean
   (`no`, `0`, `0`). If any of them shows content, present it as the destructive option and
   name what would be lost.

Recommend option 3 only when the worktree is empty on all three counts; recommend option 2 in
every other case. Then wait for an answer.

If they choose **2** or **3**:

1. Create it, exactly named (no random suffix — this is plain git, not `EnterWorktree`):

   ```
   git worktree add {{MAIN}}/.claude/worktrees/ticket-<id>-<slug> \
       -b claude/ticket-<id>-<slug> <base>
   ```

   `<base>` is `origin/<default-branch>` when that ref exists, otherwise the local default
   branch — matching what the harness would have branched from.

2. Switch the session into it: `EnterWorktree` with `path` set to that absolute path. Creating
   by `name` fails while already in a worktree session; switching by `path` is the supported
   move, and it leaves the old worktree on disk untouched.

3. **Only for option 3**, and only after they said so: `git worktree remove <old path>`, then
   `git branch -d <old branch>`. **Never `--force`, never `-D`.** If git refuses, that means
   there is work you were not told about: stop and report it, do not override.

Worth mentioning to the user once, as a tip rather than a lecture: for ticket work it is
simpler to leave the new-session worktree checkbox **unchecked** and let `/implement` create
the worktree itself, correctly named, with none of this to sort out.

Note: `git worktree remove` on any path named `ticket-*` is refused by policy. That protects
ticket worktrees and does not apply to the leftover being cleaned up here.

**4. Only then write code**, following the normal implement flow.

### At close-out: stop, do not act unilaterally

After the full test suite and `/code-review`, do **not** merge or close on your own. Present
this checklist and wait for the user to approve:

1. `git -C <main-checkout> merge --no-ff <current-branch>`
   Preconditions: the main checkout's `git status --porcelain` prints nothing, and it is on
   the default branch. **Judge by whether the output is empty, do not parse individual lines**
   (with the rtk proxy installed this command is rewritten to `rtk git status --porcelain`).
   Report honestly if a precondition fails; never work around it.
2. Close ticket {{REF}} using the **Resolve** convention in `docs/agents/issue-tracker.md`.
3. **Keep** the worktree. To leave it, call `ExitWorktree` with `action: "keep"`. When the
   harness prompts keep/remove on session exit, always choose keep.

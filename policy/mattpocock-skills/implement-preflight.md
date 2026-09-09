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

**(c) Already in a worktree with some other name** (`already named` is `no`) — this is what a
session started with the worktree checkbox looks like: the name is random and carries no ticket
id. Switch to a correctly named worktree and clean up the leftover, in this order:

1. Create it, exactly named (no random suffix, because this is plain git, not `EnterWorktree`):

   ```
   git worktree add {{MAIN}}/.claude/worktrees/ticket-<id>-<slug> \
       -b claude/ticket-<id>-<slug> <base>
   ```

   `<base>` is `origin/<default-branch>` when that ref exists, otherwise the local default
   branch — matching what the harness would have branched from.

2. Switch the session into it: `EnterWorktree` with `path` set to that absolute path.
   Creating by `name` fails while already in a worktree session; switching by `path` is the
   supported move, and it leaves the old worktree on disk untouched.

3. Remove the leftover: `git worktree remove <old worktree path>`.
   **Never pass `--force`.** If git refuses because the old worktree has changes, stop and
   report it — the user may have done work there before invoking this. Do not discard it.

4. Delete its branch: `git branch -d <old branch>`. `-d`, never `-D`; if git refuses because
   the branch is unmerged, leave it and say so.

Note: `git worktree remove` on any path named `ticket-*` is refused by policy. That refusal is
about protecting ticket worktrees, and does not apply to the leftover being cleaned up here.

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

## skills-presets close-out ({{REF}}, tracker: {{TRACKER}})

`mattpocock-skills`' `implement` has no completion step (its own docs say so), so none of the
following has happened unless you did it.

**First: is the work actually finished?** The full test suite passes and `/code-review` has
run. If not — you stopped to ask a question, or hit a blocker — ignore everything below, do
not merge, and carry on. This reminder does not fire again, so apply the close-out section of
the preflight when the work is done.

### 1. Merge — do it, no confirmation needed

Measured just now: main checkout `{{MAIN}}`, default branch `{{DEFAULT}}`, current branch
`{{BRANCH}}`. Ready to merge: **{{MAIN_READY}}**

- If that is `yes`, re-check right before merging (state may have moved since the hook ran):
  `git -C {{MAIN}} status --porcelain` prints nothing and
  `git -C {{MAIN}} branch --show-current` prints `{{DEFAULT}}`. Judge by whether the status
  output is empty; do not parse lines. Then run
  `git -C {{MAIN}} merge --no-ff {{BRANCH}}`.
- If it is anything else, do not merge and do not work around it (no stash, no checkout, no
  commit in the main checkout). Report the reason and the exact merge command for the user.
- On a conflict: `git -C {{MAIN}} merge --abort`, report the conflicting files, stop. Do not
  resolve conflicts in the main checkout on your own.
- **Never push.** The merge stays local.

`git -C <main checkout> merge` is the one operation on the main checkout this policy
sanctions from a worktree session. Run it from the worktree directory; do not `cd` there.

### 2. Close the ticket — ask once

Closing writes to the tracker, where other people see it and it cannot be taken back. Present
exactly what you would do under the **Resolve** convention in `docs/agents/issue-tracker.md`
for {{REF}} (the comment text, the close command, any follow-up that convention requires) and
wait for one yes covering all of it. If the user already said not to close, simply acknowledge.

### 3. The worktree is kept

Nothing to do or ask — removal is refused by hook. Mention it as a fact in your summary.

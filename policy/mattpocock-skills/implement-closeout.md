## skills-presets close-out ({{REF}})

Apply this once the full test suite passes and `/code-review` has run; if the work is not
there yet, carry on and come back to it. Pre-authorized — run without asking, stop at the
first failure.

Measured now: main checkout `{{MAIN}}`, default `{{DEFAULT}}`, branch `{{BRANCH}}`.
Ready to merge: **{{MAIN_READY}}** — Route: **{{ROUTE}}**

**1. Merge.** Route `exit-worktree` with Ready `yes`: `ExitWorktree` (`action: "keep"`), then
confirm `git status --porcelain` is empty (judge emptiness, not lines) and
`git branch --show-current` is `{{DEFAULT}}`, then `git merge --no-ff {{BRANCH}}`. On conflict,
`git merge --abort`.

Route `merge-request`: push `{{BRANCH}}` as `ticket/<id>-<slug>` (`git push -u origin
{{BRANCH}}:refs/heads/ticket/<id>-<slug>`) and open the MR/PR by the tracker doc's convention,
body from the `pr` skill, referencing {{REF}} with no closing keyword. Ready does not apply.
The merge lands when the user merges it: step 2 waits until they say so.

Any other route, or `exit-worktree` with Ready other than `yes`, is a failure to report.

**2. Close** {{REF}} by the Resolve convention in `docs/agents/issue-tracker.md` (comment,
close, and its follow-ups) — only after step 1 merged, and only when the ticket is **done**:
nothing in it is left for a human to perform. Re-read the ticket first. When it names
**maintainer steps** still ahead (a deploy or push the human runs, post-deploy cleanup, a
value only they can supply, anything marked HITL), keep it open: post the Resolve comment
with those steps listed in order, hand it to the human role from
`docs/agents/triage-labels.md`, and report it as left open, with the steps.

**3. Keep** the worktree. Remove it only when the user asks, after its work has landed; the
hook refuses until the branch is in the remote default branch and the worktree is clean.

**Report.** Summarize the merge commit (or the MR link), the ticket (closed, or left open with its maintainer
steps), the kept worktree. If anything did
not complete, add **Needs attention**: what failed, the error verbatim, and the fix.

| Failure | Fix |
| --- | --- |
| Route `hand-to-user` | `cd {{MAIN}} && git merge --no-ff {{BRANCH}}`, then the close commands; next time leave the worktree checkbox unchecked |
| Main checkout not ready | how to clear the stated reason, then the merge command |
| Step refused | the merge command to run by hand |
| Conflict | the files; in the worktree `git merge {{DEFAULT}}`, resolve, re-test, merge again |
| Close failed, or skipped because the merge did not land | the exact close commands |
| Push or MR creation failed | the error verbatim, then the push and MR commands to run by hand |

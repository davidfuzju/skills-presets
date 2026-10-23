## skills-presets close-out ({{REF}})

Apply this once the full test suite passes and `/code-review` has run; if the work is not
there yet, carry on and come back to it. Pre-authorized — run without asking, stop at the
first failure.

Measured now: main checkout `{{MAIN}}`, default `{{DEFAULT}}`, branch `{{BRANCH}}`.
Ready to merge: **{{MAIN_READY}}** — Route: **{{ROUTE}}**

**1. Merge.** Route `exit-worktree` with Ready `yes`: `ExitWorktree` (`action: "keep"`), then
confirm `git status --porcelain` is empty (judge emptiness, not lines) and
`git branch --show-current` is `{{DEFAULT}}`, then `git merge --no-ff {{BRANCH}}`. On conflict,
`git merge --abort`. Any other route or Ready value is a failure to report.

**2. Close** {{REF}} by the Resolve convention in `docs/agents/issue-tracker.md` (comment,
close, and its follow-ups) — only after step 1 merged, and only when the ticket is **done**:
nothing in it is left for a human to perform. Re-read the ticket first. When it names
**maintainer steps** still ahead (a deploy or push the human runs, post-deploy cleanup, a
value only they can supply, anything marked HITL), keep it open: post the Resolve comment
with those steps listed in order, hand it to the human role from
`docs/agents/triage-labels.md`, and report it as left open, with the steps.

**3. Keep** the worktree: already true.

**Report.** Summarize the merge commit, the ticket (closed, or left open with its maintainer
steps), the kept worktree. If anything did
not complete, add **Needs attention**: what failed, the error verbatim, and the fix.

| Failure | Fix |
| --- | --- |
| Route `hand-to-user` | `cd {{MAIN}} && git merge --no-ff {{BRANCH}}`, then the close commands; next time leave the worktree checkbox unchecked |
| Main checkout not ready | how to clear the stated reason, then the merge command |
| Step refused | the merge command to run by hand |
| Conflict | the files; in the worktree `git merge {{DEFAULT}}`, resolve, re-test, merge again |
| Close failed, or skipped because the merge did not land | the exact close commands |

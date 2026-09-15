## skills-presets close-out ({{REF}}, tracker: {{TRACKER}})

`mattpocock-skills`' `implement` has no completion step (its own docs say so), so none of the
following has happened unless you did it.

**First: is the work actually finished?** The full test suite passes and `/code-review` has
run. If not — you stopped to ask a question, or hit a blocker — ignore everything below and
carry on. This reminder does not fire again, so apply the close-out section of the preflight
when the work is done.

**The user has authorized all three steps in advance. Do not ask for confirmation.** Run them
in order; the moment one fails, stop there and go to *Report* — never skip ahead, never work
around a failure.

### 1. Merge

Measured just now: main checkout `{{MAIN}}`, default branch `{{DEFAULT}}`, branch to merge
`{{BRANCH}}`. Ready to merge: **{{MAIN_READY}}** — Route: **{{ROUTE}}**

A worktree-isolated session cannot run git against the main checkout: Claude Code itself
refuses it. Never try `git -C`, `cd`, `--git-dir` or `GIT_DIR` — they are refused.

**Route `exit-worktree`**, and Ready to merge is `yes`:

1. `ExitWorktree` with `action: "keep"`. The session returns to the main checkout; the
   worktree and its branch stay on disk.
2. Re-check, since state may have moved: `git status --porcelain` prints nothing (judge by
   empty output, do not parse lines) and `git branch --show-current` prints `{{DEFAULT}}`.
3. `git merge --no-ff {{BRANCH}}` — plain, no `-C`. **Never push.**
4. On a conflict: `git merge --abort` immediately, note the conflicting files, stop.

**Route `hand-to-user`**, or Ready to merge is anything but `yes`: do not merge. This is a
failure for *Report*.

### 2. Close the ticket — only if step 1 merged

Follow the **Resolve** convention in `docs/agents/issue-tracker.md` for {{REF}} in full: the
comment, the close, and any follow-up it requires. If the merge did not happen, do **not**
close — a closed ticket with unmerged code is worse than an open one.

### 3. Keep the worktree

Already true: removal is refused by hook, and step 1 used `keep`. Nothing to do.

### Report

End with a short summary: what was merged (the merge commit), what was closed, that the
worktree is kept. Then, **only if something did not complete**, a *Needs attention* section.
For each item give: what failed, the refusal or error **verbatim**, why, and a concrete fix the
user can act on — a paste-ready command where there is one. The usual cases:

| Failure | Fix to offer |
| --- | --- |
| Route `hand-to-user` (session launched inside a worktree) | `cd {{MAIN}} && git merge --no-ff {{BRANCH}}`; then close the ticket (give the exact commands); next time leave the new-session worktree checkbox unchecked so this runs automatically |
| Main checkout not ready | what is wrong (uncommitted changes / wrong branch) and how to clear it, then the merge command |
| `ExitWorktree` or merge refused | the verbatim refusal, then the merge command to run by hand |
| Merge conflict (aborted) | the files; resolve in the ticket worktree with `git merge {{DEFAULT}}`, re-run tests, then merge again |
| Ticket close failed | the error (auth, permissions, unresolved ref) and the exact close commands to run |
| Ticket left open because the merge did not happen | say so explicitly, with the close commands to run after merging |

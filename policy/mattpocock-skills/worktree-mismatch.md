   This session is in `{{WT_NAME}}`, whose name carries no ticket id. **Ask the user and wait**
   — a fresh checkbox worktree and one they have worked in for an hour look identical.
   Measured: uncommitted changes **{{WT_DIRTY}}**, unmerged commits **{{WT_COMMITS}}**,
   gitignored files **{{WT_IGNORED}}** (`git worktree remove` deletes gitignored files like
   `.env` silently, so a clean status is not "nothing to lose"). Offer:

   1. **Stay** — work here; only the naming rule is waived.
   2. **Switch, keep this one.**
   3. **Switch, remove this one** — recommend only when the three facts are `no`, `0`, `0`;
      otherwise name what would be lost.

   For 2 or 3: `git worktree add {{MAIN}}/.claude/worktrees/ticket-<id>-<slug> -b
   claude/ticket-<id>-<slug> <base>` (`<base>` = `origin/<default>` if it exists, else the local
   default), then `EnterWorktree` with that `path`. For 3 only, then `git worktree remove <old>`
   and `git branch -d <old-branch>`, without `--force` / `-D`; if git refuses, report it.

   Mention once: leaving the new-session worktree checkbox unchecked avoids all of this, and
   lets close-out merge automatically.

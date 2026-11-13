1. **Merge request.** This repo's default branch takes no direct merges (its tracker doc says
   `Merge route: merge-request`). Push the worktree's branch as `ticket/<id>-<slug>`, open an
   MR/PR into the default branch by the tracker doc's merge-request convention, body from the
   `pr` skill, referencing the ticket without a closing keyword. Stay in the worktree.
2. **Close** the ticket by the Resolve convention once the user says the MR has merged.
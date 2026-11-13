1. **Merge** `--no-ff` into the default branch, from inside the main checkout, which must be
   clean and on the default branch. This session reaches the main checkout only through
   `ExitWorktree` with `action: "keep"`; Claude Code refuses any git redirected there (`-C`,
   `cd`, `GIT_DIR`). Keep the merge local.
2. **Close** the ticket by the Resolve convention, once the merge has landed.
## skills-presets: /implement {{REF}} (tracker: {{TRACKER}})

Do these in order. `docs/agents/issue-tracker.md` is the single authority on how this repo's
tracker works; take every tracker command from it.

1. **Fetch** the ticket (its "fetch the relevant ticket" section).
2. **Claim** it (its Claim operation).
3. **Worktree** named for the ticket, so it is recognisable at a glance.
{{WORKTREE_STEP}}
4. **Implement** with the normal flow.

### Close-out

Once the full test suite passes and `/code-review` has run, do all three — the user has
authorized them in advance:

{{LAND_STEP}}
3. **Keep** the worktree; remove it only when the user asks, after its work has landed (the hook
   refuses earlier).

A close-out reminder with measured state and the route arrives when you stop. Stop at the
first step that fails, and report it with the error verbatim and a paste-ready fix.

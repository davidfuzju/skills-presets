#!/usr/bin/env bash
# skills-presets — hook dispatcher.
#
# Enforces your own workflow defaults on third-party skills you do not own,
# by attaching at the hook layer instead of forking the skill.
#
# Design rules:
#   A. Scope never leaks. PreToolUse matchers can only match a *tool name*, so a
#      bare matcher:"Bash" would fire on every Bash call in every repo and every
#      session. Branches that touch generic tools check the session gate first
#      and exit 0 when no target skill is running.
#   B. Zero domain logic. Anything a target skill already documents (e.g. how
#      this repo's issue tracker works) is delegated back to it, never
#      reimplemented here.
#
# Adding another third-party skill is a data change: append an entry to
# targets.json and create policy/<policy>/.
#
# stdin: hook JSON payload.  $1: mode.
set -uo pipefail
MODE=${1:?usage: dispatch.sh <mode>}
IN=$(cat)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SID=$(jq -r '.session_id // "unknown"' <<<"$IN")
GATE="${TMPDIR:-/tmp}/skills-presets-$SID.json"

inject() { # $1=hookEventName  $2=text
  jq -n --arg e "$1" --arg c "$2" \
    '{hookSpecificOutput:{hookEventName:$e,additionalContext:$c}}'
}

render() { # $1=template path, then placeholder/value pairs
  local tpl; tpl=$(cat "$1"); shift
  while [ $# -ge 2 ]; do tpl=${tpl//"$1"/"$2"}; shift 2; done
  printf '%s' "$tpl"
}

# --- target registry -------------------------------------------------------

# $1 = which pattern field to use, $2 = text to match against.
# The two fields are separate on purpose: a prompt is free text where the bare
# word "implement" appears all the time, so only the slash-command form counts,
# whereas a skill name is a short controlled string.
match_target() {
  # `. as $x` is required: the pipe into test() rebinds `.` to the string,
  # so a bare `.match_prompt` inside select() would index the string.
  jq -c --arg f "$1" --arg t "$2" \
    'first(.targets[] | . as $x | select($x[$f] != null and ($t | test($x[$f]))))' \
    "$ROOT/targets.json" 2>/dev/null
}

# --- mattpocock-skills helpers (rule B: identify only, never operate) -------

tracker_kind() {
  local f=docs/agents/issue-tracker.md
  [ -f "$f" ] || { echo missing; return; }
  case "$(head -1 "$f")" in
    *GitHub*)           echo github ;;
    *GitLab*)           echo gitlab ;;
    *"Local Markdown"*) echo local  ;;
    *)                  echo other  ;;
  esac
}

# Capture the raw reference only; resolving it is the model's job, because the
# shape differs per tracker (#11 on GitHub, a path on the local markdown one).
ticket_ref() {
  grep -oE '#[0-9]+|\.scratch/[^ ]+\.md|(^|[[:space:]])[0-9]{1,6}([[:space:]]|$)' \
    <<<"$1" | head -1 | tr -d ' #'
}

in_worktree() { [[ "$PWD" == */.claude/worktrees/* ]]; }

# --- preflight -------------------------------------------------------------

preflight() { # $1=target JSON  $2=raw text  $3=hookEventName
  local tgt=$1 text=$2 evt=$3
  local pol id needs_tracker
  pol=$(jq -r .policy <<<"$tgt")
  id=$(jq -r .id <<<"$tgt")
  needs_tracker=$(jq -r '.requires_tracker // false' <<<"$tgt")

  local kind=n/a ref="" wt=no
  if [ "$needs_tracker" = true ]; then
    kind=$(tracker_kind)
    if [ "$kind" = missing ]; then
      inject "$evt" "$(cat "$ROOT/policy/$pol/no-tracker.md")"
      return
    fi
    ref=$(ticket_ref "$text")
  fi
  in_worktree && wt=yes

  jq -n --arg r "$ref" --arg k "$kind" --arg p "$pol" --arg i "$id" \
    '{ref:$r,tracker:$k,policy:$p,target:$i,reminded:false}' > "$GATE"

  inject "$evt" "$(render "$ROOT/policy/$pol/implement-preflight.md" \
    '{{REF}}' "${ref:-unresolved}" '{{TRACKER}}' "$kind" '{{IN_WT}}' "$wt")"
}

# --- modes -----------------------------------------------------------------

case "$MODE" in
  prompt)
    text=$(jq -r '.prompt // ""' <<<"$IN")
    tgt=$(match_target match_prompt "$text")
    [ -n "$tgt" ] && preflight "$tgt" "$text" UserPromptSubmit
    ;;

  skill)
    s=$(jq -r '.tool_input.skill // ""' <<<"$IN")
    a=$(jq -r '.tool_input.args // ""' <<<"$IN")
    tgt=$(match_target match_skill "$s")
    [ -n "$tgt" ] && preflight "$tgt" "$s $a" PreToolUse
    ;;

  bash)
    [ -f "$GATE" ] || exit 0                    # rule A: no target running, no effect
    cmd=$(jq -r '.tool_input.command // ""' <<<"$IN")
    grep -qE -- '--no-ff|--squash|--abort|--continue' <<<"$cmd" && exit 0
    # A trailing space is appended so the subcommand matches as the literal
    # "merge " -- BSD sed (macOS) has no \b. The optional "(rtk +)?" group makes
    # this work with and without the rtk proxy installed, no detection needed.
    new=$(printf '%s ' "$cmd" | sed -E \
      's/((^|[;&|]+[[:space:]]*)(rtk +)?git +(-C +[^ ]+ +)?merge) /\1 --no-ff /')
    new=${new% }
    if [ "$new" != "$cmd" ]; then
      jq -n --arg c "$new" \
        '{hookSpecificOutput:{hookEventName:"PreToolUse",
          permissionDecision:"allow",updatedInput:{command:$c}},
          systemMessage:"skills-presets: --no-ff added"}'
    fi
    ;;

  exitwt)
    [ -f "$GATE" ] || exit 0                    # rule A: never touch other sessions
    if [ "$(jq -r '.tool_input.action // ""' <<<"$IN")" = remove ]; then
      jq -n '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",
        permissionDecisionReason:"skills-presets: ticket worktrees are kept by policy. Use action:\"keep\"."}}'
    fi
    ;;

  stop)
    [ -f "$GATE" ] || exit 0
    [ "$(jq -r .reminded "$GATE")" = true ] && exit 0    # remind once, never loop
    ref=$(jq -r .ref "$GATE"); kind=$(jq -r .tracker "$GATE"); pol=$(jq -r .policy "$GATE")
    jq '.reminded=true' "$GATE" > "$GATE.tmp" && mv "$GATE.tmp" "$GATE"
    inject Stop "$(render "$ROOT/policy/$pol/implement-closeout.md" \
      '{{REF}}' "$ref" '{{TRACKER}}' "$kind")"
    ;;

  cleanup)
    rm -f "$GATE"
    ;;
esac
exit 0

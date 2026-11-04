#!/usr/bin/env bash
# clean-worktrees.sh - remove git worktrees nobody is using, never losing work.
#
# Dry run by default. See --help. Works with bash 3.2 / BSD tools and Linux.
set -euo pipefail

# Never let our read-only inspection rewrite an index (that would bump its mtime
# and make every worktree look recently used).
export GIT_OPTIONAL_LOCKS=0

DAYS=7
APPLY=0
QUIET=0

usage() {
  cat <<'EOF'
Usage: scripts/clean-worktrees.sh [--apply] [--days N] [--quiet] [--help]

Finds git worktrees nobody is using and removes them without losing work.
Default is a dry run that prints a table: path, branch, verdict, reason.

  --apply     actually remove (git worktree remove, no --force) and prune
  --days N    idle threshold in days (default 7)
  --quiet     print only removals and errors (for hooks)
  --help      this text

Never touched: the main worktree, the worktree containing $PWD, locked
worktrees. A worktree is KEPT when it is dirty, has an operation in progress
(rebase/merge/cherry-pick), has commits not on origin (or a detached HEAD
not on any remote branch), or was active within the last N days. Branches
are never deleted and nothing is fetched.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --quiet) QUIET=1 ;;
    --days)
      shift
      [ $# -gt 0 ] || { echo "error: --days needs a number" >&2; exit 2; }
      DAYS=$1
      ;;
    --days=*) DAYS=${1#--days=} ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done
case "$DAYS" in
  ''|*[!0-9]*) echo "error: --days must be a non-negative integer" >&2; exit 2 ;;
esac

# --- locate the main worktree -------------------------------------------------
common=$(git rev-parse --git-common-dir 2>/dev/null) || {
  echo "error: not inside a git repository" >&2; exit 1; }
common=$(cd "$common" && pwd -P)
case "$common" in
  */.git) MAIN=${common%/.git} ;;
  *) MAIN=$common ;;
esac
CUR=$(pwd -P)
NOW=$(date +%s)
LIMIT=$((DAYS * 86400))

removed=0
kept=0
failed=0
missing=0

canon() { ( cd "$1" 2>/dev/null && pwd -P ) || printf '%s' "$1"; }

# mtime of a path in epoch seconds, or empty if unavailable.
# GNU first: on GNU, `stat -f %m` means "filesystem status" and would print
# garbage rather than fail, so the BSD form is only the fallback.
mtime() {
  local out
  [ -e "$1" ] || return 0
  if out=$(stat -c %Y "$1" 2>/dev/null) && is_num "$out"; then
    printf '%s' "$out"
  elif out=$(stat -f %m "$1" 2>/dev/null) && is_num "$out"; then
    printf '%s' "$out"
  fi
}
is_num() { case "$1" in ''|*[!0-9]*) return 1 ;; *) return 0 ;; esac; }

row() { # path branch verdict reason
  if [ "$QUIET" -eq 1 ] && [ "$3" != "REMOVE" ]; then return 0; fi
  printf '%-60s %-28s %-7s %s\n' "$1" "$2" "$3" "$4"
}

VERDICT=""
REASON=""

# Sets VERDICT and REASON for one worktree. Never modifies anything.
evaluate() { # path branch(or empty when detached)
  local wt=$1 branch=$2 gitdir out newest m t age

  gitdir=$(git -C "$wt" rev-parse --absolute-git-dir 2>/dev/null) || {
    VERDICT=KEEP; REASON="cannot read git dir"; return 0; }

  # Activity first, before any git command that might touch the index.
  newest=$(git -C "$wt" log -1 --format=%ct 2>/dev/null || true)
  is_num "$newest" || newest=0
  for t in "$gitdir/index" "$gitdir/HEAD" "$gitdir/logs/HEAD" "$wt"; do
    m=$(mtime "$t")
    if is_num "$m" && [ "$m" -gt "$newest" ]; then newest=$m; fi
  done
  age=$((NOW - newest))
  [ "$age" -ge 0 ] || age=0
  local idle_days=$((age / 86400))

  # dirty (ignored files don't show up in porcelain status)
  if ! out=$(git -C "$wt" status --porcelain --untracked-files=normal 2>&1); then
    VERDICT=KEEP; REASON="git status failed"; return 0
  fi
  if [ -n "$out" ]; then
    VERDICT=KEEP; REASON="dirty (uncommitted or untracked files)"; return 0
  fi

  # work not on any remote
  if [ -z "$branch" ]; then
    out=$(git -C "$wt" branch -r --contains HEAD 2>/dev/null || true)
    if [ -z "$out" ]; then
      VERDICT=KEEP; REASON="detached HEAD not contained in any remote branch"; return 0
    fi
  else
    out=$(git -C "$wt" rev-list "refs/heads/$branch" --not --remotes=origin 2>/dev/null | head -n 1 || true)
    if [ -n "$out" ]; then
      VERDICT=KEEP; REASON="unpushed commits on $branch"; return 0
    fi
  fi

  # operation in progress
  for t in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD; do
    if [ -e "$gitdir/$t" ]; then
      VERDICT=KEEP; REASON="operation in progress ($t)"; return 0
    fi
  done

  if [ "$age" -lt "$LIMIT" ]; then
    VERDICT=KEEP; REASON="recently used (idle ${idle_days}d < ${DAYS}d)"; return 0
  fi

  VERDICT=REMOVE; REASON="clean, pushed, idle ${idle_days}d"
}

# Handles one parsed porcelain record.
handle() { # path head branchref detached locked bare index
  local path=$1 branchref=$3 detached=$4 locked=$5 bare=$6 index=$7
  local cp branch label

  [ -n "$path" ] || return 0
  [ "$bare" -eq 0 ] || return 0

  if [ ! -d "$path" ]; then
    if [ "$locked" -eq 1 ]; then
      kept=$((kept + 1)); row "$path" "-" KEEP "locked (path missing)"; return 0
    fi
    missing=$((missing + 1)); kept=$((kept + 1))
    row "$path" "-" KEEP "path missing (will be pruned)"
    return 0
  fi

  cp=$(canon "$path")
  branch=""
  if [ "$detached" -eq 0 ] && [ -n "$branchref" ]; then branch=${branchref#refs/heads/}; fi
  label=${branch:-"(detached)"}

  if [ "$index" -eq 0 ] || [ "$cp" = "$MAIN" ]; then
    kept=$((kept + 1)); row "$path" "$label" KEEP "main worktree"; return 0
  fi
  if [ "$CUR" = "$cp" ] || [ "${CUR#"$cp"/}" != "$CUR" ]; then
    kept=$((kept + 1)); row "$path" "$label" KEEP "contains current directory"; return 0
  fi
  if [ "$locked" -eq 1 ]; then
    kept=$((kept + 1)); row "$path" "$label" KEEP "locked"; return 0
  fi

  evaluate "$cp" "$branch"
  if [ "$VERDICT" = "REMOVE" ]; then
    if [ "$APPLY" -eq 1 ]; then
      row "$path" "$label" REMOVE "$REASON"
      local err
      if err=$(git -C "$MAIN" worktree remove "$cp" 2>&1); then
        removed=$((removed + 1))
      else
        failed=$((failed + 1))
        echo "error: could not remove $path: $err" >&2
      fi
    else
      removed=$((removed + 1))
      row "$path" "$label" REMOVE "$REASON"
    fi
  else
    kept=$((kept + 1))
    row "$path" "$label" KEEP "$REASON"
  fi
}

# --- walk `git worktree list --porcelain` ------------------------------------
LIST=$(git -C "$MAIN" worktree list --porcelain)

if [ "$QUIET" -eq 0 ]; then
  printf '%-60s %-28s %-7s %s\n' PATH BRANCH VERDICT REASON
fi

p_path=""; p_head=""; p_branch=""; p_det=0; p_lock=0; p_bare=0; p_idx=0
flush() {
  if [ -n "$p_path" ]; then
    handle "$p_path" "$p_head" "$p_branch" "$p_det" "$p_lock" "$p_bare" "$p_idx" </dev/null
    p_idx=$((p_idx + 1))
  fi
  p_path=""; p_head=""; p_branch=""; p_det=0; p_lock=0; p_bare=0
}

while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    "") flush ;;
    "worktree "*) p_path=${line#worktree } ;;
    "HEAD "*) p_head=${line#HEAD } ;;
    "branch "*) p_branch=${line#branch } ;;
    detached) p_det=1 ;;
    locked|"locked "*) p_lock=1 ;;
    bare) p_bare=1 ;;
  esac
done <<EOF
$LIST
EOF
flush

# --- prune and summarise ------------------------------------------------------
if [ "$APPLY" -eq 1 ]; then
  git -C "$MAIN" worktree prune
  if [ "$missing" -gt 0 ] && [ "$QUIET" -eq 0 ]; then
    echo "pruned missing ($missing)"
  fi
fi

if [ "$QUIET" -eq 0 ]; then
  verb="would remove"
  [ "$APPLY" -eq 1 ] && verb="removed"
  msg="$removed $verb, $kept kept"
  [ "$failed" -eq 0 ] || msg="$msg, $failed failed"
  [ "$APPLY" -eq 1 ] || msg="$msg (dry run; use --apply)"
  echo "$msg"
fi
exit 0

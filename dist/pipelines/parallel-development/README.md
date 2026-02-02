# Parallel Development Pipeline

Generic pipeline: run 3 parallel implementors, then a reviewer, then merge the winner.

## Example run

```bash
codex-swarm parallel-development \
  --verbose \
  -i "Implement a simple Snake game in the provided repo."
```

Notes:
- The pipeline uses `.` for repo/worktree paths. Run it from the target repo directory.
- Worktrees are created under your temp directory.

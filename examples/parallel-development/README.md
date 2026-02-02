# Parallel Development Pipeline

Generic pipeline: run 3 parallel implementors, then a reviewer, then merge the winner.

## Example run

```bash
node /path/to/codex-swarm/dist/index.js /path/to/<repo>/examples/parallel-development/pipeline.yaml \
  --verbose \
  -i "Implement a simple Snake game in the provided repo."
```

Notes:
- The pipeline uses `.` for repo/worktree paths. Run it from the target repo directory, or copy/symlink the pipeline into that repo.
- Worktrees are created under your temp directory.

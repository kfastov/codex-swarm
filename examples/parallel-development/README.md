# Parallel Development Pipeline

Generic pipeline: run 3 parallel implementors, then a reviewer, then merge the winner.

## Example run

```bash
node dist/index.js examples/parallel-development/pipeline.yaml \
  --verbose \
  -i "Implement a simple Snake game in the provided repo."
```

Notes:
- The pipeline expects a sandbox repo at `/tmp/codex-swarm-battle`.
- Worktrees are created under your temp directory.

---
name: codex-swarm
description: Orchestrate codex-swarm pipelines for multi-agent development, reviews, and merges. Use when the user wants a YAML pipeline (new or existing), parallel implementations, reviewer selection, or deterministic command-node steps.
---

# Codex-Swarm Parallel Development

## Quick start

- Install the CLI: `npm install -g @kfastov/codex-swarm`.
- Use the built-in pipeline template at `examples/parallel-development/pipeline.yaml` or author a new one using `PIPELINE_SCHEMA.md`.
- Run the pipeline from the repo root so `.` resolves to the repo.
- Ensure the target repo is a git repo with at least one commit (worktrees require this).

## Workflow

1) Ensure the repo is ready for worktrees:

```bash
git status -sb
git rev-parse HEAD
```

If there is no commit yet, create one before proceeding.

2) Run the pipeline with logging:

```bash
mkdir -p /tmp/codex-swarm-logs
codex-swarm examples/parallel-development/pipeline.yaml \
  --verbose \
  -i "<task description>" \
  > /tmp/codex-swarm-logs/run.out \
  2> /tmp/codex-swarm-logs/run.err
```

3) Inspect outputs:
- `run.out` contains the JSON outputs of each node (dev-1/2/3, reviewer-1, merge-winner).
- `run.err` contains the stage completion logs and any errors.

4) Validate the result in the repo:
- `git status -sb`
- Open or run the output as appropriate for the task.

## Notes

- Use `codex exec` in pipelines (already configured) to avoid TTY issues from `codex chat`.
- The merge step wipes the repo contents except `.git`. Keep logs outside the repo and use version control/branches as needed.
- Worktrees are created under your temp directory and may need manual cleanup if runs are interrupted.

## Reference

- `PIPELINE_SCHEMA.md` describes the YAML schema and lists available pipeline templates.

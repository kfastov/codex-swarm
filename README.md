# codex-swarm

Pipeline launcher for Codex CLI. Provides staged, wired agent execution driven by a YAML/TOML pipeline file. Supports temp dirs, git worktree clones, built-in + user agent types, dry-run, parallel node execution within a stage, and command nodes.

## Install / Run (local checkout)
```bash
npm install
npm run build
node dist/index.js examples/pipeline.yaml --dry-run -i "Build me a plan"
```

## Pipeline file
- Recommended format: **YAML** (TOML also supported).
- Top-level keys: `version`, `name`, `description`, `directories`, `agent_types`, `stages`.

### Directories
```yaml
directories:
  main:
    alias: main
    kind: path
    path: .
  scratch:
    alias: scratch
    kind: temp
    base: /tmp/codex-swarm
  worktree:
    alias: worktree
    kind: worktree
    source: .
    ref: HEAD
```
Kinds: `temp` (mktemp under `base`), `path` (existing path), `worktree` (git worktree clone; CoW). Use `keep: true` to skip cleanup.

### Agent types
- Resolved from layers: built-in `src/builtin/agent-types.yaml` → `~/.codex-swarm/agent-types.{yaml,toml}` → inline `agent_types` in the pipeline file.
- Fields: `alias`, `prePrompt`, `access` (`read-only`|`read-write`), optional `command`/`args`/`env` defaults. Root/directories are set on each agent instance.

### Stages and agents
```yaml
stages:
  - alias: planning
    agents:
      - alias: planner-1
        type: planner
        input: stdin
        root: main
        directories: [main]
  - alias: implementation
    agents:
      - alias: implementor-1
        type: implementor
        input: planner-1
        root: worktree
        directories: [worktree, scratch]
      - alias: reviewer-1
        type: reviewer
        input: implementor-1
        depends_on: [implementor-1]
        root: worktree
        directories: [worktree]
```
- Nodes in a stage run in parallel when ready (dependencies satisfied).
- `input`: `stdin` (pipeline input) or another node alias; wiring resolves when dependencies are satisfied.
- `depends_on`: optional list of aliases that must complete before the node can run; does not provide input.
- `root`: directory alias to launch from; use `root` to run from pipeline cwd. Alias `root` is reserved and cannot be defined in `directories`. `directories`: aliases surfaced via template placeholder `{{directories}}` and env `CODEX_DIRECTORIES`.
- Placeholders available in prePrompt/args: `{{stdin}}`, `{{input}}`, `{{directories}}`, `{{agent}}`, `{{stage}}`.
- Environment: `CODEX_DIRECTORIES` (human list) and `CODEX_DIRECTORY_MAP` (JSON map of alias → path).

### Command nodes
```yaml
  - alias: merge
    agents:
      - alias: merge-winner
        kind: command
        input: reviewer
        depends_on: [reviewer]
        root: root
        directories: [repo, work1, work2, work3]
        command: node
        args: [scripts/merge-best.mjs]
```
- `kind: command` runs `command`/`args` directly (no Codex agent type).

## CLI
```
codex-swarm <pipeline> [options]
  -i, --input <text>      Inline pipeline input (else stdin)
  --input-file <path>     Read input from file
  --codex-bin <path>      Codex CLI binary (default: codex)
  --dry-run               Print actions without spawning agents
  --verbose               Extra logs
```
Pipeline resolution order: given path → ./ .codex-swarm/pipelines → ~/.codex-swarm/pipelines → ~/.codex-swarm → packaged `examples/`.

## Examples
- `examples/pipeline.yaml`: planner → implementor → reviewer → summarizer, using main/worktree/temp dirs.

## Notes / future
- MCP exposure not wired yet; CLI foundation in place.
- Non-git CoW clones omitted; worktree requires git present.

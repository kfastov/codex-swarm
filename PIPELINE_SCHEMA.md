# codex-swarm YAML Schema (short reference)

Use this when authoring new pipelines.

## Top-level keys

- `version`: schema version string (e.g. `"0.1"`).
- `name`: pipeline name.
- `description`: optional short description.
- `directories`: map of directory aliases to directory specs.
- `agent_types`: map of agent type aliases to agent type specs.
- `stages`: ordered list of stages; each stage has `alias` + `agents`.

## Pipeline names

CLI accepts pipeline names (no paths). Resolution order:
1) `./.codex-swarm/pipelines`
2) `~/.codex-swarm/pipelines`
3) packaged `pipelines/`

## directories

Each entry is a directory alias (used by `root`/`directories` on agents).

Common fields:
- `alias`: required string.
- `kind`: `path` | `temp` | `worktree`.

Kinds:
- `path`: `path` (existing path).
- `temp`: `base` (optional base dir for mktemp).
- `worktree`: `source` (git repo), `ref` (branch/commit), optional `keep: true`.

Reserved alias: `root` (pipeline working directory); do not define it in `directories`.

## agent_types

Define reusable agent templates:

- `alias`: required.
- `prePrompt`: text template.
- `command`: default command (e.g. `codex`).
- `args`: default args array.
- `env`: default env map.
- `access`: optional `read-only` | `read-write`.

## stages / agents (nodes)

Each stage:
- `alias`: stage name.
- `agents`: list of node definitions (agents or commands).

Agent node fields:
- `alias`: required unique node id.
- `type`: agent type alias (required for `kind: agent`).
- `kind`: `agent` (default) or `command`.
- `input`: `stdin` or another node alias.
- `depends_on`: optional list of node aliases; gating only (does not pass input).
- `root`: directory alias to run in (use `root` for pipeline cwd).
- `directories`: list of directory aliases exposed to the node.
- `env`: per-node env map (merged with agent type env).

Command nodes (`kind: command`) additionally use:
- `command`: executable to run.
- `args`: array of args.
- `input`: is piped to stdin when present.

## Templating & env

Placeholders usable in `prePrompt` and `args`:
- `{{stdin}}`, `{{input}}`, `{{directories}}`, `{{agent}}`, `{{stage}}`

Environment:
- `CODEX_DIRECTORIES` (human-readable list)
- `CODEX_DIRECTORY_MAP` (JSON map of alias -> path)

## Scheduling

- Nodes in a stage run in parallel when ready.
- A node is ready when its `depends_on` are complete and its `input` (if any) is available.
- `depends_on` can reference aliases from any earlier stage.

## Available pipelines

- `pipelines/parallel-development/pipeline.yaml` (name: `parallel-development`): best-of-3 parallel implementations + reviewer + merge winner. Use when a client wants best-of-N with automatic review and deterministic merge.

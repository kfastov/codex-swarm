A “pipeline launcher” for Codex CLI (working title: codex-swarm). It should take as input a YAML or TOML file (whichever is currently more popular and easier for agents to interpret) that describes a Codex pipeline.

The pipeline description includes:

1) Execution stages

Each stage runs a network of interconnected agents. For each stage, define:
	•	Stage alias (short name).
	•	A list of agent instances started in this stage and their parameters.
	•	Connections between agents (literal wiring): the output of agent1 is connected to the input of agent2. This can be implemented via an input parameter on the agent instance, where you specify the alias of the agent whose output should be taken and piped into this instance’s input.
	•	Definitions of the directories used by agents in this stage.

2) Agent instances

Defined inside a stage; they specify how a particular agent instance is launched in that stage:
	•	Alias of the specific instance (e.g., reviewer-1, optional).
	•	Input: can be either the output of another agent, or the pipeline’s global input, stdin.
	•	Directories: a list of directory aliases this agent can access. Prompts may contain special placeholders such as {{directories}} which the engine replaces with the concrete directory paths created by the engine.
	•	Optionally split into two parameters:
	•	root: the working directory where the agent is launched
	•	directories: the list of directories it can access and whose paths it receives via prompt substitution

3) Agent descriptions

Definitions of agent types that can be instantiated, with default parameters (can be moved into separate files):
	•	Alias (e.g., reviewer, implementor, planner, etc.).
	•	Pre-prompt: not sent as a separate request; it acts as an addition to the system prompt before the first request (e.g., “you are a reviewer; you must verify the implementation of task {{stdin}} in the following directories: {{directories}}”).
	•	Access mode: read-only for reviewers, full access for implementors.

4) Directories
	•	Each directory has an alias (referenced from agent instances), e.g. tmp-build, source-clone.
	•	Directories can be temporary (created somewhere under /tmp, one-off, then deleted). Useful for running tests/builds by a reviewer where write access is needed.
	•	Directories can be copy-on-write (CoW) clones of the main directory (for Git repositories this can be implemented via git worktree; non-Git support can be omitted for now).

Tool availability

Most importantly, this tool must be accessible either via MCP or directly via the command line (e.g., npx codex-swarm pipeline.toml; package name is illustrative).

Pipeline and agent definitions must be supported as either:
	•	Built-in (stored in the repository), or
	•	User-local (stored in ~/.codex-swarm or an equivalent per-OS location).

Implementation language

Use JavaScript/TypeScript as the most native language for Codex / Codex SDK.

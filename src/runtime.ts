import { prepareDirectory } from './directories.js';
import { runAgent } from './agentRunner.js';
import {
  AgentExecutionContext,
  ExecutionOptions,
  PipelineFile,
  DirectorySpec,
  PreparedDirectory,
  ResolvedAgentType,
  AgentInstance,
} from './types.js';

interface ExecutePipelineOptions extends ExecutionOptions {
  pipeline: PipelineFile;
  agentTypes: Record<string, ResolvedAgentType>;
  input: string;
}

export async function executePipeline(options: ExecutePipelineOptions) {
  const { pipeline, agentTypes, input, cwd } = options;
  const globalDirSpecs = pipeline.directories ?? {};
  const preparedGlobal: Record<string, PreparedDirectory> = {};
  const globalCleanups: Array<() => Promise<void>> = [];
  const outputs: Record<string, string> = {};

  try {
    assertUniqueAgentAliases(pipeline);
    for (const stage of pipeline.stages) {
      const stageSpecs = stage.directories ?? {};
      const requiredAliases = collectDirectoryAliases(stage.agents);
      const stagePrepared: Record<string, PreparedDirectory> = {};
      const stageCleanups: Array<() => Promise<void>> = [];

      try {
        for (const alias of requiredAliases) {
          if (alias === 'root') continue;

          const resolution = resolveDirectorySpec(alias, stageSpecs, globalDirSpecs);
          if (!resolution) {
            throw new Error(`Directory alias '${alias}' required in stage '${stage.alias}' is not defined.`);
          }

          if (resolution.scope === 'global') {
            if (preparedGlobal[alias]) continue;
            const prepared = await prepareDirectory(resolution.spec, stage.alias, { cwd });
            preparedGlobal[alias] = prepared;
            if (prepared.cleanup) globalCleanups.push(prepared.cleanup);
          } else {
            if (stagePrepared[alias]) continue;
            const prepared = await prepareDirectory(resolution.spec, stage.alias, { cwd });
            stagePrepared[alias] = prepared;
            if (prepared.cleanup) stageCleanups.push(prepared.cleanup);
          }
        }

        const directoryMap = { ...preparedGlobal, ...stagePrepared };
        const stageOutputs = await executeStage(
          stage.alias,
          stage.agents,
          agentTypes,
          directoryMap,
          outputs,
          input,
          options
        );
        Object.assign(outputs, stageOutputs);
      } finally {
        await runCleanups(stageCleanups, options.verbose);
      }
    }
  } finally {
    await runCleanups(globalCleanups, options.verbose);
  }

  return outputs;
}

function resolveDirectorySpec(
  alias: string,
  stageSpecs: Record<string, DirectorySpec | { from: string }>,
  globalSpecs: Record<string, DirectorySpec>
): { spec: DirectorySpec; scope: 'stage' | 'global' } | undefined {
  const stageSpec = stageSpecs[alias];
  if (stageSpec) {
    if ('from' in stageSpec) {
      const ref = stageSpec.from;
      const baseSpec = globalSpecs[ref];
      if (!baseSpec) {
        throw new Error(`Stage directory '${alias}' references unknown global alias '${ref}'.`);
      }
      return { spec: { ...baseSpec, alias }, scope: 'stage' };
    }
    return { spec: stageSpec as DirectorySpec, scope: 'stage' };
  }
  const globalSpec = globalSpecs[alias];
  if (globalSpec) return { spec: globalSpec, scope: 'global' };
  return undefined;
}

function collectDirectoryAliases(agents: AgentInstance[]): Set<string> {
  const aliases = new Set<string>();
  for (const agent of agents) {
    if (agent.root) aliases.add(agent.root);
    (agent.directories ?? []).forEach((d) => aliases.add(d));
  }
  return aliases;
}

async function executeStage(
  stageAlias: string,
  agents: AgentInstance[],
  agentTypes: Record<string, ResolvedAgentType>,
  directoryMap: Record<string, PreparedDirectory>,
  outputs: Record<string, string>,
  pipelineInput: string,
  options: ExecutionOptions
): Promise<Record<string, string>> {
  const pending = [...agents];
  const stageOutputs: Record<string, string> = {};
  let progress = true;

  while (pending.length && progress) {
    progress = false;
    for (let i = 0; i < pending.length; i++) {
      const agent = pending[i];
      const resolvedInput = resolveInput(agent, { ...outputs, ...stageOutputs }, pipelineInput);
      if (resolvedInput === null) continue; // dependency not ready

      const agentType = agentTypes[agent.type];
      if (!agentType) throw new Error(`Agent type '${agent.type}' not found for agent '${agent.alias}'.`);
      const ctx: AgentExecutionContext = {
        pipelineInput,
        directoryMap,
        agentTypes,
        cwd: options.cwd,
      };
      const output = await runAgent({ ...agent, stageAlias }, agentType, resolvedInput, ctx, options);
      stageOutputs[agent.alias] = output;
      pending.splice(i, 1);
      i--;
      progress = true;
      if (options.verbose) {
        console.error(`[codex-swarm] completed agent ${agent.alias}`);
      }
    }
  }

  if (pending.length) {
    const names = pending.map((a) => a.alias).join(', ');
    throw new Error(`Could not resolve inputs for agents: ${names}. Check for circular dependencies.`);
  }

  return stageOutputs;
}

function assertUniqueAgentAliases(pipeline: PipelineFile) {
  const seen = new Map<string, string>();
  for (const stage of pipeline.stages) {
    for (const agent of stage.agents) {
      const previousStage = seen.get(agent.alias);
      if (previousStage) {
        throw new Error(
          `Agent alias '${agent.alias}' is duplicated in stages '${previousStage}' and '${stage.alias}'. ` +
            `Agent aliases must be unique across the pipeline.`
        );
      }
      seen.set(agent.alias, stage.alias);
    }
  }
}

function resolveInput(agent: AgentInstance, outputs: Record<string, string>, pipelineInput: string): string | null {
  if (!agent.input || agent.input === 'stdin') return pipelineInput;
  if (outputs[agent.input]) return outputs[agent.input];
  return null;
}

async function runCleanups(cleanups: Array<() => Promise<void>>, verbose?: boolean) {
  for (const fn of cleanups.reverse()) {
    try {
      await fn();
    } catch (err) {
      if (verbose) {
        console.error('[codex-swarm] cleanup failed', err);
      }
    }
  }
}

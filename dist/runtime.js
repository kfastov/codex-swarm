import { prepareDirectory } from './directories.js';
import { runAgent } from './agentRunner.js';
export async function executePipeline(options) {
    const { pipeline, agentTypes, input, cwd } = options;
    const globalDirSpecs = pipeline.directories ?? {};
    const preparedDirectories = {};
    const cleanups = [];
    const outputs = {};
    try {
        for (const stage of pipeline.stages) {
            const stageSpecs = stage.directories ?? {};
            const requiredAliases = collectDirectoryAliases(stage.agents);
            for (const alias of requiredAliases) {
                if (preparedDirectories[alias])
                    continue;
                const spec = resolveDirectorySpec(alias, stageSpecs, globalDirSpecs);
                if (!spec) {
                    throw new Error(`Directory alias '${alias}' required in stage '${stage.alias}' is not defined.`);
                }
                const prepared = await prepareDirectory(spec, stage.alias, { cwd });
                preparedDirectories[alias] = prepared;
                if (prepared.cleanup)
                    cleanups.push(prepared.cleanup);
            }
            const stageOutputs = await executeStage(stage.alias, stage.agents, agentTypes, preparedDirectories, outputs, input, options);
            Object.assign(outputs, stageOutputs);
        }
    }
    finally {
        await runCleanups(cleanups, options.verbose);
    }
    return outputs;
}
function resolveDirectorySpec(alias, stageSpecs, globalSpecs) {
    const stageSpec = stageSpecs[alias];
    if (stageSpec) {
        if ('from' in stageSpec) {
            const ref = stageSpec.from;
            return { ...globalSpecs[ref], alias: alias ?? ref };
        }
        return stageSpec;
    }
    const globalSpec = globalSpecs[alias];
    if (globalSpec)
        return globalSpec;
    return undefined;
}
function collectDirectoryAliases(agents) {
    const aliases = new Set();
    for (const agent of agents) {
        if (agent.root)
            aliases.add(agent.root);
        (agent.directories ?? []).forEach((d) => aliases.add(d));
    }
    return aliases;
}
async function executeStage(stageAlias, agents, agentTypes, directoryMap, outputs, pipelineInput, options) {
    const pending = [...agents];
    const stageOutputs = {};
    let progress = true;
    while (pending.length && progress) {
        progress = false;
        for (let i = 0; i < pending.length; i++) {
            const agent = pending[i];
            const resolvedInput = resolveInput(agent, { ...outputs, ...stageOutputs }, pipelineInput);
            if (resolvedInput === null)
                continue; // dependency not ready
            const agentType = agentTypes[agent.type];
            if (!agentType)
                throw new Error(`Agent type '${agent.type}' not found for agent '${agent.alias}'.`);
            const ctx = {
                pipelineInput,
                directoryMap,
                agentTypes,
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
function resolveInput(agent, outputs, pipelineInput) {
    if (!agent.input || agent.input === 'stdin')
        return pipelineInput;
    if (outputs[agent.input])
        return outputs[agent.input];
    return null;
}
async function runCleanups(cleanups, verbose) {
    for (const fn of cleanups.reverse()) {
        try {
            await fn();
        }
        catch (err) {
            if (verbose) {
                console.error('[codex-swarm] cleanup failed', err);
            }
        }
    }
}

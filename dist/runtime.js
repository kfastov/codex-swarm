import { prepareDirectory } from './directories.js';
import { runAgent } from './agentRunner.js';
import { runCommand } from './commandRunner.js';
export async function executePipeline(options) {
    const { pipeline, agentTypes, input, cwd } = options;
    const workspaceCwd = options.workspaceCwd ?? cwd;
    const globalDirSpecs = pipeline.directories ?? {};
    const preparedGlobal = {};
    const globalCleanups = [];
    const outputs = {};
    try {
        const aliasMap = collectNodeAliases(pipeline);
        validateNodeReferences(pipeline, aliasMap);
        const totalStages = pipeline.stages.length;
        for (const [stageIndex, stage] of pipeline.stages.entries()) {
            process.stderr.write(`[codex-swarm] stage ${stage.alias} start (${stageIndex + 1}/${totalStages})\n`);
            const stageSpecs = stage.directories ?? {};
            const requiredAliases = collectDirectoryAliases(stage.agents);
            const stagePrepared = {};
            const stageCleanups = [];
            try {
                for (const alias of requiredAliases) {
                    if (alias === 'root')
                        continue;
                    const resolution = resolveDirectorySpec(alias, stageSpecs, globalDirSpecs);
                    if (!resolution) {
                        throw new Error(`Directory alias '${alias}' required in stage '${stage.alias}' is not defined.`);
                    }
                    if (resolution.scope === 'global') {
                        if (preparedGlobal[alias])
                            continue;
                        const prepared = await prepareDirectory(resolution.spec, stage.alias, { cwd: workspaceCwd });
                        preparedGlobal[alias] = prepared;
                        if (prepared.cleanup)
                            globalCleanups.push(prepared.cleanup);
                    }
                    else {
                        if (stagePrepared[alias])
                            continue;
                        const prepared = await prepareDirectory(resolution.spec, stage.alias, { cwd: workspaceCwd });
                        stagePrepared[alias] = prepared;
                        if (prepared.cleanup)
                            stageCleanups.push(prepared.cleanup);
                    }
                }
                const directoryMap = { ...preparedGlobal, ...stagePrepared };
                const stageOutputs = await executeStage(stage.alias, stage.agents, agentTypes, directoryMap, outputs, input, options);
                Object.assign(outputs, stageOutputs);
                process.stderr.write(`[codex-swarm] stage ${stage.alias} complete\n`);
            }
            finally {
                await runCleanups(stageCleanups, options.verbose);
            }
        }
    }
    finally {
        await runCleanups(globalCleanups, options.verbose);
    }
    return outputs;
}
function resolveDirectorySpec(alias, stageSpecs, globalSpecs) {
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
        return { spec: stageSpec, scope: 'stage' };
    }
    const globalSpec = globalSpecs[alias];
    if (globalSpec)
        return { spec: globalSpec, scope: 'global' };
    return undefined;
}
function collectDirectoryAliases(nodes) {
    const aliases = new Set();
    for (const node of nodes) {
        if (node.root)
            aliases.add(node.root);
        (node.directories ?? []).forEach((d) => aliases.add(d));
    }
    return aliases;
}
async function executeStage(stageAlias, nodes, agentTypes, directoryMap, outputs, pipelineInput, options) {
    const pending = new Map(nodes.map((node) => [node.alias, node]));
    const running = new Map();
    const stageOutputs = {};
    const ctx = {
        pipelineInput,
        directoryMap,
        agentTypes,
        cwd: options.cwd,
    };
    while (pending.size || running.size) {
        const outputsSnapshot = { ...outputs, ...stageOutputs };
        for (const [alias, node] of pending) {
            const resolvedInput = resolveInput(node, outputsSnapshot, pipelineInput);
            if (resolvedInput === null)
                continue;
            if (!areDependenciesReady(node, outputsSnapshot))
                continue;
            const controller = new AbortController();
            const nodeKind = node.kind === 'command' ? 'command' : 'agent';
            process.stderr.write(`[codex-swarm] ${nodeKind} ${alias} start (stage ${stageAlias})\n`);
            const runPromise = runNode(node, stageAlias, resolvedInput, ctx, options, controller.signal)
                .then((output) => ({ alias, output }))
                .catch((err) => {
                throw { alias, err };
            });
            running.set(alias, { promise: runPromise, controller });
            pending.delete(alias);
        }
        if (running.size === 0) {
            const names = [...pending.keys()].join(', ');
            throw new Error(`Stage '${stageAlias}' is deadlocked. Remaining nodes: ${names}. Check for depends_on/input cycles.`);
        }
        try {
            const { alias, output } = await Promise.race([...running.values()].map((entry) => entry.promise));
            running.delete(alias);
            stageOutputs[alias] = output;
            const finished = nodes.find((node) => node.alias === alias);
            const nodeKind = finished?.kind === 'command' ? 'command' : 'agent';
            process.stderr.write(`[codex-swarm] ${nodeKind} ${alias} complete (stage ${stageAlias})\n`);
        }
        catch (err) {
            for (const entry of running.values()) {
                entry.controller.abort();
            }
            await Promise.allSettled([...running.values()].map((entry) => entry.promise));
            const failedAlias = err?.alias;
            const inner = err?.err ?? err;
            if (failedAlias) {
                const message = inner?.message ?? String(inner);
                throw new Error(`Node '${failedAlias}' failed in stage '${stageAlias}': ${message}`);
            }
            throw inner;
        }
    }
    return stageOutputs;
}
function collectNodeAliases(pipeline) {
    const seen = new Map();
    pipeline.stages.forEach((stage, stageIndex) => {
        for (const node of stage.agents) {
            const previous = seen.get(node.alias);
            if (previous) {
                throw new Error(`Node alias '${node.alias}' is duplicated in stages '${previous.stageAlias}' and '${stage.alias}'. ` +
                    `Node aliases must be unique across the pipeline.`);
            }
            seen.set(node.alias, { stageAlias: stage.alias, stageIndex });
        }
    });
    return seen;
}
function validateNodeReferences(pipeline, aliasMap) {
    pipeline.stages.forEach((stage, stageIndex) => {
        for (const node of stage.agents) {
            if (node.input && node.input !== 'stdin') {
                const target = aliasMap.get(node.input);
                if (!target) {
                    throw new Error(`Node '${node.alias}' references unknown input alias '${node.input}'.`);
                }
                if (node.input === node.alias) {
                    throw new Error(`Node '${node.alias}' cannot use itself as input.`);
                }
                if (target.stageIndex > stageIndex) {
                    throw new Error(`Node '${node.alias}' in stage '${stage.alias}' depends on future input ` +
                        `'${node.input}' from stage '${target.stageAlias}'.`);
                }
            }
            for (const dep of node.depends_on ?? []) {
                const target = aliasMap.get(dep);
                if (!target) {
                    throw new Error(`Node '${node.alias}' depends_on unknown alias '${dep}'.`);
                }
                if (dep === node.alias) {
                    throw new Error(`Node '${node.alias}' cannot depend_on itself.`);
                }
                if (target.stageIndex > stageIndex) {
                    throw new Error(`Node '${node.alias}' in stage '${stage.alias}' depends on future alias ` +
                        `'${dep}' from stage '${target.stageAlias}'.`);
                }
            }
        }
    });
}
function resolveInput(node, outputs, pipelineInput) {
    if (!node.input || node.input === 'stdin')
        return pipelineInput;
    if (hasOutput(outputs, node.input))
        return outputs[node.input];
    return null;
}
function areDependenciesReady(node, outputs) {
    const deps = node.depends_on ?? [];
    return deps.every((alias) => hasOutput(outputs, alias));
}
function hasOutput(outputs, alias) {
    return Object.prototype.hasOwnProperty.call(outputs, alias);
}
async function runNode(node, stageAlias, inputText, ctx, options, signal) {
    if (node.kind === 'command') {
        return runCommand({ ...node, stageAlias }, inputText, ctx, options, { signal });
    }
    const agentType = ctx.agentTypes[node.type];
    if (!agentType)
        throw new Error(`Agent type '${node.type}' not found for agent '${node.alias}'.`);
    return runAgent({ ...node, stageAlias }, agentType, inputText, ctx, options, { signal });
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

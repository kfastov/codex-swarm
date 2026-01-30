import fs from 'fs-extra';
import path from 'path';
import yaml from 'js-yaml';
import toml from 'toml';
import { z } from 'zod';
const directorySchema = z.discriminatedUnion('kind', [
    z.object({
        alias: z.string(),
        kind: z.literal('temp'),
        base: z.string().optional(),
        description: z.string().optional(),
        keep: z.boolean().optional(),
    }),
    z.object({
        alias: z.string(),
        kind: z.literal('worktree'),
        source: z.string().optional(),
        ref: z.string().optional(),
        description: z.string().optional(),
        keep: z.boolean().optional(),
    }),
    z.object({
        alias: z.string(),
        kind: z.literal('path'),
        path: z.string(),
        description: z.string().optional(),
        keep: z.boolean().optional(),
    }),
]);
const stageDirectoryRefSchema = z.object({ from: z.string() });
const agentTypeSchema = z.object({
    alias: z.string(),
    prePrompt: z.string().optional(),
    access: z.enum(['read-only', 'read-write']).optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    defaultRoot: z.string().optional(),
    defaultDirectories: z.array(z.string()).optional(),
});
const agentInstanceSchema = z.object({
    alias: z.string(),
    type: z.string(),
    input: z.union([z.literal('stdin'), z.string()]).optional(),
    root: z.string().optional(),
    directories: z.array(z.string()).optional(),
    params: z.record(z.unknown()).optional(),
    env: z.record(z.string()).optional(),
});
const stageSchema = z.object({
    alias: z.string(),
    directories: z
        .record(z.union([directorySchema, stageDirectoryRefSchema]))
        .optional(),
    agents: z.array(agentInstanceSchema),
});
const pipelineSchema = z.object({
    version: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    directories: z.record(directorySchema).optional(),
    agent_types: z.record(agentTypeSchema).optional(),
    stages: z.array(stageSchema),
});
export async function loadPipelineFile(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = parseByExtension(raw, filePath);
    const result = pipelineSchema.parse(parsed);
    return result;
}
export function parseByExtension(raw, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.yaml' || ext === '.yml') {
        return yaml.load(raw) ?? {};
    }
    if (ext === '.toml') {
        return toml.parse(raw);
    }
    throw new Error(`Unsupported pipeline file extension: ${ext}`);
}
export async function loadAgentTypesFromFile(filePath) {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = parseByExtension(raw, filePath);
    if (!parsed || typeof parsed !== 'object') {
        throw new Error(`Agent types file ${filePath} did not parse to an object`);
    }
    const asRecord = parsed;
    const entries = {};
    for (const [alias, value] of Object.entries(asRecord)) {
        const validated = agentTypeSchema.parse({ alias, ...value });
        entries[alias] = validated;
    }
    return entries;
}
export async function loadAgentTypeLayers(options) {
    const layers = [];
    const builtinPath = path.resolve(new URL('.', import.meta.url).pathname, 'builtin/agent-types.yaml');
    if (await fs.pathExists(builtinPath)) {
        layers.push(await loadAgentTypesFromFile(builtinPath));
    }
    const home = options?.userHomeDir ?? process.env.HOME;
    if (home) {
        const userPathYaml = path.join(home, '.codex-swarm', 'agent-types.yaml');
        const userPathToml = path.join(home, '.codex-swarm', 'agent-types.toml');
        if (await fs.pathExists(userPathYaml)) {
            layers.push(await loadAgentTypesFromFile(userPathYaml));
        }
        else if (await fs.pathExists(userPathToml)) {
            layers.push(await loadAgentTypesFromFile(userPathToml));
        }
    }
    // Merge layers preserving later precedence
    return layers.reduce((acc, layer) => {
        for (const [alias, def] of Object.entries(layer)) {
            acc[alias] = def;
        }
        return acc;
    }, {});
}
export function mergeAgentTypes(base, overrides) {
    const merged = { ...base };
    if (overrides) {
        for (const [alias, def] of Object.entries(overrides)) {
            merged[alias] = { ...def, alias };
        }
    }
    return merged;
}

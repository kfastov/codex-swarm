import fs from 'fs-extra';
import path from 'path';
import yaml from 'js-yaml';
import toml from 'toml';
import { z } from 'zod';
import {
  AgentInstance,
  AgentType,
  DirectorySpec,
  PipelineFile,
  StageDirectoryRef,
  StageSpec,
  ResolvedAgentType,
} from './types.js';

const directorySchema: z.ZodType<DirectorySpec> = z.discriminatedUnion('kind', [
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

const stageDirectoryRefSchema: z.ZodType<StageDirectoryRef> = z.object({ from: z.string() });

const agentTypeSchema: z.ZodType<AgentType> = z.object({
  alias: z.string(),
  prePrompt: z.string().optional(),
  access: z.enum(['read-only', 'read-write']).optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

const agentInstanceSchema: z.ZodType<AgentInstance> = z.object({
  alias: z.string(),
  type: z.string(),
  input: z.union([z.literal('stdin'), z.string()]).optional(),
  root: z.string().optional(),
  directories: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
});

const stageSchema: z.ZodType<StageSpec> = z.object({
  alias: z.string(),
  directories: z
    .record(z.union([directorySchema, stageDirectoryRefSchema]))
    .optional(),
  agents: z.array(agentInstanceSchema),
});

const pipelineSchema: z.ZodType<PipelineFile> = z.object({
  version: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  directories: z.record(directorySchema).optional(),
  agent_types: z.record(agentTypeSchema).optional(),
  stages: z.array(stageSchema),
});

function validateDirectoryAliases(
  directories: Record<string, DirectorySpec | StageDirectoryRef> | undefined,
  context: string
) {
  if (!directories) return;
  for (const [alias, spec] of Object.entries(directories)) {
    if (alias === 'root') {
      throw new Error(`${context}: directory alias 'root' is reserved.`);
    }
    if ('from' in spec) {
      if (spec.from === 'root') {
        throw new Error(`${context}: directory ref '${alias}' cannot use reserved alias 'root'.`);
      }
      continue;
    }
    if (spec.alias !== alias) {
      throw new Error(`${context}: directory key '${alias}' does not match spec.alias '${spec.alias}'.`);
    }
    if (spec.alias === 'root') {
      throw new Error(`${context}: directory alias 'root' is reserved.`);
    }
  }
}

function validatePipeline(pipeline: PipelineFile) {
  validateDirectoryAliases(pipeline.directories, 'Pipeline directories');
  for (const stage of pipeline.stages) {
    validateDirectoryAliases(stage.directories, `Stage '${stage.alias}' directories`);
    if (!stage.directories) continue;
    for (const [alias, spec] of Object.entries(stage.directories)) {
      if ('from' in spec) {
        const ref = spec.from;
        if (!pipeline.directories || !pipeline.directories[ref]) {
          throw new Error(
            `Stage '${stage.alias}' directory '${alias}' references unknown global alias '${ref}'.`
          );
        }
      }
    }
  }
}

export async function loadPipelineFile(filePath: string): Promise<PipelineFile> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = parseByExtension(raw, filePath);
  const result = pipelineSchema.parse(parsed);
  validatePipeline(result);
  return result;
}

export function parseByExtension(raw: string, filePath: string): unknown {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.yaml' || ext === '.yml') {
    return yaml.load(raw) ?? {};
  }
  if (ext === '.toml') {
    return toml.parse(raw);
  }
  throw new Error(`Unsupported pipeline file extension: ${ext}`);
}

export async function loadAgentTypesFromFile(filePath: string): Promise<Record<string, ResolvedAgentType>> {
  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = parseByExtension(raw, filePath);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Agent types file ${filePath} did not parse to an object`);
  }
  const asRecord = parsed as Record<string, unknown>;
  const entries: Record<string, ResolvedAgentType> = {};
  for (const [alias, value] of Object.entries(asRecord)) {
    const validated = agentTypeSchema.parse({ alias, ...(value as object) });
    entries[alias] = validated;
  }
  return entries;
}

export async function loadAgentTypeLayers(options?: { userHomeDir?: string }): Promise<Record<string, ResolvedAgentType>> {
  const layers: Array<Record<string, ResolvedAgentType>> = [];

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
    } else if (await fs.pathExists(userPathToml)) {
      layers.push(await loadAgentTypesFromFile(userPathToml));
    }
  }

  // Merge layers preserving later precedence
  return layers.reduce<Record<string, ResolvedAgentType>>((acc, layer) => {
    for (const [alias, def] of Object.entries(layer)) {
      acc[alias] = def;
    }
    return acc;
  }, {});
}

export function mergeAgentTypes(
  base: Record<string, ResolvedAgentType>,
  overrides?: Record<string, AgentType>
): Record<string, ResolvedAgentType> {
  const merged = { ...base };
  if (overrides) {
    for (const [alias, def] of Object.entries(overrides)) {
      merged[alias] = { ...def, alias };
    }
  }
  return merged;
}

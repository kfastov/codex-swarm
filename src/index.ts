#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { loadPipelineFile, loadAgentTypeLayers, mergeAgentTypes } from './loader.js';
import { executePipeline } from './runtime.js';
import { PipelineFile } from './types.js';

async function readInput(options: { input?: string; inputFile?: string }): Promise<string> {
  if (options.input !== undefined) return options.input;
  if (options.inputFile) {
    return fs.readFile(options.inputFile, 'utf8');
  }
  if (!process.stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => (data += chunk));
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  }
  return '';
}

async function loadAgentTypes(pipeline: PipelineFile) {
  const base = await loadAgentTypeLayers();
  return mergeAgentTypes(base, pipeline.agent_types);
}

async function resolvePipelinePath(pipelineArg: string): Promise<string> {
  const candidates: string[] = [];
  const ext = path.extname(pipelineArg);
  const withExtensions = ext
    ? [pipelineArg]
    : [`${pipelineArg}.yaml`, `${pipelineArg}.yml`, `${pipelineArg}.toml`];

  const cwd = process.cwd();
  const home = process.env.HOME ?? '';
  const moduleRoot = path.resolve(new URL('.', import.meta.url).pathname, '.');

  for (const name of withExtensions) {
    candidates.push(path.isAbsolute(name) ? name : path.resolve(cwd, name));
    candidates.push(path.join(cwd, '.codex-swarm', 'pipelines', name));
    if (home) {
      candidates.push(path.join(home, '.codex-swarm', 'pipelines', name));
      candidates.push(path.join(home, '.codex-swarm', name));
    }
    candidates.push(path.join(moduleRoot, 'examples', name)); // packaged examples
  }

  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) return candidate;
  }

  throw new Error(`Pipeline file not found. Tried: ${candidates.join(', ')}`);
}

async function main() {
  const program = new Command();
  program
    .name('codex-swarm')
    .description('Pipeline launcher for Codex CLI')
    .argument('<pipeline>', 'Pipeline definition file (YAML or TOML)')
    .option('-i, --input <text>', 'Pipeline input text (overrides stdin)')
    .option('--input-file <path>', 'Read pipeline input from file')
    .option('--codex-bin <path>', 'Path to codex CLI binary', 'codex')
    .option('--dry-run', 'Show actions without spawning agents', false)
    .option('--verbose', 'Verbose logging', false)
    .action(async (pipelinePath: string, opts: any) => {
      const absPipelinePath = await resolvePipelinePath(pipelinePath);

      const pipeline = await loadPipelineFile(absPipelinePath);
      const input = await readInput({ input: opts.input, inputFile: opts.inputFile });
      const agentTypes = await loadAgentTypes(pipeline);

      if (opts.verbose) {
        console.error(`[codex-swarm] loaded ${Object.keys(agentTypes).length} agent types`);
      }

      const outputs = await executePipeline({
        pipeline,
        agentTypes,
        input,
        cwd: path.dirname(absPipelinePath),
        dryRun: opts.dryRun,
        codexBin: opts.codexBin,
        verbose: opts.verbose,
      });

      process.stdout.write(JSON.stringify(outputs, null, 2));
    });

  await program.parseAsync();
}

main().catch((err) => {
  console.error('[codex-swarm] error:', err.message ?? err);
  process.exit(1);
});

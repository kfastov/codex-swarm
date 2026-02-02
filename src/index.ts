#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'fs-extra';
import os from 'os';
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
  const name = pipelineArg.trim();
  if (!name) {
    throw new Error('Pipeline name is required.');
  }
  if (path.isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    throw new Error('Pipeline must be referenced by name only (no paths).');
  }

  const allowedExts = new Set(['.yaml', '.yml', '.toml']);
  const ext = path.extname(name);
  if (ext && !allowedExts.has(ext)) {
    throw new Error(`Unsupported pipeline extension: ${ext}`);
  }

  const baseName = ext ? name.slice(0, -ext.length) : name;
  const exts = ext ? [ext] : ['.yaml', '.yml', '.toml'];
  const candidates: string[] = [];
  for (const candidateExt of exts) {
    candidates.push(`${baseName}${candidateExt}`);
    candidates.push(path.join(baseName, `pipeline${candidateExt}`));
  }

  const cwd = process.cwd();
  const home = os.homedir();
  const moduleRoot = path.resolve(new URL('.', import.meta.url).pathname, '.');

  const roots = [
    path.join(cwd, '.codex-swarm', 'pipelines'),
    home ? path.join(home, '.codex-swarm', 'pipelines') : null,
    path.join(moduleRoot, 'pipelines'),
  ].filter(Boolean) as string[];

  const tried: string[] = [];
  for (const root of roots) {
    for (const candidate of candidates) {
      const full = path.join(root, candidate);
      tried.push(full);
      if (await fs.pathExists(full)) return full;
    }
  }

  throw new Error(`Pipeline not found. Tried: ${tried.join(', ')}`);
}

async function main() {
  const program = new Command();
  program
    .name('codex-swarm')
    .description('Pipeline launcher for Codex CLI')
    .argument('<pipeline>', 'Pipeline name')
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

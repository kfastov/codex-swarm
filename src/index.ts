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

const PIPELINE_EXTS = ['.yaml', '.yml', '.toml'] as const;
type PipelineExt = (typeof PIPELINE_EXTS)[number];

function isPipelineExt(ext: string): ext is PipelineExt {
  return PIPELINE_EXTS.includes(ext as PipelineExt);
}

function getPipelineRoots() {
  const cwd = process.cwd();
  const home = os.homedir();
  const moduleRoot = path.resolve(new URL('.', import.meta.url).pathname, '.');
  return {
    local: path.join(cwd, '.codex-swarm', 'pipelines'),
    global: home ? path.join(home, '.codex-swarm', 'pipelines') : '',
    packaged: path.join(moduleRoot, 'pipelines'),
  };
}

async function resolvePipelinePath(pipelineArg: string): Promise<string> {
  const name = pipelineArg.trim();
  if (!name) {
    throw new Error('Pipeline name is required.');
  }
  if (path.isAbsolute(name) || name.includes('/') || name.includes('\\')) {
    throw new Error('Pipeline must be referenced by name only (no paths).');
  }

  const allowedExts = new Set<string>(PIPELINE_EXTS);
  const ext = path.extname(name);
  if (ext && !allowedExts.has(ext)) {
    throw new Error(`Unsupported pipeline extension: ${ext}`);
  }

  const baseName = ext ? name.slice(0, -ext.length) : name;
  const exts = ext ? [ext] : [...PIPELINE_EXTS];
  const candidates: string[] = [];
  for (const candidateExt of exts) {
    candidates.push(`${baseName}${candidateExt}`);
    candidates.push(path.join(baseName, `pipeline${candidateExt}`));
  }

  const roots = Object.values(getPipelineRoots()).filter(Boolean);

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

type PipelineListing = {
  name: string;
  description: string;
};

async function readPipelineListing(
  filePath: string,
  fallbackName: string
): Promise<PipelineListing> {
  try {
    const pipeline = await loadPipelineFile(filePath);
    return {
      name: fallbackName,
      description: pipeline.description ?? pipeline.name ?? '',
    };
  } catch {
    return { name: fallbackName, description: '(invalid pipeline file)' };
  }
}

async function listPipelinesInRoot(root: string): Promise<PipelineListing[]> {
  if (!root || !(await fs.pathExists(root))) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const seen = new Set<string>();
  const results: PipelineListing[] = [];

  for (const entry of entries) {
    if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!isPipelineExt(ext)) continue;
      const name = path.basename(entry.name, ext);
      if (seen.has(name)) continue;
      const filePath = path.join(root, entry.name);
      results.push(await readPipelineListing(filePath, name));
      seen.add(name);
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirName = entry.name;
    if (seen.has(dirName)) continue;
    for (const ext of PIPELINE_EXTS) {
      const filePath = path.join(root, dirName, `pipeline${ext}`);
      if (await fs.pathExists(filePath)) {
        results.push(await readPipelineListing(filePath, dirName));
        seen.add(dirName);
        break;
      }
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name));
}

function printPipelineSection(label: string, root: string, items: PipelineListing[]) {
  if (!items.length) return;
  const maxName = Math.max(...items.map((item) => item.name.length));
  console.log(`${label} (${root}):`);
  for (const item of items) {
    const spacer = ' '.repeat(Math.max(1, maxName - item.name.length + 2));
    const desc = item.description ?? '';
    console.log(`  ${item.name}${spacer}${desc}`.trimEnd());
  }
}

async function listPipelines(): Promise<boolean> {
  const roots = getPipelineRoots();
  const local = await listPipelinesInRoot(roots.local);
  const global = roots.global ? await listPipelinesInRoot(roots.global) : [];
  const packaged = await listPipelinesInRoot(roots.packaged);

  if (!local.length && !global.length && !packaged.length) {
    console.log('No pipelines found.');
    return false;
  }

  printPipelineSection('local', './.codex-swarm/pipelines', local);
  printPipelineSection('global', roots.global, global);
  printPipelineSection('packaged', roots.packaged, packaged);
  return true;
}

async function main() {
  const program = new Command();
  program
    .name('codex-swarm')
    .description('Pipeline launcher for Codex CLI')
    .argument('[pipeline]', 'Pipeline name')
    .option('-i, --input <text>', 'Pipeline input text (overrides stdin)')
    .option('--input-file <path>', 'Read pipeline input from file')
    .option('--codex-bin <path>', 'Path to codex CLI binary', 'codex')
    .option('--dry-run', 'Show actions without spawning agents', false)
    .option('--verbose', 'Verbose logging', false)
    .option('--list-pipelines', 'List available pipelines', false)
    .action(async (pipelinePath: string | undefined, opts: any) => {
      if (opts.listPipelines) {
        await listPipelines();
        return;
      }
      if (!pipelinePath) {
        program.outputHelp();
        return;
      }
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
        workspaceCwd: process.cwd(),
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

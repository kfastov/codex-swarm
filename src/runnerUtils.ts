import { AgentExecutionContext, StageNode } from './types.js';

export function renderTemplate(text: string | undefined, ctx: Record<string, string>): string {
  if (!text) return '';
  return text.replace(/{{\s*([\w-]+)\s*}}/g, (_, key) => ctx[key] ?? '');
}

export function formatDirectoryList(node: StageNode, ctx: AgentExecutionContext): string {
  const dirAliases = node.directories ?? [];
  return dirAliases
    .map((alias) => {
      if (alias === 'root') {
        return `${alias}: ${ctx.cwd}`;
      }
      const dir = ctx.directoryMap[alias];
      return dir ? `${alias}: ${dir.path}` : `${alias}: [unresolved]`;
    })
    .join('\n');
}

export function buildDirectoryMap(node: StageNode, ctx: AgentExecutionContext): Record<string, string> {
  const dirAliases = node.directories ?? [];
  const map: Record<string, string> = {};
  for (const alias of dirAliases) {
    if (alias === 'root') {
      map[alias] = ctx.cwd;
      continue;
    }
    const dir = ctx.directoryMap[alias];
    map[alias] = dir ? dir.path : '[unresolved]';
  }
  return map;
}

export function buildTemplateContext(
  node: StageNode & { stageAlias?: string },
  inputText: string,
  ctx: AgentExecutionContext,
  directoriesText?: string
): Record<string, string> {
  return {
    directories: directoriesText ?? formatDirectoryList(node, ctx),
    stdin: ctx.pipelineInput,
    input: inputText,
    agent: node.alias,
    stage: node.stageAlias ?? '',
  };
}

export function resolveNodeCwd(
  node: StageNode & { stageAlias?: string },
  ctx: AgentExecutionContext
): string {
  if (!node.root || node.root === 'root') return ctx.cwd;
  const dir = ctx.directoryMap[node.root];
  if (!dir) {
    const stageInfo = node.stageAlias ? ` in stage '${node.stageAlias}'` : '';
    throw new Error(`Node '${node.alias}'${stageInfo} references unknown root alias '${node.root}'.`);
  }
  return dir.path;
}

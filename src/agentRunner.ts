import path from 'path';
import { execa } from 'execa';
import { AgentInstance, ResolvedAgentType, AgentExecutionContext, ExecutionOptions } from './types.js';

function renderTemplate(text: string | undefined, ctx: Record<string, string>): string {
  if (!text) return '';
  return text.replace(/{{\s*([\w-]+)\s*}}/g, (_, key) => ctx[key] ?? '');
}

function formatDirectoryList(agent: AgentInstance, ctx: AgentExecutionContext): string {
  const dirAliases = agent.directories ?? ctx.agentTypes[agent.type]?.defaultDirectories ?? [];
  const lines = dirAliases
    .map((alias) => {
      const dir = ctx.directoryMap[alias];
      return dir ? `${alias}: ${dir.path}` : `${alias}: [unresolved]`;
    })
    .join('\n');
  return lines;
}

export async function runAgent(
  agent: AgentInstance & { stageAlias?: string },
  agentType: ResolvedAgentType,
  inputText: string,
  ctx: AgentExecutionContext,
  options: ExecutionOptions
): Promise<string> {
  const directoriesText = formatDirectoryList(agent, ctx);
  const templateContext: Record<string, string> = {
    directories: directoriesText,
    stdin: ctx.pipelineInput,
    input: inputText,
    agent: agent.alias,
    stage: (agent as any).stageAlias ?? '',
  };

  const prePrompt = renderTemplate(agentType.prePrompt, templateContext).trim();
  const finalInput = renderTemplate(inputText, templateContext).trim();
  const payload = [prePrompt, finalInput].filter(Boolean).join('\n\n');

  if (options.dryRun) {
    return `[dry-run] ${agent.alias} would run ${agentType.command ?? options.codexBin ?? 'codex'} ` +
      `${(agentType.args ?? []).join(' ')}\n--- pre-prompt ---\n${prePrompt}\n--- input ---\n${finalInput}`;
  }

  const command = agentType.command ?? options.codexBin ?? 'codex';
  const args = (agentType.args ?? []).map((arg) => renderTemplate(arg, templateContext));
  const env = {
    ...process.env,
    ...agentType.env,
    ...agent.env,
    CODEX_DIRECTORIES: directoriesText,
    CODEX_AGENT_ALIAS: agent.alias,
  };

  try {
    const { stdout } = await execa(command, args, {
      input: payload,
      env,
      cwd: agent.root ? ctx.directoryMap[agent.root]?.path ?? process.cwd() : process.cwd(),
    });
    return stdout;
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      return `[simulation] Command '${command}' not found. Would have sent:\n${payload}`;
    }
    throw err;
  }
}

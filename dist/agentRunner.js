import { execa } from 'execa';
import { buildDirectoryMap, buildTemplateContext, formatDirectoryList, renderTemplate, resolveNodeCwd, } from './runnerUtils.js';
export async function runAgent(agent, agentType, inputText, ctx, options, runnerOptions) {
    const directoriesText = formatDirectoryList(agent, ctx);
    const templateContext = buildTemplateContext(agent, inputText, ctx, directoriesText);
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
        CODEX_DIRECTORY_MAP: JSON.stringify(buildDirectoryMap(agent, ctx)),
        CODEX_AGENT_ALIAS: agent.alias,
    };
    const cwd = resolveNodeCwd(agent, ctx);
    try {
        const { stdout } = await execa(command, args, {
            input: payload,
            env,
            cwd,
            signal: runnerOptions?.signal,
        });
        return stdout;
    }
    catch (err) {
        if (err?.code === 'ENOENT') {
            return `[simulation] Command '${command}' not found. Would have sent:\n${payload}`;
        }
        throw err;
    }
}

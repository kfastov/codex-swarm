import { execa } from 'execa';
import { buildDirectoryMap, buildTemplateContext, formatDirectoryList, renderTemplate, resolveNodeCwd, } from './runnerUtils.js';
export async function runCommand(node, inputText, ctx, options, runnerOptions) {
    const directoriesText = formatDirectoryList(node, ctx);
    const templateContext = buildTemplateContext(node, inputText, ctx, directoriesText);
    const command = renderTemplate(node.command, templateContext);
    const args = (node.args ?? []).map((arg) => renderTemplate(arg, templateContext));
    const finalInput = renderTemplate(inputText, templateContext);
    if (options.dryRun) {
        return `[dry-run] ${node.alias} would run ${command} ${args.join(' ')}\n--- input ---\n${finalInput}`;
    }
    const env = {
        ...process.env,
        ...node.env,
        CODEX_DIRECTORIES: directoriesText,
        CODEX_DIRECTORY_MAP: JSON.stringify(buildDirectoryMap(node, ctx)),
        CODEX_AGENT_ALIAS: node.alias,
    };
    const cwd = resolveNodeCwd(node, ctx);
    try {
        const { stdout } = await execa(command, args, {
            input: finalInput,
            env,
            cwd,
            signal: runnerOptions?.signal,
        });
        return stdout;
    }
    catch (err) {
        if (err?.code === 'ENOENT') {
            return `[simulation] Command '${command}' not found. Would have sent:\n${finalInput}`;
        }
        throw err;
    }
}

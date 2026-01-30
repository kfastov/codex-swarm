export function renderTemplate(text, ctx) {
    if (!text)
        return '';
    return text.replace(/{{\s*([\w-]+)\s*}}/g, (_, key) => ctx[key] ?? '');
}
export function formatDirectoryList(node, ctx) {
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
export function buildDirectoryMap(node, ctx) {
    const dirAliases = node.directories ?? [];
    const map = {};
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
export function buildTemplateContext(node, inputText, ctx, directoriesText) {
    return {
        directories: directoriesText ?? formatDirectoryList(node, ctx),
        stdin: ctx.pipelineInput,
        input: inputText,
        agent: node.alias,
        stage: node.stageAlias ?? '',
    };
}
export function resolveNodeCwd(node, ctx) {
    if (!node.root || node.root === 'root')
        return ctx.cwd;
    const dir = ctx.directoryMap[node.root];
    if (!dir) {
        const stageInfo = node.stageAlias ? ` in stage '${node.stageAlias}'` : '';
        throw new Error(`Node '${node.alias}'${stageInfo} references unknown root alias '${node.root}'.`);
    }
    return dir.path;
}

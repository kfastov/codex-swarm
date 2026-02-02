import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { execa } from 'execa';
function randomSuffix() {
    return Math.random().toString(36).slice(2, 8);
}
function logDirectory(alias, kind, dirPath) {
    process.stderr.write(`[codex-swarm] directory ${alias} (${kind}) -> ${dirPath}\n`);
}
export async function prepareDirectory(spec, stageAlias, options) {
    if (spec.kind === 'temp') {
        const base = spec.base ?? path.join(os.tmpdir(), 'codex-swarm');
        await fs.ensureDir(base);
        const dirPath = await fs.mkdtemp(path.join(base, `${stageAlias}-${spec.alias}-`));
        logDirectory(spec.alias, spec.kind, dirPath);
        return {
            alias: spec.alias,
            kind: spec.kind,
            path: dirPath,
            keep: spec.keep,
            stageAlias,
            cleanup: spec.keep ? undefined : async () => fs.remove(dirPath),
        };
    }
    if (spec.kind === 'path') {
        const dirPath = path.isAbsolute(spec.path) ? spec.path : path.resolve(options.cwd, spec.path);
        const exists = await fs.pathExists(dirPath);
        if (!exists)
            throw new Error(`Directory path not found for alias ${spec.alias}: ${dirPath}`);
        logDirectory(spec.alias, spec.kind, dirPath);
        return {
            alias: spec.alias,
            kind: spec.kind,
            path: dirPath,
            keep: true,
            stageAlias,
        };
    }
    if (spec.kind === 'worktree') {
        const source = spec.source ? path.resolve(options.cwd, spec.source) : options.cwd;
        const targetBase = path.join(os.tmpdir(), 'codex-swarm', 'worktrees');
        await fs.ensureDir(targetBase);
        const target = path.join(targetBase, `${stageAlias}-${spec.alias}-${randomSuffix()}`);
        const ref = spec.ref ?? 'HEAD';
        await execa('git', ['worktree', 'add', '--detach', target, ref], { cwd: source });
        logDirectory(spec.alias, spec.kind, target);
        return {
            alias: spec.alias,
            kind: spec.kind,
            path: target,
            keep: spec.keep,
            stageAlias,
            cleanup: async () => {
                if (spec.keep)
                    return;
                try {
                    await execa('git', ['worktree', 'remove', '--force', target], { cwd: source });
                }
                catch (err) {
                    // fall back to removing the directory if git cleanup fails
                    await fs.remove(target);
                    throw err;
                }
            },
        };
    }
    throw new Error(`Unsupported directory kind ${spec.kind}`);
}

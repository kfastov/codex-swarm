import fs from 'fs-extra';
import path from 'path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const srcDir = path.join(root, 'src', 'builtin');
const distDir = path.join(root, 'dist', 'builtin');
const pipelinesSrc = path.join(root, 'pipelines');
const pipelinesDist = path.join(root, 'dist', 'pipelines');
const scriptsSrc = path.join(root, 'scripts', 'merge-best.mjs');
const scriptsDistDir = path.join(root, 'dist', 'scripts');
const scriptsDist = path.join(scriptsDistDir, 'merge-best.mjs');

await fs.copy(srcDir, distDir, { overwrite: true });
await fs.copy(pipelinesSrc, pipelinesDist, { overwrite: true });
await fs.ensureDir(scriptsDistDir);
await fs.copy(scriptsSrc, scriptsDist, { overwrite: true });
console.log('Copied assets to dist');

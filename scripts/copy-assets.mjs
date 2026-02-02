import fs from 'fs-extra';
import path from 'path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const srcDir = path.join(root, 'src', 'builtin');
const distDir = path.join(root, 'dist', 'builtin');
const pipelinesSrc = path.join(root, 'pipelines');
const pipelinesDist = path.join(root, 'dist', 'pipelines');

await fs.copy(srcDir, distDir, { overwrite: true });
await fs.copy(pipelinesSrc, pipelinesDist, { overwrite: true });
console.log('Copied assets to dist');

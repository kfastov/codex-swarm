import fs from 'fs-extra';
import path from 'path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const srcDir = path.join(root, 'src', 'builtin');
const distDir = path.join(root, 'dist', 'builtin');
const examplesSrc = path.join(root, 'examples');
const examplesDist = path.join(root, 'dist', 'examples');

await fs.copy(srcDir, distDir, { overwrite: true });
await fs.copy(examplesSrc, examplesDist, { overwrite: true });
console.log('Copied assets to dist');

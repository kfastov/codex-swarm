import fs from 'fs/promises';
import path from 'path';

async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} did not parse as JSON.`);
  }
}

function ensureString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

async function ensureExists(dirPath, label) {
  try {
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(`${label} is not a directory: ${dirPath}`);
    }
  } catch (err) {
    throw new Error(`${label} not found: ${dirPath}`);
  }
}

async function syncDirectories(source, target) {
  await fs.mkdir(target, { recursive: true });

  const targetEntries = await fs.readdir(target, { withFileTypes: true });
  for (const entry of targetEntries) {
    if (entry.name === '.git') continue;
    const entryPath = path.join(target, entry.name);
    await fs.rm(entryPath, { recursive: true, force: true });
  }

  const sourceEntries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of sourceEntries) {
    if (entry.name === '.git') continue;
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(target, entry.name);
    await fs.cp(srcPath, destPath, { recursive: true });
  }
}

const rawInput = await readStdin();
const payload = parseJson(rawInput, 'stdin');
const winnerAlias = ensureString(payload.winner, 'stdin.winner');

const mapRaw = ensureString(process.env.CODEX_DIRECTORY_MAP, 'CODEX_DIRECTORY_MAP');
const directoryMap = parseJson(mapRaw, 'CODEX_DIRECTORY_MAP');
if (!directoryMap || typeof directoryMap !== 'object') {
  throw new Error('CODEX_DIRECTORY_MAP must be a JSON object.');
}

const sourcePath = ensureString(directoryMap[winnerAlias], `CODEX_DIRECTORY_MAP['${winnerAlias}']`);
const targetPath = ensureString(directoryMap.repo, "CODEX_DIRECTORY_MAP['repo']");

await ensureExists(sourcePath, `Winner directory '${winnerAlias}'`);
await ensureExists(targetPath, "Target directory 'repo'");

await syncDirectories(sourcePath, targetPath);
process.stdout.write(JSON.stringify({ merged: winnerAlias, target: targetPath }));

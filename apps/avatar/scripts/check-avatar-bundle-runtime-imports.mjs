import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const assetsDir = path.join(repoRoot, 'dist', 'assets');

async function listJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listJsFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

async function assertDistExists() {
  const info = await stat(assetsDir).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`Avatar dist assets directory is missing: ${assetsDir}`);
  }
}

function assertNoBareSchedulerImport(filePath, source) {
  const bareImportPattern = /(?:^|[;\n\r])\s*import\s*["']scheduler["']|from\s*["']scheduler["']/;
  if (bareImportPattern.test(source)) {
    throw new Error(`Avatar bundle contains bare scheduler import: ${path.relative(repoRoot, filePath)}`);
  }
}

function assertNoNodeRuntimeTransport(filePath, source) {
  const forbiddenMarkers = [
    '__vite-browser-external:tls',
    '__vite-browser-external:http2',
    '__vite-browser-external:net',
  ];
  const marker = forbiddenMarkers.find((item) => source.includes(item));
  if (marker) {
    throw new Error(`Avatar bundle contains Node runtime transport marker ${JSON.stringify(marker)}: ${path.relative(repoRoot, filePath)}`);
  }
}

await assertDistExists();
const filePaths = await listJsFiles(assetsDir);
const files = await Promise.all(filePaths.map(async (filePath) => ({
  filePath,
  source: await readFile(filePath, 'utf8'),
})));
for (const file of files) {
  assertNoBareSchedulerImport(file.filePath, file.source);
  assertNoNodeRuntimeTransport(file.filePath, file.source);
}
console.log(`[check-avatar-bundle-runtime-imports] checked ${files.length} bundle file(s)`);

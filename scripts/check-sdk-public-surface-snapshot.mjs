#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const sdkRoot = path.join(repoRoot, 'sdk');
const baselinePath = path.join(repoRoot, 'config', 'sdk-public-surface-baseline.json');

function normalizeExportStatement(statement) {
  return statement
    .replace(/\s+/g, ' ')
    .replace(/\s*([{},;])\s*/g, '$1 ')
    .replace(/\s+from\s+/g, ' from ')
    .replace(/^export\{/, 'export {')
    .replace(/^export type\{/, 'export type {')
    .trim()
    .replace(/\s*;$/, ';');
}

function collectExportStatements(source) {
  const exports = [];
  const lines = source.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed.startsWith('export ')) continue;

    if (
      /^export\s+(?:type\s+)?\{/.test(trimmed)
      || /^export\s+(?:type\s+)?\*/.test(trimmed)
    ) {
      const parts = [trimmed];
      while (!parts.join('\n').trimEnd().endsWith(';') && index + 1 < lines.length) {
        index += 1;
        parts.push(lines[index].trim());
      }
      exports.push(normalizeExportStatement(parts.join('\n')));
      continue;
    }

    const declaration = trimmed.match(/^export\s+(?:declare\s+)?(?:async\s+)?(function|class|const|let|var|type|interface|enum)\s+([A-Za-z0-9_$]+)/);
    if (declaration) {
      exports.push(`${declaration[1]} ${declaration[2]}`);
      continue;
    }

    exports.push(normalizeExportStatement(trimmed));
  }

  return exports.sort();
}

function sourcePathForExportTarget(target) {
  const targetString = String(target || '');
  if (!targetString.startsWith('./dist/') || !targetString.endsWith('.js')) {
    return null;
  }
  const relative = targetString
    .replace(/^\.\//, '')
    .replace(/^dist\//, 'src/')
    .replace(/\.js$/, '.ts');
  return path.join(sdkRoot, relative.replace(/^src\//, 'src/'));
}

function collectExportTargets(node, values = []) {
  if (!node) return values;
  if (typeof node === 'string') {
    values.push(node);
    return values;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectExportTargets(item, values);
    return values;
  }
  if (typeof node === 'object') {
    for (const value of Object.values(node)) collectExportTargets(value, values);
  }
  return values;
}

async function buildSnapshot() {
  const packageJsonPath = path.join(sdkRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const packageExports = Object.keys(packageJson.exports || {}).sort();
  const entryPoints = [];

  for (const exportKey of packageExports) {
    const exportNode = packageJson.exports[exportKey];
    const targets = collectExportTargets(exportNode);
    const defaultTarget = typeof exportNode === 'object' && exportNode
      ? exportNode.default
      : targets.find((target) => String(target).endsWith('.js'));
    const sourcePath = sourcePathForExportTarget(defaultTarget);
    if (!sourcePath) {
      entryPoints.push({
        exportKey,
        source: null,
        exports: [],
      });
      continue;
    }

    const source = await fs.readFile(sourcePath, 'utf8');
    entryPoints.push({
      exportKey,
      source: path.relative(repoRoot, sourcePath).replaceAll(path.sep, '/'),
      exports: collectExportStatements(source),
    });
  }

  return {
    version: 1,
    package: packageJson.name,
    packageExports,
    entryPoints,
  };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function runSelfTest() {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-public-surface-'));
  const source = path.join(temp, 'index.ts');
  await fs.writeFile(source, `export { B,\n  A,\n} from './a.js';\nexport type { Thing } from './types.js';\nexport function createThing() {\n  return true;\n}\nexport type Shape = { id: string };\n`, 'utf8');
  try {
    const parsed = collectExportStatements(await fs.readFile(source, 'utf8'));
    const expected = [
      "export { B, A, } from './a.js';",
      "export type { Thing} from './types.js';",
      'function createThing',
      'type Shape',
    ].sort();
    if (stableJson(parsed) !== stableJson(expected)) {
      throw new Error(`self-test mismatch\nexpected=${stableJson(expected)}actual=${stableJson(parsed)}`);
    }
    process.stdout.write('check-sdk-public-surface-snapshot self-test passed\n');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

async function main() {
  if (process.argv.includes('--self-test')) {
    await runSelfTest();
    return;
  }

  const snapshot = await buildSnapshot();
  const current = stableJson(snapshot);
  if (process.argv.includes('--write')) {
    await fs.writeFile(baselinePath, current, 'utf8');
    process.stdout.write(`wrote ${path.relative(repoRoot, baselinePath)}\n`);
    return;
  }

  let expected;
  try {
    expected = await fs.readFile(baselinePath, 'utf8');
  } catch (error) {
    process.stderr.write(`SDK public surface baseline missing: ${path.relative(repoRoot, baselinePath)}\n`);
    process.stderr.write(`Run: node scripts/check-sdk-public-surface-snapshot.mjs --write\n`);
    process.exitCode = 1;
    return;
  }

  if (expected !== current) {
    process.stderr.write('SDK public surface snapshot drift detected.\n');
    process.stderr.write(`Update intentionally with: node scripts/check-sdk-public-surface-snapshot.mjs --write\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`check-sdk-public-surface-snapshot passed (${snapshot.entryPoints.length} entry point(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`check-sdk-public-surface-snapshot failed: ${String(error)}\n`);
  process.exitCode = 1;
});

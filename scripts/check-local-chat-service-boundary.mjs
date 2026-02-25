#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const localChatSrcRoot = path.join(repoRoot, 'nimi-mods', 'local-chat', 'src');
const servicesIndexPath = path.join(localChatSrcRoot, 'services', 'index.ts');
const publicEntryPath = path.join(localChatSrcRoot, 'index.ts');

const violations = [];

function toPosixPath(value) {
  return value.replace(/\\/g, '/');
}

async function listTypeScriptFiles(dir) {
  const output = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listTypeScriptFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      output.push(fullPath);
    }
  }
  return output;
}

async function checkServicesIndexNoDataForward() {
  const content = await fs.readFile(servicesIndexPath, 'utf8');
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.includes('..')) return;
    if (!line.includes('../data/index.js')) return;
    if (!line.trim().startsWith('export')) return;
    violations.push(`services/index.ts:${index + 1} must not re-export ../data/index.js`);
  });
}

async function checkNoInternalServicesBarrelImport() {
  const files = await listTypeScriptFiles(localChatSrcRoot);
  for (const absPath of files) {
    const content = await fs.readFile(absPath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] || '';
      if (!line.includes('services/index.js')) {
        continue;
      }
      const normalizedLine = line.trim();
      const isPublicBarrelExport = absPath === publicEntryPath
        && normalizedLine === "export * from './services/index.js';";
      if (isPublicBarrelExport) {
        continue;
      }
      const relPath = toPosixPath(path.relative(repoRoot, absPath));
      violations.push(`${relPath}:${index + 1} must import direct module instead of services/index.js`);
    }
  }
}

async function main() {
  await Promise.all([
    checkServicesIndexNoDataForward(),
    checkNoInternalServicesBarrelImport(),
  ]);

  if (violations.length > 0) {
    process.stderr.write('local-chat service boundary check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`  - ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('local-chat service boundary check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-local-chat-service-boundary failed: ${String(error)}\n`);
  process.exitCode = 1;
});

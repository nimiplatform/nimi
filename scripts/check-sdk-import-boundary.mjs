#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const sdkPackageJsonPaths = [
  'sdk/packages/sdk/package.json',
  'sdk/packages/runtime/package.json',
  'sdk/packages/realm/package.json',
  'sdk/packages/mod-sdk/package.json',
  'sdk/packages/types/package.json',
  'sdk/packages/ai-provider/package.json',
].map((relative) => path.join(repoRoot, relative));

const forbiddenExportPattern = /(?:^|\/)(internal|generated)(?:\/|$)/;
const forbiddenImportPattern = /from\s+['"]@nimiplatform\/sdk(?:-[^/'"]+)?\/(?:internal|generated)\//g;

function collectExportValues(node, values) {
  if (!node) {
    return;
  }
  if (typeof node === 'string') {
    values.push(node);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectExportValues(item, values);
    }
    return;
  }
  if (typeof node === 'object') {
    for (const item of Object.values(node)) {
      collectExportValues(item, values);
    }
  }
}

async function collectSourceFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(fullPath));
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }
  return files;
}

async function main() {
  const violations = [];

  for (const packageJsonPath of sdkPackageJsonPaths) {
    const raw = await fs.readFile(packageJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    const exportValues = [];
    collectExportValues(parsed.exports, exportValues);

    for (const exportValue of exportValues) {
      if (forbiddenExportPattern.test(String(exportValue))) {
        violations.push(`forbidden export path in ${path.relative(repoRoot, packageJsonPath)} -> ${exportValue}`);
      }
    }
  }

  const sdkPackagesRoot = path.join(repoRoot, 'sdk', 'packages');
  const sourceFiles = await collectSourceFiles(sdkPackagesRoot);
  for (const file of sourceFiles) {
    const raw = await fs.readFile(file, 'utf8');
    if (forbiddenImportPattern.test(raw)) {
      violations.push(`forbidden stable import in ${path.relative(repoRoot, file)}`);
    }
  }

  if (violations.length > 0) {
    process.stderr.write('SDK import boundary violations found:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('SDK import boundary check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-sdk-import-boundary failed: ${String(error)}\n`);
  process.exitCode = 1;
});

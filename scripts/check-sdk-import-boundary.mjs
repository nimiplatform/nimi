#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const sdkPackageJsonPaths = [
  'sdk/package.json',
].map((relative) => path.join(repoRoot, relative));

const forbiddenExportPattern = /(?:^|\/)(internal|generated)(?:\/|$)/;
const forbiddenStableImportPattern = /(?:from|import)\s+['"]@nimiplatform\/sdk\/(?:internal|generated)(?:\/|['"])/;
const importTargetPattern = /(?:from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\))/g;
const consumerSourceRoots = ['apps', 'runtime', 'examples', 'scripts', 'nimi-mods'];
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const skippedDirectories = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', 'target']);

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
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skippedDirectories.has(entry.name)) {
        continue;
      }
      files.push(...await collectSourceFiles(fullPath));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function hasForbiddenSdkDeepImport(raw) {
  return forbiddenStableImportPattern.test(raw);
}

function hasForbiddenRelativeSdkImport(file, raw) {
  for (const match of raw.matchAll(importTargetPattern)) {
    const target = match[1] || match[2] || '';
    if (!target.startsWith('.') && !path.isAbsolute(target)) {
      continue;
    }
    const resolved = path.normalize(
      path.isAbsolute(target) ? target : path.resolve(path.dirname(file), target),
    );
    const normalizedTarget = resolved.split(path.sep).join('/');
    if (
      normalizedTarget.includes('/sdk/src/')
      && /\/(internal|generated)(?:\/|$)/.test(normalizedTarget)
    ) {
      return normalizedTarget;
    }
  }
  return null;
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

  const sdkSourceRoot = path.join(repoRoot, 'sdk', 'src');
  const sourceFiles = await collectSourceFiles(sdkSourceRoot);
  for (const file of sourceFiles) {
    const raw = await fs.readFile(file, 'utf8');
    if (hasForbiddenSdkDeepImport(raw)) {
      violations.push(`forbidden stable import in ${path.relative(repoRoot, file)}`);
    }
  }

  for (const relativeRoot of consumerSourceRoots) {
    const consumerFiles = await collectSourceFiles(path.join(repoRoot, relativeRoot));
    for (const file of consumerFiles) {
      const raw = await fs.readFile(file, 'utf8');
      if (hasForbiddenSdkDeepImport(raw)) {
        violations.push(`forbidden stable import in ${path.relative(repoRoot, file)}`);
      }
      const forbiddenResolvedImport = hasForbiddenRelativeSdkImport(file, raw);
      if (forbiddenResolvedImport) {
        violations.push(
          `forbidden relative sdk deep import in ${path.relative(repoRoot, file)} -> ${path.relative(repoRoot, forbiddenResolvedImport)}`,
        );
      }
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

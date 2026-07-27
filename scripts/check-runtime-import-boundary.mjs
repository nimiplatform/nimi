#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const runtimeRoot = path.join(repoRoot, 'runtime');

const SKIP_DIRS = new Set([
  '.git',
  '.cache',
  'bin',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'target',
  'tmp',
]);

const FORBIDDEN_IMPORTS = [
  {
    name: 'sdks',
    pattern: /^github\.com\/nimiplatform\/nimi\/sdks(?:\/|$)/,
  },
  {
    name: 'apps',
    pattern: /^github\.com\/nimiplatform\/nimi\/apps(?:\/|$)/,
  },
];

const PROTECTED_SERVICE_IMPORTS = [
  /^github\.com\/nimiplatform\/nimi\/runtime\/internal\/protectedlocal(?:\/|$)/,
  /^github\.com\/nimiplatform\/nimi\/runtime\/internal\/localappkernel(?:\/|$)/,
];
const PROTECTED_SERVICE_IMPORT_ALLOWLIST = new Set([
  'account', 'app', 'auth', 'connector', 'runtimeartifact', 'runtimecontrol',
]);

async function collectGoFiles(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectGoFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.go')) {
      files.push(fullPath);
    }
  }
  return files;
}

function getLine(source, index) {
  return source.slice(0, index).split('\n').length;
}

function collectImportSpecs(source) {
  const specs = [];
  const singleImportPattern = /(^|\n)\s*import\s+(?:[\w.]+\s+)?["`]([^"`]+)["`]/g;
  const blockImportPattern = /(^|\n)\s*import\s*\(([\s\S]*?)\)/g;

  for (const match of source.matchAll(singleImportPattern)) {
    specs.push({
      value: match[2],
      index: match.index + match[0].indexOf(match[2]),
    });
  }

  for (const blockMatch of source.matchAll(blockImportPattern)) {
    const blockStart = blockMatch.index + blockMatch[0].indexOf(blockMatch[2]);
    const block = blockMatch[2];
    const quotedImportPattern = /(?:^|\n)\s*(?:[\w.]+\s+)?["`]([^"`]+)["`]/g;
    for (const importMatch of block.matchAll(quotedImportPattern)) {
      specs.push({
        value: importMatch[1],
        index: blockStart + importMatch.index + importMatch[0].indexOf(importMatch[1]),
      });
    }
  }

  return specs;
}

async function collectViolations(files) {
  const violations = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    for (const spec of collectImportSpecs(source)) {
      const forbidden = FORBIDDEN_IMPORTS.find(({ pattern }) => pattern.test(spec.value));
      const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/');
      if (forbidden) {
        violations.push(`${rel}:${getLine(source, spec.index)}: runtime must not import ${forbidden.name} package "${spec.value}"`);
        continue;
      }
      const servicePackage = rel.match(/(?:^|\/)runtime\/internal\/services\/([^/]+)\//u)?.[1];
      if (servicePackage
        && !PROTECTED_SERVICE_IMPORT_ALLOWLIST.has(servicePackage)
        && PROTECTED_SERVICE_IMPORTS.some((pattern) => pattern.test(spec.value))) {
        violations.push(
          `${rel}:${getLine(source, spec.index)}: service ${servicePackage} must consume the ctx authorization decision instead of importing "${spec.value}"`,
        );
      }
    }
  }
  return violations;
}

async function main() {
  const files = await collectGoFiles(runtimeRoot);
  const violations = await collectViolations(files);
  if (violations.length > 0) {
    process.stderr.write('Runtime import boundary violations found:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`check-runtime-import-boundary passed (${files.length} Go file(s) scanned)\n`);
}

main().catch((error) => {
  process.stderr.write(`check-runtime-import-boundary failed: ${String(error)}\n`);
  process.exitCode = 1;
});

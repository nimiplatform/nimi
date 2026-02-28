#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const REQUIRED_PATHS = [
  'sdk/package.json',
  'sdk/src/index.ts',
  'sdk/src/realm/index.ts',
  'sdk/src/runtime/index.ts',
  'sdk/src/types/index.ts',
  'sdk/src/mod',
  'sdk/src/ai-provider',
  'sdk/src/scope',
];

const SCAN_ROOTS = [
  'apps',
  'sdk/src',
  'scripts',
  'nimi-mods',
  '.github/workflows',
  'package.json',
  'pnpm-workspace.yaml',
];

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'tmp',
]);

const SCAN_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.mjs',
  '.mts',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);

const FORBIDDEN_LEGACY_IMPORT_PATTERN = /@nimiplatform\/(?:sdk-realm|sdk-runtime|sdk-types|mod-sdk|ai-provider)\b/g;
const FORBIDDEN_LEGACY_PATH_PATTERN = /sdk\/packages\/(?:sdk|realm|runtime|types|mod-sdk|ai-provider)\b/g;

function normalizePath(filePath) {
  return filePath.replaceAll(path.sep, '/');
}

async function pathExists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(rootPath) {
  const absoluteRoot = path.join(repoRoot, rootPath);
  const files = [];
  let rootStat;
  try {
    rootStat = await fs.stat(absoluteRoot);
  } catch {
    return files;
  }

  async function walk(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!SCAN_EXTENSIONS.has(path.extname(entry.name))) {
        continue;
      }
      files.push(fullPath);
    }
  }

  if (rootStat.isFile()) {
    files.push(absoluteRoot);
  } else {
    await walk(absoluteRoot);
  }

  return files;
}

async function main() {
  const violations = [];

  if (await pathExists('sdk/packages')) {
    violations.push('legacy directory must not exist: sdk/packages');
  }

  for (const requiredPath of REQUIRED_PATHS) {
    if (!await pathExists(requiredPath)) {
      violations.push(`missing required single-package sdk path: ${requiredPath}`);
    }
  }

  const sdkPackageJsonPath = path.join(repoRoot, 'sdk', 'package.json');
  try {
    const sdkPackageJson = JSON.parse(await fs.readFile(sdkPackageJsonPath, 'utf8'));
    if (sdkPackageJson.name !== '@nimiplatform/sdk') {
      violations.push(`sdk/package.json name must be @nimiplatform/sdk, got ${String(sdkPackageJson.name)}`);
    }
  } catch (error) {
    violations.push(`failed to parse sdk/package.json (${String(error)})`);
  }

  const workspacePath = path.join(repoRoot, 'pnpm-workspace.yaml');
  try {
    const workspaceRaw = await fs.readFile(workspacePath, 'utf8');
    if (!workspaceRaw.includes("  - 'sdk'")) {
      violations.push("pnpm-workspace.yaml must include package entry: 'sdk'");
    }
    if (workspaceRaw.includes('sdk/packages/*')) {
      violations.push("pnpm-workspace.yaml must not include legacy entry: 'sdk/packages/*'");
    }
  } catch (error) {
    violations.push(`failed to read pnpm-workspace.yaml (${String(error)})`);
  }

  for (const scanRoot of SCAN_ROOTS) {
    const files = await collectFiles(scanRoot);
    for (const absoluteFile of files) {
      const relativeFile = normalizePath(path.relative(repoRoot, absoluteFile));
      const source = await fs.readFile(absoluteFile, 'utf8');

      FORBIDDEN_LEGACY_IMPORT_PATTERN.lastIndex = 0;
      let importMatch = FORBIDDEN_LEGACY_IMPORT_PATTERN.exec(source);
      while (importMatch) {
        violations.push(`${relativeFile} contains legacy package import token: ${importMatch[0]}`);
        importMatch = FORBIDDEN_LEGACY_IMPORT_PATTERN.exec(source);
      }

      FORBIDDEN_LEGACY_PATH_PATTERN.lastIndex = 0;
      let pathMatch = FORBIDDEN_LEGACY_PATH_PATTERN.exec(source);
      while (pathMatch) {
        violations.push(`${relativeFile} contains legacy sdk path token: ${pathMatch[0]}`);
        pathMatch = FORBIDDEN_LEGACY_PATH_PATTERN.exec(source);
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write('SDK single-package layout check failed:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('SDK single-package layout check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-sdk-single-package-layout failed: ${String(error)}\n`);
  process.exitCode = 1;
});

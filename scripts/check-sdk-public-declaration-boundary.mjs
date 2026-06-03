#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const sdkRoot = path.join(repoRoot, 'sdk');
const sdkPackagePath = path.join(sdkRoot, 'package.json');
const pnpmBin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const violations = [];

function rel(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
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

function declarationPathForExportTarget(outDir, target) {
  const targetString = String(target || '');
  if (!targetString.startsWith('./dist/')) {
    return null;
  }
  const relativeTarget = targetString
    .replace(/^\.\//u, '')
    .replace(/^dist\//u, '')
    .replace(/\.js$/u, '.d.ts');
  if (!relativeTarget.endsWith('.d.ts')) {
    return null;
  }
  return path.join(outDir, relativeTarget);
}

function resolveDeclarationSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const normalizedSpecifier = specifier.replace(/\.js$/u, '.d.ts');
  const resolved = path.resolve(path.dirname(fromFile), normalizedSpecifier);
  const candidates = [
    resolved,
    `${resolved}.d.ts`,
    path.join(resolved, 'index.d.ts'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function collectLocalDeclarationSpecifiers(source) {
  return [
    ...source.matchAll(/\b(?:from|import)\s+['"]([^'"]+)['"]/gu),
    ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu),
    ...source.matchAll(/\bimport\s+type\s+['"]([^'"]+)['"]/gu),
  ].map((match) => String(match[1] || '').trim()).filter((specifier) => specifier.startsWith('.'));
}

function collectReachableDeclarations(entryFiles) {
  const reachable = new Set();
  const queue = [...entryFiles];

  while (queue.length > 0) {
    const filePath = queue.shift();
    if (!filePath || reachable.has(filePath) || !fs.existsSync(filePath)) continue;
    reachable.add(filePath);

    const source = fs.readFileSync(filePath, 'utf8');
    for (const specifier of collectLocalDeclarationSpecifiers(source)) {
      const resolved = resolveDeclarationSpecifier(filePath, specifier);
      if (resolved && !reachable.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return [...reachable].sort();
}

function lineForIndex(source, index) {
  return source.slice(0, index).split('\n').length;
}

function scanPublicDeclaration(filePath, source) {
  const forbiddenUtilityTypePattern = /\b(Parameters|ReturnType)\s*</gu;
  for (const match of source.matchAll(forbiddenUtilityTypePattern)) {
    violations.push(`${rel(filePath)}:${lineForIndex(source, match.index || 0)} public declaration must not expose ${match[1]}<...> facade signatures`);
  }
}

function runDeclarationEmit(tempRoot, outDir) {
  const tsconfigPath = path.join(tempRoot, 'tsconfig.sdk-public-declarations.json');
  fs.writeFileSync(tsconfigPath, JSON.stringify({
    extends: path.join(sdkRoot, 'tsconfig.build.json'),
    compilerOptions: {
      declaration: true,
      declarationMap: false,
      emitDeclarationOnly: true,
      noEmit: false,
      outDir,
      sourceMap: false,
    },
  }, null, 2), 'utf8');

  const result = spawnSync(pnpmBin, ['exec', 'tsc', '-p', tsconfigPath], {
    cwd: sdkRoot,
    stdio: 'pipe',
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    throw new Error(`SDK declaration emit failed with exit code ${result.status}`);
  }
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-public-declarations-'));
  const outDir = path.join(tempRoot, 'dist');
  try {
    runDeclarationEmit(tempRoot, outDir);

    const sdkPackage = JSON.parse(fs.readFileSync(sdkPackagePath, 'utf8'));
    const entryFiles = [];
    for (const exportNode of Object.values(sdkPackage.exports || {})) {
      const targets = collectExportTargets(exportNode);
      const declarationTarget = targets.find((target) => String(target).endsWith('.d.ts'))
        || targets.find((target) => String(target).endsWith('.js'));
      const declarationPath = declarationPathForExportTarget(outDir, declarationTarget);
      if (declarationPath) {
        entryFiles.push(declarationPath);
      }
    }

    for (const filePath of collectReachableDeclarations(entryFiles)) {
      scanPublicDeclaration(filePath, fs.readFileSync(filePath, 'utf8'));
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (violations.length > 0) {
    process.stderr.write(`SDK public declaration boundary check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write('SDK public declaration boundary check passed\n');
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`SDK public declaration boundary check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

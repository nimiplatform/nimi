#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const kitRoot = path.join(repoRoot, 'kit');
const sdkContractRel = 'kit/core/src/sdk-contract.ts';
const sdkContractAbs = path.join(repoRoot, sdkContractRel);
// Keep this list narrow: Kit feature code must route all SDK usage through the
// contract file, and each SDK subpath admitted here must be a public vNext
// export used by that contract.
const allowedSdkContractSpecifiers = new Set([
  '@nimiplatform/sdk',
  '@nimiplatform/sdk/ai',
  '@nimiplatform/sdk/contracts',
  '@nimiplatform/sdk/features/conversation',
  '@nimiplatform/sdk/realm',
  '@nimiplatform/sdk/realm/generated',
  '@nimiplatform/sdk/runtime',
  '@nimiplatform/sdk/runtime/generated',
  '@nimiplatform/sdk/types',
]);
const ignoredDirectories = new Set([
  '.cache',
  'dist',
  'gen',
  'generated',
  'node_modules',
]);
const checkedExtensions = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const violations = [];

function rel(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

function walkFiles(root, files = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      walkFiles(absPath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.d.ts')) continue;
    if (!checkedExtensions.has(path.extname(entry.name))) continue;
    files.push(absPath);
  }
  return files;
}

function extractImportSpecifiers(source) {
  return [
    ...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => String(match[1] || '').trim()).filter(Boolean);
}

function isSdkSpecifier(specifier) {
  return specifier === '@nimiplatform/sdk' || specifier.startsWith('@nimiplatform/sdk/');
}

function isElectronMainHostGlue(fileRel) {
  return fileRel.startsWith('kit/shell/electron/src/main/');
}

function resolvesToSdkContract(fromFile, specifier) {
  if (!specifier.startsWith('.')) return false;
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    path.join(resolved, 'index.ts'),
    path.join(resolved, 'index.tsx'),
  ];
  return candidates.some((candidate) => path.normalize(candidate) === path.normalize(sdkContractAbs));
}

for (const filePath of walkFiles(kitRoot)) {
  const fileRel = rel(filePath);
  const specifiers = extractImportSpecifiers(fs.readFileSync(filePath, 'utf8'));

  if (fileRel === sdkContractRel) {
    for (const specifier of specifiers) {
      if (isSdkSpecifier(specifier) && !allowedSdkContractSpecifiers.has(specifier)) {
        violations.push(`${fileRel}: SDK contract imports unadmitted SDK subpath ${specifier}`);
      }
    }
    continue;
  }

  for (const specifier of specifiers) {
    if (isSdkSpecifier(specifier)) {
      if (isElectronMainHostGlue(fileRel)) {
        if (!allowedSdkContractSpecifiers.has(specifier)) {
          violations.push(`${fileRel}: Electron main host glue imports unadmitted SDK subpath ${specifier}`);
        }
        continue;
      }
      violations.push(`${fileRel}: direct SDK import is forbidden; route through @nimiplatform/kit/core/sdk-contract (${specifier})`);
    }
    if (resolvesToSdkContract(filePath, specifier)) {
      violations.push(`${fileRel}: relative sdk-contract import is forbidden; use @nimiplatform/kit/core/sdk-contract`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write(`Kit SDK contract boundary check failed:\n${violations.map((item) => `- ${item}`).join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Kit SDK contract boundary check passed\n');
}

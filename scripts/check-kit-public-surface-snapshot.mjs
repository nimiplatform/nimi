#!/usr/bin/env node

import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const kitRoot = path.join(repoRoot, 'kit');
const baselinePath = path.join(repoRoot, 'config', 'kit-public-surface-baseline.json');

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

function sourceBaseForDistRelative(distRelative) {
  if (distRelative.startsWith('features/')) {
    const parts = distRelative.split('/');
    return `${parts.slice(0, 2).join('/')}/src/${parts.slice(2).join('/')}`;
  }
  if (distRelative.startsWith('shell/')) {
    const parts = distRelative.split('/');
    return `${parts.slice(0, 2).join('/')}/src/${parts.slice(2).join('/')}`;
  }
  if (distRelative.startsWith('telemetry/')) {
    return `telemetry/src/${distRelative.replace(/^telemetry\//u, '')}`;
  }

  const [root, ...rest] = distRelative.split('/');
  return `${root}/src/${rest.join('/')}`;
}

function sourcePathForExportTarget(target) {
  const targetString = String(target || '');
  if (!targetString.startsWith('./dist/')) {
    return null;
  }

  const distRelative = targetString
    .replace(/^\.\//, '')
    .replace(/^dist\//, '')
    .replace(/\.d\.ts$/u, '')
    .replace(/\.js$/u, '')
    .replace(/\.css$/u, '.css');
  const sourceBase = sourceBaseForDistRelative(distRelative);
  const candidates = sourceBase.endsWith('.css')
    ? [sourceBase]
    : [`${sourceBase}.ts`, `${sourceBase}.tsx`, path.join(sourceBase, 'index.ts'), path.join(sourceBase, 'index.tsx')];

  for (const candidate of candidates) {
    const absPath = path.join(kitRoot, candidate);
    if (existsSync(absPath)) {
      return absPath;
    }
  }

  return null;
}

function resolveLocalSource(fromSourcePath, specifier) {
  if (!specifier.startsWith('.')) return null;

  const resolved = path.resolve(path.dirname(fromSourcePath), specifier);
  const candidates = specifier.endsWith('.js')
    ? [resolved.replace(/\.js$/, '.ts'), resolved.replace(/\.js$/, '.tsx')]
    : [`${resolved}.ts`, `${resolved}.tsx`, path.join(resolved, 'index.ts'), path.join(resolved, 'index.tsx')];

  return candidates.find((candidate) => candidate.startsWith(kitRoot) && existsSync(candidate)) || null;
}

async function collectExpandedExportStatements(sourcePath, seen = new Set()) {
  if (seen.has(sourcePath)) return [];
  seen.add(sourcePath);

  const source = await fs.readFile(sourcePath, 'utf8');
  const expanded = [];

  for (const statement of collectExportStatements(source)) {
    const starReexport = statement.match(/^export\s+\*\s+from ['"]([^'"]+)['"];$/);
    const typeStarReexport = statement.match(/^export\s+type\s+\*\s+from ['"]([^'"]+)['"];$/);
    const specifier = starReexport?.[1] || typeStarReexport?.[1];
    const localSourcePath = specifier ? resolveLocalSource(sourcePath, specifier) : null;

    if (localSourcePath) {
      expanded.push(...await collectExpandedExportStatements(localSourcePath, seen));
      continue;
    }

    expanded.push(statement);
  }

  return [...new Set(expanded)].sort();
}

function collectCssCustomProperties(source) {
  return [...source.matchAll(/(^|\s)(--[a-zA-Z0-9_-]+)\s*:/gm)]
    .map((match) => String(match[2] || '').trim())
    .filter(Boolean)
    .sort();
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
  const packageJsonPath = path.join(kitRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const packageExports = Object.keys(packageJson.exports || {}).sort();
  const entryPoints = [];

  for (const exportKey of packageExports) {
    const exportNode = packageJson.exports[exportKey];
    const targets = collectExportTargets(exportNode);
    const defaultTarget = typeof exportNode === 'object' && exportNode
      ? exportNode.default
      : targets.find((target) => String(target).endsWith('.js') || String(target).endsWith('.css'));
    const sourcePath = sourcePathForExportTarget(defaultTarget);
    if (!sourcePath) {
      throw new Error(`${exportKey}: cannot resolve package export target to kit source: ${String(defaultTarget || '')}`);
    }

    const source = await fs.readFile(sourcePath, 'utf8');
    const entryPoint = {
      exportKey,
      source: path.relative(repoRoot, sourcePath).replaceAll(path.sep, '/'),
      exports: sourcePath.endsWith('.css') ? [] : collectExportStatements(source),
    };

    if (sourcePath.endsWith('.css')) {
      entryPoint.cssCustomProperties = collectCssCustomProperties(source);
    } else {
      const expandedExports = await collectExpandedExportStatements(sourcePath);
      if (expandedExports.length > 0 && JSON.stringify(expandedExports) !== JSON.stringify(entryPoint.exports)) {
        entryPoint.expandedExports = expandedExports;
      }
    }

    entryPoints.push(entryPoint);
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

async function main() {
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
    process.stderr.write(`Kit public surface baseline missing: ${path.relative(repoRoot, baselinePath)}\n`);
    process.stderr.write(`Run: node scripts/check-kit-public-surface-snapshot.mjs --write\n`);
    process.exitCode = 1;
    return;
  }

  if (expected !== current) {
    process.stderr.write('Kit public surface snapshot drift detected.\n');
    process.stderr.write(`Update intentionally with: node scripts/check-kit-public-surface-snapshot.mjs --write\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`check-kit-public-surface-snapshot passed (${snapshot.entryPoints.length} entry point(s))\n`);
}

main().catch((error) => {
  process.stderr.write(`check-kit-public-surface-snapshot failed: ${String(error)}\n`);
  process.exitCode = 1;
});

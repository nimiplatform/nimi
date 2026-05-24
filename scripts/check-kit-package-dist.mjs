#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const kitRoot = path.join(repoRoot, 'kit');
const packageJsonPath = path.join(kitRoot, 'package.json');
const violations = [];

function fail(message) {
  violations.push(message);
}

function collectExportTargets(value, targets = []) {
  if (typeof value === 'string') {
    targets.push(value);
    return targets;
  }
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) {
      collectExportTargets(nested, targets);
    }
  }
  return targets;
}

function rel(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

function walkFiles(root, files = []) {
  if (!fs.existsSync(root)) {
    return files;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absPath, files);
    } else if (entry.isFile()) {
      files.push(absPath);
    }
  }
  return files;
}

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const packageExportKeys = new Set(Object.keys(pkg.exports || {}));

for (const [key, value] of Object.entries(pkg.exports || {})) {
  if (typeof value === 'string') {
    if (!value.startsWith('./dist/') || value.includes('/src/')) {
      fail(`${key}: export must point to dist asset, got ${value}`);
    }
    const absTarget = path.join(kitRoot, value.replace(/^\.\//, ''));
    if (!fs.existsSync(absTarget)) {
      fail(`${key}: export target missing after build: ${rel(absTarget)}`);
    }
    continue;
  }

  if (!value || typeof value !== 'object') {
    fail(`${key}: export must be a string asset or condition object`);
    continue;
  }
  for (const condition of ['types', 'import', 'default']) {
    const target = value[condition];
    if (typeof target !== 'string') {
      fail(`${key}: missing ${condition} condition`);
      continue;
    }
    if (!target.startsWith('./dist/') || target.includes('/src/')) {
      fail(`${key}: ${condition} must point to dist compiled output, got ${target}`);
    }
    const absTarget = path.join(kitRoot, target.replace(/^\.\//, ''));
    if (!fs.existsSync(absTarget)) {
      fail(`${key}: ${condition} target missing after build: ${rel(absTarget)}`);
    }
  }
}

for (const filePattern of pkg.files || []) {
  if (/\/src(?:\/|\*\*)/.test(filePattern) || filePattern.endsWith('/src/**')) {
    fail(`package files must not publish source tree: ${filePattern}`);
  }
}

for (const target of collectExportTargets(pkg.exports)) {
  if (target.includes('/src/')) {
    fail(`package export leaks source path: ${target}`);
  }
}

for (const absPath of walkFiles(path.join(kitRoot, 'dist'))) {
  if (!/\.(?:js|d\.ts)$/.test(absPath)) {
    continue;
  }
  const content = fs.readFileSync(absPath, 'utf8');
  for (const match of content.matchAll(/(?:from\s+|import\()\s*['"](@nimiplatform\/kit\/[^'"]+)['"]/g)) {
    const subpath = `.${match[1].slice('@nimiplatform/kit'.length)}`;
    if (!packageExportKeys.has(subpath)) {
      fail(`${rel(absPath)} imports unpublished kit subpath ${match[1]}`);
    }
  }
}

if (violations.length > 0) {
  process.stderr.write('Kit dist package violations found:\n');
  for (const violation of violations) {
    process.stderr.write(`- ${violation}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write('Kit dist package check passed\n');
}

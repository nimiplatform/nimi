#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const dependencySections = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];
const skippedDirectories = new Set([
  '.git',
  '.next',
  '.tmp',
  '_external',
  'archive',
  'build',
  'coverage',
  'dist',
  'dist-electron',
  'generated',
  'node_modules',
]);

function normalizePath(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join('/');
}

function walkPackageJsonFiles(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        walkPackageJsonFiles(path.join(directory, entry.name), output);
      }
      continue;
    }
    if (entry.isFile() && entry.name === 'package.json') {
      output.push(path.join(directory, entry.name));
    }
  }
  return output;
}

function sorted(value) {
  return [...value].sort((a, b) => a.localeCompare(b));
}

function exceptionFor(pkg, dependencyName) {
  const exceptions = pkg.nimi?.duplicateDependencyReferenceExceptions;
  const exception = exceptions?.[dependencyName];
  if (!exception || typeof exception !== 'object') {
    return null;
  }
  const sections = Array.isArray(exception.sections)
    ? exception.sections.map(String).sort((a, b) => a.localeCompare(b))
    : [];
  const reason = String(exception.reason || '').trim();
  return { sections, reason };
}

function isDocumentedException(pkg, dependencyName, sections) {
  const exception = exceptionFor(pkg, dependencyName);
  if (!exception || !exception.reason) {
    return false;
  }
  return JSON.stringify(exception.sections) === JSON.stringify(sorted(sections));
}

const violations = [];
for (const packageJsonPath of walkPackageJsonFiles(repoRoot).sort((a, b) => normalizePath(a).localeCompare(normalizePath(b)))) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const seen = new Map();
  for (const section of dependencySections) {
    const block = pkg[section];
    if (!block || typeof block !== 'object') {
      continue;
    }
    for (const dependencyName of Object.keys(block)) {
      const sections = seen.get(dependencyName) ?? [];
      sections.push(section);
      seen.set(dependencyName, sections);
    }
  }
  for (const [dependencyName, sections] of seen) {
    if (sections.length < 2) {
      continue;
    }
    if (isDocumentedException(pkg, dependencyName, sections)) {
      continue;
    }
    violations.push(`${normalizePath(packageJsonPath)}: ${dependencyName} appears in ${sorted(sections).join(', ')} without nimi.duplicateDependencyReferenceExceptions documentation`);
  }
}

if (violations.length > 0) {
  process.stderr.write('Package dependency duplicate references found:\n');
  for (const violation of violations) {
    process.stderr.write(`- ${violation}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write('Package dependency duplicate reference check passed\n');
}

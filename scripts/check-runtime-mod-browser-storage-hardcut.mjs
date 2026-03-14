#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const scanRoot = resolve(repoRoot, 'nimi-mods/runtime');
const allowedExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

const bannedChecks = [
  { label: 'browser localStorage', pattern: /\blocalStorage\b/g },
  { label: 'browser indexedDB', pattern: /\bindexedDB\b/g },
  { label: 'sdk local storage helper', pattern: /\bloadLocalStorageJson\b/g },
  { label: 'sdk local storage helper', pattern: /\bsaveLocalStorageJson\b/g },
  { label: 'sdk local storage helper', pattern: /\bremoveLocalStorageKey\b/g },
];

const failures = [];

function shouldSkipPath(absPath) {
  const relPath = relative(repoRoot, absPath).replaceAll('\\', '/');
  return relPath.includes('/dist/')
    || relPath.includes('/generated/')
    || relPath.includes('/node_modules/')
    || relPath.includes('/spec/')
    || relPath.includes('/test/')
    || relPath.includes('/scripts/');
}

function walk(absPath) {
  if (shouldSkipPath(absPath)) {
    return;
  }
  const entryStat = statSync(absPath);
  if (entryStat.isDirectory()) {
    for (const name of readdirSync(absPath)) {
      walk(resolve(absPath, name));
    }
    return;
  }
  if (!allowedExtensions.has(extname(absPath))) {
    return;
  }

  const relPath = relative(repoRoot, absPath).replaceAll('\\', '/');
  const lines = readFileSync(absPath, 'utf8').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] || '';
    for (const check of bannedChecks) {
      check.pattern.lastIndex = 0;
      if (check.pattern.test(line)) {
        failures.push(`${relPath}:${index + 1}: ${check.label}: ${line.trim()}`);
      }
    }
  }
}

if (existsSync(scanRoot)) {
  walk(scanRoot);
}

if (failures.length > 0) {
  process.stderr.write(`runtime mod browser storage hard-cut check failed:\n${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('runtime mod browser storage hard-cut check passed\n');
}

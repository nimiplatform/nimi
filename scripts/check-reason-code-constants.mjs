#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const reasonCodeFile = path.join(repoRoot, 'sdk/src/types/index.ts');

const CODE_VALUE_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;
const SOURCE_ROOTS = [
  'apps',
  'sdk/src',
  'sdk/test',
];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);
const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  '.vercel',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'tmp',
]);
const SKIP_FILE_SUFFIXES = ['.d.ts'];

const REASON_CODE_LITERAL_PATTERNS = [
  /\breasonCode\s*:\s*(['"])([A-Za-z][A-Za-z0-9_-]*)\1/g,
  /\breasonCode\s*(?:===|==|!==|!=)\s*(['"])([A-Za-z][A-Za-z0-9_-]*)\1/g,
  /(['"])([A-Za-z][A-Za-z0-9_-]*)\1\s*(?:===|==|!==|!=)\s*reasonCode\b/g,
];
const TYPEOF_LITERAL_VALUES = new Set([
  'string',
  'number',
  'bigint',
  'boolean',
  'symbol',
  'undefined',
  'object',
  'function',
]);

function getLineColumn(source, index) {
  const prefix = source.slice(0, index);
  const line = prefix.split('\n').length;
  const lastBreak = prefix.lastIndexOf('\n');
  const column = index - lastBreak;
  return { line, column };
}

function parseReasonCodeEntries(source) {
  const constantMatch = source.match(/export const ReasonCode = \{([\s\S]*?)\} as const;/m);
  if (!constantMatch) {
    throw new Error('failed to locate `export const ReasonCode = { ... } as const`');
  }
  const constantBody = constantMatch[1];
  const entryPattern = /^\s*([A-Z][A-Z0-9_]*)\s*:\s*'([^']+)'\s*,?\s*$/gm;
  const entries = [];
  let match = entryPattern.exec(constantBody);
  while (match) {
    entries.push({
      key: match[1],
      value: match[2],
    });
    match = entryPattern.exec(constantBody);
  }
  if (entries.length === 0) {
    throw new Error('no entries found in ReasonCode constant table');
  }
  return entries;
}

function shouldIgnoreReasonCodeLiteralMatch(source, matchIndex, literalValue) {
  if (!TYPEOF_LITERAL_VALUES.has(literalValue)) {
    return false;
  }
  const lineStart = source.lastIndexOf('\n', matchIndex) + 1;
  const linePrefix = source.slice(lineStart, matchIndex);
  return /\btypeof\b/.test(linePrefix);
}

async function collectFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated') {
        continue;
      }
      files.push(...await collectFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const ext = path.extname(entry.name);
    if (!SOURCE_EXTENSIONS.has(ext)) {
      continue;
    }
    if (SKIP_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

async function main() {
  const violations = [];
  const reasonCodeSource = await fs.readFile(reasonCodeFile, 'utf8');
  const reasonCodeEntries = parseReasonCodeEntries(reasonCodeSource);

  const keyCounts = new Map();
  const valueCounts = new Map();
  for (const entry of reasonCodeEntries) {
    keyCounts.set(entry.key, (keyCounts.get(entry.key) ?? 0) + 1);
    valueCounts.set(entry.value, (valueCounts.get(entry.value) ?? 0) + 1);
    if (entry.key !== entry.value) {
      violations.push(`ReasonCode key/value mismatch: ${entry.key} -> ${entry.value}`);
    }
    if (!CODE_VALUE_PATTERN.test(entry.value)) {
      violations.push(`ReasonCode value must be UPPER_SNAKE_CASE: ${entry.key} -> ${entry.value}`);
    }
  }

  for (const [key, count] of keyCounts.entries()) {
    if (count > 1) {
      violations.push(`duplicate ReasonCode key: ${key}`);
    }
  }
  for (const [value, count] of valueCounts.entries()) {
    if (count > 1) {
      violations.push(`duplicate ReasonCode value: ${value}`);
    }
  }

  for (const root of SOURCE_ROOTS) {
    const absoluteRoot = path.join(repoRoot, root);
    const files = await collectFiles(absoluteRoot);
    for (const file of files) {
      if (file === reasonCodeFile) {
        continue;
      }
      const source = await fs.readFile(file, 'utf8');
      for (const pattern of REASON_CODE_LITERAL_PATTERNS) {
        let match = pattern.exec(source);
        while (match) {
          const literalValue = match[2];
          if (shouldIgnoreReasonCodeLiteralMatch(source, match.index, literalValue)) {
            match = pattern.exec(source);
            continue;
          }
          const { line, column } = getLineColumn(source, match.index);
          const relative = path.relative(repoRoot, file).replaceAll(path.sep, '/');
          violations.push(`${relative}:${String(line)}:${String(column)} uses reasonCode string literal: ${match[0]}`);
          match = pattern.exec(source);
        }
      }
    }
  }

  if (violations.length > 0) {
    process.stderr.write('ReasonCode constant policy violations found:\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `ReasonCode constants policy check passed (${String(reasonCodeEntries.length)} constants)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`check-reason-code-constants failed: ${String(error)}\n`);
  process.exitCode = 1;
});

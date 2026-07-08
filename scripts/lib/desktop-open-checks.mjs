import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export const root = process.cwd();

const skippedDirs = new Set([
  '.cache',
  '.git',
  '.iterate',
  'archive',
  'dist',
  'docs',
  'gen',
  'generated',
  'node_modules',
  '_external',
  'target',
]);

export function read(relPath) {
  return readFileSync(path.join(root, relPath), 'utf8');
}

export function parseYaml(relPath) {
  return YAML.parse(read(relPath));
}

export function assertCheck(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function failWith(title, failures) {
  if (failures.length === 0) {
    return;
  }
  console.error(title);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

export function pass(message) {
  console.log(message);
}

export function collectFiles(roots, options = {}) {
  const extensions = options.extensions ?? new Set([
    '.cjs',
    '.cts',
    '.js',
    '.jsx',
    '.mjs',
    '.mts',
    '.rs',
    '.ts',
    '.tsx',
    '.yaml',
    '.yml',
  ]);
  const files = [];
  for (const relRoot of roots) {
    const absRoot = path.join(root, relRoot);
    if (!existsSync(absRoot)) {
      continue;
    }
    walk(absRoot, files, extensions);
  }
  return files;
}

function walk(dir, files, extensions) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skippedDirs.has(entry.name)) {
        continue;
      }
      walk(absPath, files, extensions);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!extensions.has(path.extname(entry.name))) {
      continue;
    }
    if (statSync(absPath).size > 1024 * 1024) {
      continue;
    }
    files.push(absPath);
  }
}

export function rel(absPath) {
  return path.relative(root, absPath).replace(/\\/g, '/');
}

export function findPatternViolations(files, patterns, options = {}) {
  const allow = options.allow ?? (() => false);
  const violations = [];
  for (const file of files) {
    const relPath = rel(file);
    const text = readFileSync(file, 'utf8');
    const lines = text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (allow(relPath, line, index + 1)) {
        continue;
      }
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          violations.push(`${relPath}:${index + 1}: ${line.trim()}`);
          break;
        }
      }
    }
  }
  return violations;
}

export function requireText(relPath, needles) {
  const text = read(relPath);
  return needles
    .filter((needle) => !text.includes(needle))
    .map((needle) => `${relPath} missing ${needle}`);
}

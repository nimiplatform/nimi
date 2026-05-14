#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const scriptRepoRoot = path.resolve(scriptDir, '..');
const RENDERER_ROOT = 'apps/desktop/src/shell/renderer';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);
const SKIP_DIRS = new Set(['.git', 'dist', 'node_modules', 'target']);
const SKIP_PATH_MARKERS = ['.fixture.'];

const checks = [
  {
    id: 'withAnonymousReadFallback',
    pattern: /withAnonymousReadFallback/g,
  },
  {
    id: 'new Runtime(',
    pattern: /\bnew\s+Runtime\s*\(/g,
  },
  {
    id: 'getAnonymousRuntime',
    pattern: /getAnonymousRuntime/g,
  },
  {
    id: 'authFailedBecauseOfStaleBearer',
    pattern: /authFailedBecauseOfStaleBearer/g,
  },
  {
    id: 'anonymousReadUntilMs',
    pattern: /anonymousReadUntilMs/g,
  },
  {
    id: 'STALE_BEARER_ANONYMOUS_RETRY_MS',
    pattern: /STALE_BEARER_ANONYMOUS_RETRY_MS/g,
  },
];

function parseArgs(argv) {
  return {
    json: argv.includes('--json'),
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveRepoRoot() {
  const cwdRoot = process.cwd();
  if (await pathExists(path.join(cwdRoot, RENDERER_ROOT))) {
    return cwdRoot;
  }
  return scriptRepoRoot;
}

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

function getLineColumn(source, index) {
  const before = source.slice(0, index);
  const line = before.split('\n').length;
  const lastBreak = before.lastIndexOf('\n');
  return {
    line,
    column: index - lastBreak,
  };
}

async function collectSourceFiles(root) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    const posixPath = toPosix(fullPath);
    if (SKIP_PATH_MARKERS.some((marker) => posixPath.includes(marker))) {
      continue;
    }
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      files.push(...await collectSourceFiles(fullPath));
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

async function scanFile(repoRoot, filePath) {
  const source = await fs.readFile(filePath, 'utf8');
  const violations = [];
  for (const check of checks) {
    check.pattern.lastIndex = 0;
    let match = check.pattern.exec(source);
    while (match) {
      const location = getLineColumn(source, match.index);
      violations.push({
        file: toPosix(path.relative(repoRoot, filePath)),
        line: location.line,
        column: location.column,
        pattern: check.id,
      });
      match = check.pattern.exec(source);
    }
  }
  return violations;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = await resolveRepoRoot();
  const rendererRoot = path.join(repoRoot, RENDERER_ROOT);
  const files = await collectSourceFiles(rendererRoot);
  const violations = [];

  for (const file of files) {
    violations.push(...await scanFile(repoRoot, file));
  }

  const result = {
    ok: violations.length === 0,
    scannedFiles: files.length,
    violations,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }

  if (violations.length > 0) {
    process.stderr.write('anonymous read fallback shim patterns are forbidden in the desktop renderer\n');
    for (const violation of violations) {
      process.stderr.write(`- ${violation.file}:${violation.line}:${violation.column} ${violation.pattern}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (!args.json) {
    process.stdout.write(`anonymous read fallback shim check passed (${files.length} files scanned)\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`check-no-anonymous-fallback-shim failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const targets = [
  'runtime/gen',
  'sdk/packages/runtime/src/generated',
];

function normalizePath(input) {
  return input.replace(/\\/g, '/');
}

async function listFilesRecursively(dir) {
  const output = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await listFilesRecursively(fullPath)));
      continue;
    }
    if (entry.isFile()) {
      output.push(fullPath);
    }
  }
  return output;
}

async function snapshotTarget(targetDir) {
  const absRoot = path.join(repoRoot, targetDir);
  const files = await listFilesRecursively(absRoot);
  const map = new Map();
  for (const absPath of files) {
    const rel = normalizePath(path.relative(repoRoot, absPath));
    const data = await fs.readFile(absPath);
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    map.set(rel, hash);
  }
  return map;
}

function diffSnapshots(before, after) {
  const changed = [];
  const keys = new Set([...before.keys(), ...after.keys()]);
  for (const key of keys) {
    const prev = before.get(key);
    const next = after.get(key);
    if (prev !== next) {
      changed.push(key);
    }
  }
  changed.sort();
  return changed;
}

async function main() {
  const beforeSnapshots = new Map();
  for (const target of targets) {
    beforeSnapshots.set(target, await snapshotTarget(target));
  }

  const run = spawnSync('pnpm', ['proto:generate'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 32 * 1024 * 1024,
  });
  if ((run.status ?? 1) !== 0) {
    process.stderr.write(run.stdout || '');
    process.stderr.write(run.stderr || '');
    process.exit(run.status ?? 1);
  }

  const drifted = [];
  for (const target of targets) {
    const after = await snapshotTarget(target);
    const before = beforeSnapshots.get(target) || new Map();
    const diff = diffSnapshots(before, after);
    if (diff.length > 0) {
      drifted.push(...diff);
    }
  }

  if (drifted.length > 0) {
    process.stderr.write('proto drift check failed: generated files changed after proto:generate\n');
    for (const file of drifted) {
      process.stderr.write(`  - ${file}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('proto drift check passed\n');
}

main().catch((error) => {
  process.stderr.write(`check-proto-drift failed: ${String(error)}\n`);
  process.exitCode = 1;
});

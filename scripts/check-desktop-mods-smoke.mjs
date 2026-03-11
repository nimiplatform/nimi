#!/usr/bin/env node

import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

function isExistingDirectory(inputPath) {
  return existsSync(inputPath) && statSync(inputPath).isDirectory();
}

function resolveWorkspaceRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, '..');
}

function normalizeAbsolutePath(value) {
  const normalized = String(value || '').trim();
  if (!normalized || !path.isAbsolute(normalized)) {
    return '';
  }
  return path.resolve(normalized);
}

function runCommand(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  const repoRoot = resolveWorkspaceRoot();
  const args = new Set(process.argv.slice(2));
  const runAllModsSmoke = args.has('--all');

  const env = { ...process.env };
  let resolvedRuntimeModsDir = normalizeAbsolutePath(env.NIMI_RUNTIME_MODS_DIR);
  if (!resolvedRuntimeModsDir) {
    resolvedRuntimeModsDir = path.join(os.tmpdir(), `nimi-runtime-mods-smoke-${process.pid}`);
    mkdirSync(resolvedRuntimeModsDir, { recursive: true });
    env.NIMI_RUNTIME_MODS_DIR = resolvedRuntimeModsDir;
  }
  if (!isExistingDirectory(resolvedRuntimeModsDir)) {
    process.stderr.write(`[check-desktop-mods-smoke] runtime mods dir must exist: ${resolvedRuntimeModsDir}\n`);
    process.exit(1);
  }

  process.stdout.write(
    [
      `[check-desktop-mods-smoke] NIMI_RUNTIME_MODS_DIR=${resolvedRuntimeModsDir}`,
      `[check-desktop-mods-smoke] mode=${runAllModsSmoke ? 'all-mods' : 'single-mod'}`,
    ].join('\n'),
  );
  process.stdout.write('\n');

  if (runAllModsSmoke) {
    runCommand('node', ['apps/desktop/scripts/dev-mods-smoke.mjs', '--all'], repoRoot, env);
    return;
  }
  runCommand('node', ['apps/desktop/scripts/dev-mods-smoke.mjs'], repoRoot, env);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || '');
  process.stderr.write(`[check-desktop-mods-smoke] failed: ${message}\n`);
  process.exit(1);
}

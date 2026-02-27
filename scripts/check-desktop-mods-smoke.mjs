#!/usr/bin/env node

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function isExistingDirectory(inputPath) {
  return existsSync(inputPath) && statSync(inputPath).isDirectory();
}

function resolveWorkspaceRoot() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(scriptDir, '..');
}

function normalizeAbsolutePath(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }
  if (!path.isAbsolute(normalized)) {
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
  const envModsRoot = normalizeAbsolutePath(env.NIMI_MODS_ROOT);
  const envRuntimeModsDir = normalizeAbsolutePath(env.NIMI_RUNTIME_MODS_DIR);

  const bundledModsRoot = path.join(repoRoot, 'nimi-mods');
  const canUseBundledMods = isExistingDirectory(bundledModsRoot);

  if (!envModsRoot && canUseBundledMods) {
    env.NIMI_MODS_ROOT = bundledModsRoot;
  }
  if (!envRuntimeModsDir && canUseBundledMods) {
    env.NIMI_RUNTIME_MODS_DIR = bundledModsRoot;
  }

  const resolvedModsRoot = normalizeAbsolutePath(env.NIMI_MODS_ROOT);
  const resolvedRuntimeModsDir = normalizeAbsolutePath(env.NIMI_RUNTIME_MODS_DIR);
  if (!resolvedModsRoot || !resolvedRuntimeModsDir) {
    process.stderr.write(
      [
        '[check-desktop-mods-smoke] missing required envs:',
        '  NIMI_MODS_ROOT and NIMI_RUNTIME_MODS_DIR must be absolute existing directories.',
        canUseBundledMods
          ? `  hint: local fallback is available at ${bundledModsRoot}`
          : `  hint: expected local fallback path not found: ${bundledModsRoot}`,
      ].join('\n'),
    );
    process.stderr.write('\n');
    process.exit(1);
  }

  process.stdout.write(
    [
      `[check-desktop-mods-smoke] NIMI_MODS_ROOT=${resolvedModsRoot}`,
      `[check-desktop-mods-smoke] NIMI_RUNTIME_MODS_DIR=${resolvedRuntimeModsDir}`,
      `[check-desktop-mods-smoke] mode=${runAllModsSmoke ? 'all-mods' : 'local-chat'}`,
    ].join('\n'),
  );
  process.stdout.write('\n');

  if (runAllModsSmoke) {
    runCommand('pnpm', ['--filter', '@nimiplatform/desktop', 'run', 'smoke:mods'], repoRoot, env);
    return;
  }
  runCommand('pnpm', ['--filter', '@nimiplatform/desktop', 'run', 'smoke:mod:local-chat'], repoRoot, env);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || '');
  process.stderr.write(`[check-desktop-mods-smoke] failed: ${message}\n`);
  process.exit(1);
}

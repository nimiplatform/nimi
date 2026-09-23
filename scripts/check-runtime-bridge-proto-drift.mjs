#!/usr/bin/env node

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = path.join(repoRoot, 'kit/shell/tauri/Cargo.toml');
const generatedFile = path.join(
  repoRoot,
  'kit/shell/tauri/src/runtime_bridge/generated/nimi.runtime.v1.rs',
);

function readGenerated() {
  try {
    return readFileSync(generatedFile, 'utf8');
  } catch (error) {
    throw new Error(`runtime bridge proto generated file missing: ${generatedFile}: ${error.message}`);
  }
}

function assertCurrentRuntimeBridgeContract(source) {
  for (const retired of [
    'RegisterApp',
    'OpenSession',
    'RefreshSession',
    'RevokeSession',
  ]) {
    if (source.includes(retired)) {
      throw new Error(`runtime bridge proto projection restored retired generic session surface: ${retired}`);
    }
  }
  for (const retired of [
    'pub enum App' + 'Mode',
    'pub struct App' + 'ModeManifest',
    'pub enum World' + 'Relation',
    'APP_' + 'MODE_',
    'WORLD_' + 'RELATION_',
  ]) {
    if (source.includes(retired)) {
      throw new Error(`runtime bridge proto projection restored retired app-mode contract: ${retired}`);
    }
  }
}

const before = readGenerated();
assertCurrentRuntimeBridgeContract(before);
// The cargo target is a large repository work area, not OS temp. Every exit
// below sets the status and returns through finally so it is always removed.
const stagingParent = path.join(repoRoot, '.nimi/local/tmp');
mkdirSync(stagingParent, { recursive: true });
const targetDir = mkdtempSync(path.join(stagingParent, 'runtime-bridge-'));

try {
  process.exitCode = checkRuntimeBridgeProtoDrift();
} finally {
  rmSync(targetDir, { recursive: true, force: true });
}

function checkRuntimeBridgeProtoDrift() {
  const result = spawnSync(
    'cargo',
    ['check', '--manifest-path', manifestPath, '--quiet'],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CARGO_TARGET_DIR: targetDir,
      },
      stdio: 'inherit',
    },
  );

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    return result.status ?? 1;
  }

  const after = readGenerated();
  assertCurrentRuntimeBridgeContract(after);
  if (after !== before) {
    writeFileSync(generatedFile, before, 'utf8');
    process.stderr.write(
      `runtime bridge proto generated drift detected: ${generatedFile}\n` +
      'run `cargo check --locked --manifest-path kit/shell/tauri/Cargo.toml` to regenerate, then commit the generated file.\n',
    );
    return 1;
  }

  process.stdout.write(`up-to-date ${generatedFile}\n`);
  return 0;
}

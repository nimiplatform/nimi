#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  const listKnowledgeBanks = source.match(
    /pub struct ListKnowledgeBanksRequest \{[\s\S]*?\n\}/u,
  )?.[0] ?? '';
  if (
    !listKnowledgeBanks.includes('pub scope_filter: i32')
    || !listKnowledgeBanks.includes('pub owner_filter: ::core::option::Option<KnowledgeBankOwnerFilter>')
    || listKnowledgeBanks.includes('scope_filters')
    || listKnowledgeBanks.includes('owner_filters')
  ) {
    throw new Error('runtime bridge proto projection does not carry the singular ListKnowledgeBanks contract');
  }
}

const before = readGenerated();
assertCurrentRuntimeBridgeContract(before);
const targetDir = mkdtempSync(path.join(tmpdir(), 'nimi-runtime-bridge-proto-drift-'));

try {
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
    process.exit(result.status ?? 1);
  }

  const after = readGenerated();
  assertCurrentRuntimeBridgeContract(after);
  if (after !== before) {
    writeFileSync(generatedFile, before, 'utf8');
    process.stderr.write(
      `runtime bridge proto generated drift detected: ${generatedFile}\n` +
      'run `cargo check --locked --manifest-path kit/shell/tauri/Cargo.toml` to regenerate, then commit the generated file.\n',
    );
    process.exit(1);
  }

  process.stdout.write(`up-to-date ${generatedFile}\n`);
} finally {
  rmSync(targetDir, { recursive: true, force: true });
}

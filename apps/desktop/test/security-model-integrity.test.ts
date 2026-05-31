import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { toBridgeNimiError } from '../src/shell/renderer/bridge/runtime-bridge/invoke';

// ---------------------------------------------------------------------------
// D-SEC-006 — Model integrity verification
//
// Runtime owns hash verification and model integrity materialization.
// Desktop keeps only shell-native file picker containment and renderer error
// projection for Runtime-originated integrity failures.
//
// This file uses source scanning to prevent Tauri from re-acquiring content
// hash truth, and behavioral tests on the TypeScript bridge error mapping.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rust source paths
// ---------------------------------------------------------------------------

const LOCAL_RUNTIME_COMMANDS_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src-tauri/src/local_runtime/commands/mod.rs',
);
const localRuntimeCommandsSource = fs.readFileSync(LOCAL_RUNTIME_COMMANDS_PATH, 'utf-8');
const KIT_RUNTIME_LOCAL_ASSETS_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../../../kit/shell/tauri/src/runtime_local_assets.rs',
);
const kitRuntimeLocalAssetsSource = fs.readFileSync(KIT_RUNTIME_LOCAL_ASSETS_PATH, 'utf-8');

// ---------------------------------------------------------------------------
// D-SEC-006: Runtime-owned integrity errors still project through bridge map
// ---------------------------------------------------------------------------

test('D-SEC-006: verified empty hash list projects LOCAL_AI_MODEL_HASHES_EMPTY error', () => {
  const error = toBridgeNimiError(
    new Error('LOCAL_AI_MODEL_HASHES_EMPTY: hashes are empty'),
  );
  assert.equal(
    error.reasonCode,
    'LOCAL_AI_MODEL_HASHES_EMPTY',
    'reasonCode must be LOCAL_AI_MODEL_HASHES_EMPTY',
  );
  assert.equal(
    String(error.details?.userMessage || ''),
    'The model has not completed integrity verification and cannot be started.',
    'userMessage must match the bridge error code map entry for empty hashes',
  );
});

// ---------------------------------------------------------------------------
// D-SEC-006: manifest path validation remains shell-local; content hashes do not
// ---------------------------------------------------------------------------

test('D-SEC-006: Kit Tauri helper validates only selected manifest containment', () => {
  assert.ok(
    kitRuntimeLocalAssetsSource.includes('pub fn canonical_asset_manifest_path('),
    'Kit Tauri helper must keep shell-local selected manifest path containment',
  );
  assert.ok(
    kitRuntimeLocalAssetsSource.includes('ASSET_MANIFEST_FILE_NAME'),
    'Kit Tauri helper must require the canonical asset manifest filename',
  );
  assert.ok(
    kitRuntimeLocalAssetsSource.includes('LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT'),
    'Kit Tauri helper must keep runtime-root containment checks',
  );
  assert.ok(
    localRuntimeCommandsSource.includes('canonical_asset_manifest_path(&path, &models_root)'),
    'Desktop Tauri command must delegate manifest containment to Kit',
  );
  assert.doesNotMatch(localRuntimeCommandsSource, /"resolved"/);
});

test('D-SEC-006: Desktop Tauri helper does not own content hash verification', () => {
  assert.doesNotMatch(
    localRuntimeCommandsSource,
    /sha256_hex_for_file|Sha256::new\(\)|actual_hash\s*!=\s*expected_hash|assert_manifest_hashes|manifest_hashes_required/,
    'Tauri local runtime helper must not own model content hash verification',
  );
  assert.doesNotMatch(
    localRuntimeCommandsSource,
    /LOCAL_AI_IMPORT_HASH_MISMATCH|LOCAL_AI_IMPORT_MANIFEST_HASHES_MISSING/,
    'Tauri local runtime helper must not emit Runtime-owned model hash verification errors',
  );
  assert.doesNotMatch(localRuntimeCommandsSource, /import_validator/);
});

test('D-SEC-006: mismatched hash projects LOCAL_AI_IMPORT_HASH_MISMATCH error', () => {
  const error = toBridgeNimiError(
    new Error('LOCAL_AI_IMPORT_HASH_MISMATCH: hash mismatch for model.gguf'),
  );
  assert.equal(
    error.reasonCode,
    'LOCAL_AI_IMPORT_HASH_MISMATCH',
    'reasonCode must be LOCAL_AI_IMPORT_HASH_MISMATCH',
  );
  assert.equal(
    String(error.details?.userMessage || ''),
    'Model file verification failed. Confirm the file is intact and try again.',
    'userMessage must match the bridge error code map entry for hash mismatch',
  );
});

// ---------------------------------------------------------------------------
// Source-scan: bridge error code map includes both integrity codes
// ---------------------------------------------------------------------------

const INVOKE_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src/shell/renderer/bridge/runtime-bridge/invoke.ts',
);
const invokeSource = fs.readFileSync(INVOKE_PATH, 'utf-8');

test('D-SEC-006: bridge error code map includes LOCAL_AI_IMPORT_HASH_MISMATCH', () => {
  assert.ok(
    invokeSource.includes('LOCAL_AI_IMPORT_HASH_MISMATCH'),
    'invoke.ts BRIDGE_ERROR_CODE_MAP must include LOCAL_AI_IMPORT_HASH_MISMATCH',
  );
});

test('D-SEC-006: bridge error code map includes LOCAL_AI_MODEL_HASHES_EMPTY', () => {
  assert.ok(
    invokeSource.includes('LOCAL_AI_MODEL_HASHES_EMPTY'),
    'invoke.ts BRIDGE_ERROR_CODE_MAP must include LOCAL_AI_MODEL_HASHES_EMPTY',
  );
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { toBridgeNimiError } from '../src/shell/renderer/bridge/runtime-bridge/invoke';

// ---------------------------------------------------------------------------
// D-SEC-006 — Model integrity verification
//
// Runtime owns hash verification and model integrity materialization.
// Desktop keeps only shell-local manifest path validation and renderer error
// projection for Runtime-originated integrity failures.
//
// This file uses source scanning to prevent Tauri from re-acquiring content
// hash truth, and behavioral tests on the TypeScript bridge error mapping.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rust source paths
// ---------------------------------------------------------------------------

const IMPORT_VALIDATOR_ENTRY_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src-tauri/src/local_runtime/import_validator.rs',
);
const IMPORT_VALIDATOR_HELPERS_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src-tauri/src/local_runtime/import_validator/helpers.rs',
);
const IMPORT_VALIDATOR_MANIFEST_CHECKS_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src-tauri/src/local_runtime/import_validator/manifest_checks.rs',
);
const importValidatorSource = [
  IMPORT_VALIDATOR_ENTRY_PATH,
  IMPORT_VALIDATOR_HELPERS_PATH,
  IMPORT_VALIDATOR_MANIFEST_CHECKS_PATH,
]
  .map((filePath) => fs.readFileSync(filePath, 'utf-8'))
  .join('\n');

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

test('D-SEC-006: Desktop import validator only validates resolved manifest location', () => {
  assert.ok(
    importValidatorSource.includes('validate_import_asset_manifest_path'),
    'import_validator must keep shell-local manifest path validation',
  );
  assert.ok(
    importValidatorSource.includes('ASSET_MANIFEST_FILE_NAME'),
    'import_validator must require the canonical asset manifest filename',
  );
  assert.ok(
    importValidatorSource.includes('LOCAL_AI_IMPORT_PATH_OUTSIDE_RUNTIME_ROOT'),
    'import_validator must keep runtime-root containment checks',
  );
  assert.ok(
    importValidatorSource.includes('"resolved"'),
    'import_validator must require resolved/<asset-id>/asset.manifest.json placement',
  );
});

test('D-SEC-006: Desktop import validator does not own content hash verification', () => {
  assert.doesNotMatch(
    importValidatorSource,
    /sha256_hex_for_file|Sha256::new\(\)|actual_hash\s*!=\s*expected_hash|assert_manifest_hashes|manifest_hashes_required/,
    'Tauri import_validator must not own model content hash verification',
  );
  assert.doesNotMatch(
    importValidatorSource,
    /LOCAL_AI_IMPORT_HASH_MISMATCH|LOCAL_AI_IMPORT_MANIFEST_HASHES_MISSING/,
    'Tauri import_validator must not emit Runtime-owned model hash verification errors',
  );
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

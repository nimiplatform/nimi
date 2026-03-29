import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { toBridgeNimiError } from '../src/shell/renderer/bridge/runtime-bridge/invoke';

// ---------------------------------------------------------------------------
// D-SEC-006 — Model integrity verification
//
// The hash validation lives in two Rust module groups:
//   1. `local_runtime/import_validator*` — manifest hash verification at import time
//      (LOCAL_AI_IMPORT_HASH_MISMATCH)
//   2. `supervisor.rs` — verified-model preflight hash-empty check at model start time
//      (LOCAL_AI_MODEL_HASHES_EMPTY)
//
// This file uses source scanning on the Rust authoritative layer and
// behavioral tests on the TypeScript bridge error mapping.
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
const SUPERVISOR_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src-tauri/src/local_runtime/supervisor.rs',
);

const importValidatorSource = [
  IMPORT_VALIDATOR_ENTRY_PATH,
  IMPORT_VALIDATOR_HELPERS_PATH,
  IMPORT_VALIDATOR_MANIFEST_CHECKS_PATH,
]
  .map((filePath) => fs.readFileSync(filePath, 'utf-8'))
  .join('\n');
const supervisorSource = fs.readFileSync(SUPERVISOR_PATH, 'utf-8');

// ---------------------------------------------------------------------------
// D-SEC-006: verified empty hash list → LOCAL_AI_MODEL_HASHES_EMPTY
// ---------------------------------------------------------------------------

test('D-SEC-006: verified empty hash list produces LOCAL_AI_MODEL_HASHES_EMPTY error', () => {
  // 1. Supervisor preflight rejects only verified models with empty hashes (source scan)
  assert.ok(
    supervisorSource.includes('resolved_model_integrity_mode(model) == LocalAiIntegrityMode::Verified'),
    'supervisor.rs must gate the empty-hash preflight on verified integrity mode',
  );
  assert.ok(
    supervisorSource.includes('LOCAL_AI_MODEL_HASHES_EMPTY'),
    'supervisor.rs must emit LOCAL_AI_MODEL_HASHES_EMPTY when hashes are empty',
  );

  // 2. Bridge error map translates the code for the renderer (behavioral)
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

test('D-SEC-006: local unverified models are allowed to start without hashes', () => {
  assert.ok(
    supervisorSource.includes('infer_model_integrity_mode_from_source(&model.source)'),
    'supervisor.rs must infer integrity mode for legacy records from source.repo',
  );
  assert.ok(
    supervisorSource.includes('LocalAiIntegrityMode::Verified'),
    'supervisor.rs must explicitly distinguish verified models from local unverified imports',
  );
});

// ---------------------------------------------------------------------------
// D-SEC-006: mismatched hash → LOCAL_AI_IMPORT_HASH_MISMATCH
// ---------------------------------------------------------------------------

test('D-SEC-006: mismatched hash produces LOCAL_AI_IMPORT_HASH_MISMATCH error', () => {
  // 1. Import validator compares actual vs expected hash (source scan)
  assert.ok(
    importValidatorSource.includes('actual_hash != expected_hash'),
    'import_validator sources must compare actual_hash against expected_hash',
  );
  assert.ok(
    importValidatorSource.includes('LOCAL_AI_IMPORT_HASH_MISMATCH'),
    'import_validator sources must emit LOCAL_AI_IMPORT_HASH_MISMATCH on mismatch',
  );

  // 2. Bridge error map translates the code for the renderer (behavioral)
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
// D-SEC-006: valid hash passes verification
// ---------------------------------------------------------------------------

test('D-SEC-006: valid hash passes verification', () => {
  // 1. Import validator uses SHA-256 for hash computation (source scan)
  assert.ok(
    importValidatorSource.includes('sha256_hex_for_file'),
    'import_validator sources must define sha256_hex_for_file for hash computation',
  );
  assert.ok(
    importValidatorSource.includes('Sha256::new()'),
    'import_validator sources must use Sha256 hasher',
  );

  // 2. When hashes match, assert_manifest_hashes returns Ok (source scan)
  //    The function iterates all hash entries and returns Ok(()) only when
  //    every file's actual hash equals the expected hash.
  assert.ok(
    importValidatorSource.includes('fn assert_manifest_hashes('),
    'import_validator sources must define assert_manifest_hashes function',
  );

  // 3. Manifest validation calls hash assertion (source scan)
  assert.ok(
    importValidatorSource.includes('assert_manifest_hashes(&manifest, path)'),
    'parse_and_validate_manifest must invoke assert_manifest_hashes',
  );

  // 4. The normalize_manifest_hash strips "sha256:" prefix for comparison
  assert.ok(
    importValidatorSource.includes('trim_start_matches("sha256:")'),
    'import_validator sources must strip sha256: prefix when normalizing hashes',
  );
});

// ---------------------------------------------------------------------------
// Source-scan: only verified manifests require hashes at import time
// ---------------------------------------------------------------------------

test('D-SEC-006: import validator only rejects empty manifest.hashes for verified imports', () => {
  assert.ok(
    importValidatorSource.includes('manifest_hashes_required(manifest) && manifest.hashes.is_empty()'),
    'import_validator sources must only reject empty hashes when the manifest requires verification',
  );
  assert.ok(
    importValidatorSource.includes('LOCAL_AI_IMPORT_MANIFEST_HASHES_MISSING'),
    'import_validator sources must emit HASHES_MISSING when manifest.hashes is empty',
  );
  assert.ok(
    importValidatorSource.includes('resolved_manifest_integrity_mode(manifest) == LocalAiIntegrityMode::Verified'),
    'import_validator sources must tie hash requirements to verified integrity mode',
  );
});

test('D-SEC-006: local unverified manifest path skips required-hash enforcement', () => {
  assert.ok(
    importValidatorSource.includes('if !manifest_hashes_required(manifest) {'),
    'import_validator sources must skip hash verification for local_unverified manifests',
  );
  assert.ok(
    importValidatorSource.includes('infer_model_integrity_mode_from_source'),
    'import_validator sources must infer legacy local-import manifests from source.repo',
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

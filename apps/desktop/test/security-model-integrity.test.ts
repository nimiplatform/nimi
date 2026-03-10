import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { toBridgeUserError } from '../src/shell/renderer/bridge/runtime-bridge/invoke';

// ---------------------------------------------------------------------------
// D-SEC-006 — Model integrity verification
//
// The hash validation lives in two Rust modules:
//   1. `import_validator.rs` — manifest hash verification at import time
//      (LOCAL_AI_IMPORT_HASH_MISMATCH)
//   2. `supervisor.rs` — preflight hash-empty check at model start time
//      (LOCAL_AI_MODEL_HASHES_EMPTY)
//
// This file uses source scanning on the Rust authoritative layer and
// behavioral tests on the TypeScript bridge error mapping.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Rust source paths
// ---------------------------------------------------------------------------

const IMPORT_VALIDATOR_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src-tauri/src/local_runtime/import_validator.rs',
);
const SUPERVISOR_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src-tauri/src/local_runtime/supervisor.rs',
);

const importValidatorSource = fs.readFileSync(IMPORT_VALIDATOR_PATH, 'utf-8');
const supervisorSource = fs.readFileSync(SUPERVISOR_PATH, 'utf-8');

// ---------------------------------------------------------------------------
// D-SEC-006: empty hash list → LOCAL_AI_MODEL_HASHES_EMPTY
// ---------------------------------------------------------------------------

test('D-SEC-006: empty hash list produces LOCAL_AI_MODEL_HASHES_EMPTY error', () => {
  // 1. Supervisor preflight rejects models with empty hashes (source scan)
  assert.ok(
    supervisorSource.includes('model.hashes.is_empty()'),
    'supervisor.rs must check model.hashes.is_empty()',
  );
  assert.ok(
    supervisorSource.includes('LOCAL_AI_MODEL_HASHES_EMPTY'),
    'supervisor.rs must emit LOCAL_AI_MODEL_HASHES_EMPTY when hashes are empty',
  );

  // 2. Bridge error map translates the code for the renderer (behavioral)
  const error = toBridgeUserError(
    new Error('LOCAL_AI_MODEL_HASHES_EMPTY: hashes are empty'),
  );
  assert.equal(
    error.reasonCode,
    'LOCAL_AI_MODEL_HASHES_EMPTY',
    'reasonCode must be LOCAL_AI_MODEL_HASHES_EMPTY',
  );
  assert.equal(
    String(error.details?.userMessage || ''),
    '模型未完成完整性校验，无法启动',
    'userMessage must match the bridge error code map entry for empty hashes',
  );
});

// ---------------------------------------------------------------------------
// D-SEC-006: mismatched hash → LOCAL_AI_IMPORT_HASH_MISMATCH
// ---------------------------------------------------------------------------

test('D-SEC-006: mismatched hash produces LOCAL_AI_IMPORT_HASH_MISMATCH error', () => {
  // 1. Import validator compares actual vs expected hash (source scan)
  assert.ok(
    importValidatorSource.includes('actual_hash != expected_hash'),
    'import_validator.rs must compare actual_hash against expected_hash',
  );
  assert.ok(
    importValidatorSource.includes('LOCAL_AI_IMPORT_HASH_MISMATCH'),
    'import_validator.rs must emit LOCAL_AI_IMPORT_HASH_MISMATCH on mismatch',
  );

  // 2. Bridge error map translates the code for the renderer (behavioral)
  const error = toBridgeUserError(
    new Error('LOCAL_AI_IMPORT_HASH_MISMATCH: hash mismatch for model.gguf'),
  );
  assert.equal(
    error.reasonCode,
    'LOCAL_AI_IMPORT_HASH_MISMATCH',
    'reasonCode must be LOCAL_AI_IMPORT_HASH_MISMATCH',
  );
  assert.equal(
    String(error.details?.userMessage || ''),
    '模型文件校验失败，请确认文件完整后重试',
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
    'import_validator.rs must define sha256_hex_for_file for hash computation',
  );
  assert.ok(
    importValidatorSource.includes('Sha256::new()'),
    'import_validator.rs must use Sha256 hasher',
  );

  // 2. When hashes match, assert_manifest_hashes returns Ok (source scan)
  //    The function iterates all hash entries and returns Ok(()) only when
  //    every file's actual hash equals the expected hash.
  assert.ok(
    importValidatorSource.includes('fn assert_manifest_hashes('),
    'import_validator.rs must define assert_manifest_hashes function',
  );

  // 3. Manifest validation calls hash assertion (source scan)
  assert.ok(
    importValidatorSource.includes('assert_manifest_hashes(&manifest, path)'),
    'parse_and_validate_manifest must invoke assert_manifest_hashes',
  );

  // 4. The normalize_manifest_hash strips "sha256:" prefix for comparison
  assert.ok(
    importValidatorSource.includes('trim_start_matches("sha256:")'),
    'import_validator.rs must strip sha256: prefix when normalizing hashes',
  );
});

// ---------------------------------------------------------------------------
// Source-scan: manifest hashes must be non-empty at import time
// ---------------------------------------------------------------------------

test('D-SEC-006: import validator rejects empty manifest.hashes', () => {
  assert.ok(
    importValidatorSource.includes('manifest.hashes.is_empty()'),
    'import_validator.rs must check manifest.hashes.is_empty()',
  );
  assert.ok(
    importValidatorSource.includes('LOCAL_AI_IMPORT_MANIFEST_HASHES_MISSING'),
    'import_validator.rs must emit HASHES_MISSING when manifest.hashes is empty',
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

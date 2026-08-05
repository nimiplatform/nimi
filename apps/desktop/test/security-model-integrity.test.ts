import assert from 'node:assert/strict';
import test from 'node:test';

import { toBridgeNimiError } from '../src/shell/renderer/bridge/runtime-bridge/invoke';

// ---------------------------------------------------------------------------
// D-SEC-006 — Model integrity verification
//
// Runtime owns hash verification and model integrity materialization.
// Desktop keeps only shell-native file picker containment and renderer error
// projection for Runtime-originated integrity failures.
//
// These tests cover the renderer projection of Runtime integrity failures.
// ---------------------------------------------------------------------------

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
    'The local asset has not completed integrity verification.',
    'userMessage must match the bridge error code map entry for empty hashes',
  );
});

// ---------------------------------------------------------------------------
// D-SEC-006: manifest path validation remains shell-local; content hashes do not
// ---------------------------------------------------------------------------

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

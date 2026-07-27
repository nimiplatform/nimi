import assert from 'node:assert/strict';
import test from 'node:test';

import { toBridgeNimiError } from '../src/shell/renderer/bridge/runtime-bridge/invoke';

// ---------------------------------------------------------------------------
// D-SEC-001 — Endpoint loopback restriction
//
// Runtime owns authoritative endpoint validation. Desktop keeps only the
// user-facing bridge error mapping and must not revive local endpoint
// validation truth in Tauri or renderer helpers.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// D-SEC-001: failure produces LOCAL_AI_ENDPOINT_NOT_LOOPBACK error (behavioral)
// ---------------------------------------------------------------------------

test('D-SEC-001: failure produces LOCAL_AI_ENDPOINT_NOT_LOOPBACK error', () => {
  // The bridge error code mapping must translate the Rust-originated error
  // code into a user-facing message.
  const error = toBridgeNimiError(
    new Error('LOCAL_AI_ENDPOINT_NOT_LOOPBACK: endpoint host must be loopback'),
  );
  assert.equal(
    error.reasonCode,
    'LOCAL_AI_ENDPOINT_NOT_LOOPBACK',
    'reasonCode must be LOCAL_AI_ENDPOINT_NOT_LOOPBACK',
  );
  assert.equal(
    String(error.details?.userMessage || ''),
    'The local runtime endpoint only supports localhost, 127.0.0.1, or [::1].',
    'userMessage must match the bridge error code map entry',
  );
});

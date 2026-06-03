import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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
// Source paths
// ---------------------------------------------------------------------------

const RUST_LOCAL_RUNTIME_MOD_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src-tauri/src/local_runtime/mod.rs',
);
const INVOKE_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src/shell/renderer/bridge/runtime-bridge/invoke.ts',
);

const rustLocalRuntimePackageSource = fs.readFileSync(RUST_LOCAL_RUNTIME_MOD_PATH, 'utf-8');
const invokeSource = fs.readFileSync(INVOKE_PATH, 'utf-8');

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

// ---------------------------------------------------------------------------
// Source-scan confirmation: Tauri no longer owns endpoint validation
// ---------------------------------------------------------------------------

test('D-SEC-001: Desktop Tauri local runtime does not keep endpoint validation truth', () => {
  assert.doesNotMatch(rustLocalRuntimePackageSource, /import_validator/);
  assert.doesNotMatch(rustLocalRuntimePackageSource, /validate_loopback_endpoint/);
  assert.doesNotMatch(rustLocalRuntimePackageSource, /LOCAL_AI_ENDPOINT_NOT_LOOPBACK/);
});

// ---------------------------------------------------------------------------
// Source-scan confirmation: TypeScript bridge error map includes the code
// ---------------------------------------------------------------------------

test('D-SEC-001: Desktop bridge delegates endpoint errors to Kit shell normalization', () => {
  assert.match(invokeSource, /toShellBridgeNimiError/);
});

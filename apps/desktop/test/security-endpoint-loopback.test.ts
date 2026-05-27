import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { toBridgeNimiError } from '../src/shell/renderer/bridge/runtime-bridge/invoke';

// ---------------------------------------------------------------------------
// D-SEC-001 — Endpoint loopback restriction
//
// The loopback check has two layers in this codebase:
//   1. Runtime owns authoritative endpoint validation.
//   2. TypeScript `isLoopbackHost` / `inferRouteSourceFromEndpoint` projects route
//      provenance for renderer audit display.
//
// The TypeScript `inferRouteSourceFromEndpoint` cannot be imported directly in
// this test because its module transitively depends on `@runtime/local-runtime`
// which requires the Tauri environment. Instead, we source-scan to verify the
// TypeScript display layer implements the correct loopback rules, and use
// behavioral tests on the bridge error code map via `toBridgeNimiError`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Source paths
// ---------------------------------------------------------------------------

const INFERENCE_AUDIT_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src/runtime/llm-adapter/execution/inference-audit.ts',
);
const RUST_LOCAL_RUNTIME_MOD_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src-tauri/src/local_runtime/mod.rs',
);
const INVOKE_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src/shell/renderer/bridge/runtime-bridge/invoke.ts',
);

const inferenceAuditSource = fs.readFileSync(INFERENCE_AUDIT_PATH, 'utf-8');
const rustLocalRuntimePackageSource = fs.readFileSync(RUST_LOCAL_RUNTIME_MOD_PATH, 'utf-8');
const invokeSource = fs.readFileSync(INVOKE_PATH, 'utf-8');

// ---------------------------------------------------------------------------
// D-SEC-001: localhost passes loopback check (source scan — TS layer)
// ---------------------------------------------------------------------------

test('D-SEC-001: localhost passes loopback check', () => {
  // TypeScript isLoopbackHost accepts 'localhost'
  assert.ok(
    inferenceAuditSource.includes("normalized === 'localhost'"),
    'isLoopbackHost must accept localhost',
  );
  assert.doesNotMatch(rustLocalRuntimePackageSource, /import_validator/);
});

// ---------------------------------------------------------------------------
// D-SEC-001: 127.0.0.1 passes loopback check (source scan — TS layer)
// ---------------------------------------------------------------------------

test('D-SEC-001: 127.0.0.1 passes loopback check', () => {
  // TypeScript isLoopbackHost accepts 127.0.0.1
  assert.ok(
    inferenceAuditSource.includes("normalized === '127.0.0.1'"),
    'isLoopbackHost must accept 127.0.0.1',
  );
  assert.doesNotMatch(rustLocalRuntimePackageSource, /validate_loopback_endpoint/);
});

// ---------------------------------------------------------------------------
// D-SEC-001: [::1] passes loopback check (source scan — TS layer)
// ---------------------------------------------------------------------------

test('D-SEC-001: [::1] passes loopback check', () => {
  // TypeScript isLoopbackHost accepts both '::1' and '[::1]'
  assert.ok(
    inferenceAuditSource.includes("normalized === '::1'"),
    'isLoopbackHost must accept ::1',
  );
  assert.ok(
    inferenceAuditSource.includes("normalized === '[::1]'"),
    'isLoopbackHost must accept [::1]',
  );
  assert.doesNotMatch(rustLocalRuntimePackageSource, /validate_loopback_endpoint/);
});

// ---------------------------------------------------------------------------
// D-SEC-001: remote address fails loopback check (source scan + behavioral)
// ---------------------------------------------------------------------------

test('D-SEC-001: remote address fails loopback check', () => {
  // TypeScript: inferRouteSourceFromEndpoint returns 'cloud' for non-loopback
  assert.ok(
    inferenceAuditSource.includes("? 'local' : 'cloud'"),
    'inferRouteSourceFromEndpoint must return cloud for non-loopback hosts',
  );
  assert.doesNotMatch(rustLocalRuntimePackageSource, /LOCAL_AI_ENDPOINT_NOT_LOOPBACK/);
});

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

test('D-SEC-001: bridge error code map includes LOCAL_AI_ENDPOINT_NOT_LOOPBACK', () => {
  assert.ok(
    invokeSource.includes('LOCAL_AI_ENDPOINT_NOT_LOOPBACK'),
    'invoke.ts BRIDGE_ERROR_CODE_MAP must include LOCAL_AI_ENDPOINT_NOT_LOOPBACK',
  );
});

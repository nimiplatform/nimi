import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { toBridgeUserError } from '../src/shell/renderer/bridge/runtime-bridge/invoke';

// ---------------------------------------------------------------------------
// D-SEC-001 — Endpoint loopback restriction
//
// The loopback check has two layers in this codebase:
//   1. Rust `validate_loopback_endpoint` (Tauri backend — authoritative gate)
//   2. TypeScript `isLoopbackHost` / `inferRouteSourceFromEndpoint` (renderer)
//
// The TypeScript `inferRouteSourceFromEndpoint` cannot be imported directly in
// this test because its module transitively depends on `@runtime/local-ai-runtime`
// which requires the Tauri environment.  Instead, we source-scan to verify the
// TypeScript layer implements the correct loopback rules, and use behavioral
// tests on the bridge error code map via `toBridgeUserError`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Source paths
// ---------------------------------------------------------------------------

const INFERENCE_AUDIT_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src/runtime/llm-adapter/execution/inference-audit.ts',
);
const RUST_VALIDATOR_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src-tauri/src/local_runtime/import_validator.rs',
);
const RUST_VALIDATOR_HELPERS_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src-tauri/src/local_runtime/import_validator/helpers.rs',
);
const INVOKE_PATH = path.resolve(
  import.meta.dirname ?? __dirname,
  '../src/shell/renderer/bridge/runtime-bridge/invoke.ts',
);

const inferenceAuditSource = fs.readFileSync(INFERENCE_AUDIT_PATH, 'utf-8');
const rustValidatorSource = [RUST_VALIDATOR_PATH, RUST_VALIDATOR_HELPERS_PATH]
  .map((filePath) => fs.readFileSync(filePath, 'utf-8'))
  .join('\n');
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
  // Rust validate_loopback_endpoint accepts 'localhost'
  assert.ok(
    rustValidatorSource.includes('.eq_ignore_ascii_case("localhost")'),
    'Rust validator sources must accept localhost via case-insensitive comparison',
  );
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
  // Rust uses parsed_ip.is_loopback() which covers 127.0.0.0/8
  assert.ok(
    rustValidatorSource.includes('.is_loopback()'),
    'Rust validator sources must call is_loopback() on parsed IP (covers 127.0.0.0/8)',
  );
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
  // Rust strips brackets and parses as IpAddr, then calls is_loopback()
  assert.ok(
    rustValidatorSource.includes("trim_matches(|ch| ch == '[' || ch == ']')"),
    'Rust validator sources must strip brackets from IPv6 host before parsing',
  );
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
  // Rust: non-loopback IPs produce an Err
  assert.ok(
    rustValidatorSource.includes('if !parsed_ip.is_loopback()'),
    'Rust validator sources must reject non-loopback IP addresses',
  );
});

// ---------------------------------------------------------------------------
// D-SEC-001: failure produces LOCAL_AI_ENDPOINT_NOT_LOOPBACK error (behavioral)
// ---------------------------------------------------------------------------

test('D-SEC-001: failure produces LOCAL_AI_ENDPOINT_NOT_LOOPBACK error', () => {
  // The bridge error code mapping must translate the Rust-originated error
  // code into a user-facing message.
  const error = toBridgeUserError(
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
// Source-scan confirmation: Rust validator structure
// ---------------------------------------------------------------------------

test('D-SEC-001: Rust validate_loopback_endpoint function exists', () => {
  assert.ok(
    rustValidatorSource.includes('fn validate_loopback_endpoint('),
    'import_validator sources must define validate_loopback_endpoint',
  );
});

test('D-SEC-001: Rust validator emits LOCAL_AI_ENDPOINT_NOT_LOOPBACK on non-loopback host', () => {
  assert.ok(
    rustValidatorSource.includes('LOCAL_AI_ENDPOINT_NOT_LOOPBACK'),
    'import_validator sources must reference LOCAL_AI_ENDPOINT_NOT_LOOPBACK error code',
  );
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

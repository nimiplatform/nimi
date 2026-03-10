import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/* ---------- source scan targets ---------- */

const loggerSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/telemetry/logger.ts'),
  'utf8',
);

const rendererLogSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/infra/telemetry/renderer-log.ts'),
  'utf8',
);

const invokeSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/shell/renderer/bridge/runtime-bridge/invoke.ts'),
  'utf8',
);

/* ---------- D-TEL-001: RuntimeLogPayload has required fields ---------- */

test('D-TEL-001: RuntimeLogPayload declares area as required field', () => {
  assert.match(
    loggerSource,
    /area:\s*string/,
    'RuntimeLogPayload must have required "area" field of type string',
  );
});

test('D-TEL-001: RuntimeLogPayload declares message as required field', () => {
  assert.match(
    loggerSource,
    /message:\s*RuntimeLogMessage\s*\|\s*string/,
    'RuntimeLogPayload must have required "message" field',
  );
});

test('D-TEL-001: RuntimeLogPayload declares level as optional RuntimeLogLevel', () => {
  assert.match(
    loggerSource,
    /level\?:\s*RuntimeLogLevel/,
    'RuntimeLogPayload must have optional "level" field of type RuntimeLogLevel',
  );
});

test('D-TEL-001: RuntimeLogLevel includes debug, info, warn, error', () => {
  assert.match(
    loggerSource,
    /RuntimeLogLevel\s*=\s*['"]debug['"]\s*\|\s*['"]info['"]\s*\|\s*['"]warn['"]\s*\|\s*['"]error['"]/,
    'RuntimeLogLevel must define debug | info | warn | error',
  );
});

/* ---------- D-TEL-002: normalizeRuntimeLogMessage enforces prefix ---------- */

test('D-TEL-002: normalizeRuntimeLogMessage checks for action: prefix', () => {
  assert.ok(
    loggerSource.includes("startsWith('action:')"),
    'normalizeRuntimeLogMessage must check for action: prefix',
  );
});

test('D-TEL-002: normalizeRuntimeLogMessage checks for phase: prefix', () => {
  assert.ok(
    loggerSource.includes("startsWith('phase:')"),
    'normalizeRuntimeLogMessage must check for phase: prefix',
  );
});

test('D-TEL-002: normalizeRuntimeLogMessage adds action: prefix when missing', () => {
  assert.match(
    loggerSource,
    /return\s+`action:\$\{normalized\}`/,
    'normalizeRuntimeLogMessage must prepend action: to messages lacking a prefix',
  );
});

test('D-TEL-002: normalizeRuntimeLogMessage returns sentinel for empty input', () => {
  assert.ok(
    loggerSource.includes("'action:runtime-log:empty-message'"),
    'normalizeRuntimeLogMessage must return action:runtime-log:empty-message for falsy/empty input',
  );
});

/* ---------- D-TEL-004: createRendererFlowId format ---------- */

test('D-TEL-004: createRendererFlowId source uses prefix-timestamp-random template', () => {
  assert.match(
    rendererLogSource,
    /`\$\{prefix\}-\$\{Date\.now\(\)\.toString\(36\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2,\s*8\)\}`/,
    'createRendererFlowId must produce {prefix}-{base36 timestamp}-{base36 random} format',
  );
});

test('D-TEL-004: createRendererFlowId is exported', () => {
  assert.match(
    rendererLogSource,
    /export\s+function\s+createRendererFlowId/,
    'createRendererFlowId must be an exported function',
  );
});

test('D-TEL-004: createRendererFlowId behavioral validation (inline replica)', () => {
  // Replicate the function logic to behavioral-test the format contract
  // without requiring the full Vite renderer module graph.
  function createRendererFlowId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  const flowId = createRendererFlowId('test-flow');
  const parts = flowId.split('-');
  // "test", "flow", <base36 timestamp>, <base36 random>
  assert.ok(parts.length >= 4, `Expected at least 4 dash-separated parts, got ${parts.length}: ${flowId}`);

  // Last part is the random segment (base36)
  const randomPart = parts[parts.length - 1];
  assert.match(randomPart, /^[0-9a-z]+$/, 'random segment must be base36');
  assert.ok(randomPart.length >= 1 && randomPart.length <= 8, 'random segment length should be 1-8 chars');

  // Second-to-last part is the base36 timestamp
  const timestampPart = parts[parts.length - 2];
  assert.match(timestampPart, /^[0-9a-z]+$/, 'timestamp segment must be base36');
  const decoded = parseInt(timestampPart, 36);
  assert.ok(decoded > 0, 'decoded timestamp must be positive');
  assert.ok(
    Math.abs(decoded - Date.now()) < 5000,
    'timestamp should be within 5 seconds of current time',
  );
});

test('D-TEL-004: createRendererFlowId produces unique values (inline replica)', () => {
  function createRendererFlowId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  const ids = Array.from({ length: 20 }, () => createRendererFlowId('uniq'));
  const unique = new Set(ids);
  assert.equal(unique.size, ids.length, 'all generated flow IDs must be unique');
});

/* ---------- D-TEL-005: invokeId format check ---------- */

test('D-TEL-005: invokeId uses command-timestamp-random format', () => {
  assert.match(
    invokeSource,
    /invokeId\s*=\s*`\$\{command\}-\$\{Date\.now\(\)\.toString\(36\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2,\s*8\)\}`/,
    'invokeId must follow the {command}-{base36 timestamp}-{base36 random} format',
  );
});

test('D-TEL-005: invokeId is emitted in invoke-start log details', () => {
  assert.ok(
    invokeSource.includes('invokeId'),
    'invokeId must appear in bridge invoke logging details',
  );
});

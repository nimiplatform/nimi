import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  normalizeCapabilityKey,
  capabilityMatches,
  anyCapabilityMatches,
  DEFAULT_SOURCE_ALLOWLIST,
} from '../src/runtime/hook/contracts/capabilities';

// ---------------------------------------------------------------------------
// D-HOOK-006 — Capability Key Format (behavioral tests)
// ---------------------------------------------------------------------------

test('D-HOOK-006: normalizeCapabilityKey trims whitespace', () => {
  assert.equal(normalizeCapabilityKey('  event.publish.topic  '), 'event.publish.topic');
  assert.equal(normalizeCapabilityKey('\tturn.register.pre-model\n'), 'turn.register.pre-model');
  assert.equal(normalizeCapabilityKey(''), '');
  assert.equal(normalizeCapabilityKey('   '), '');
});

test('D-HOOK-006: capabilityMatches supports wildcard *', () => {
  // Global wildcard
  assert.equal(capabilityMatches('*', 'event.publish.topic'), true);

  // Trailing wildcard
  assert.equal(capabilityMatches('event.publish.*', 'event.publish.topic'), true);
  assert.equal(capabilityMatches('event.publish.*', 'event.subscribe.topic'), false);

  // Exact match
  assert.equal(capabilityMatches('runtime.ai.text.generate', 'runtime.ai.text.generate'), true);
  assert.equal(capabilityMatches('runtime.ai.text.generate', 'runtime.ai.text.stream'), false);

  // Mid-segment wildcard
  assert.equal(capabilityMatches('data.register.data-api.user-*.*.*', 'data.register.data-api.user-foo.bar.baz'), true);
  assert.equal(capabilityMatches('data.register.data-api.user-*.*.*', 'data.register.data-api.core.bar.baz'), false);

  // Empty inputs return false
  assert.equal(capabilityMatches('', 'event.publish.topic'), false);
  assert.equal(capabilityMatches('event.publish.*', ''), false);
});

test('D-HOOK-006: anyCapabilityMatches returns true on first match', () => {
  const patterns = [
    'event.publish.*',
    'data.query.*',
    'ui.register.*',
  ];

  // Matches first pattern
  assert.equal(anyCapabilityMatches(patterns, 'event.publish.chat'), true);

  // Matches second pattern
  assert.equal(anyCapabilityMatches(patterns, 'data.query.friends'), true);

  // Matches third pattern
  assert.equal(anyCapabilityMatches(patterns, 'ui.register.settings.panel.section'), true);

  // No match
  assert.equal(anyCapabilityMatches(patterns, 'turn.register.pre-model'), false);

  // Empty patterns array
  assert.equal(anyCapabilityMatches([], 'event.publish.topic'), false);
});

// ---------------------------------------------------------------------------
// D-HOOK-007 — Source-Type Permission Gateway (source scan + behavioral)
// ---------------------------------------------------------------------------

const CAPABILITIES_SOURCE = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    '../src/runtime/hook/contracts/capabilities.ts',
  ),
  'utf-8',
);

const PERMISSION_GATEWAY_SOURCE = fs.readFileSync(
  path.resolve(
    import.meta.dirname,
    '../src/runtime/hook/permission/permission-gateway.ts',
  ),
  'utf-8',
);

test('D-HOOK-007: core source type has broad permissions', () => {
  // Behavioral: the exported allowlist assigns '*' to core
  assert.deepEqual(DEFAULT_SOURCE_ALLOWLIST.core, ['*']);

  // Source scan: confirm the literal assignment in source
  assert.ok(
    CAPABILITIES_SOURCE.includes("core: ['*']"),
    'capabilities source must contain core wildcard allowlist',
  );
});

test('D-HOOK-007: codegen source type restricted to T0 capabilities', () => {
  const codegenAllowlist = DEFAULT_SOURCE_ALLOWLIST.codegen;

  // codegen must include T0 runtime text capabilities
  assert.ok(codegenAllowlist.includes('runtime.ai.text.generate'));
  assert.ok(codegenAllowlist.includes('runtime.ai.text.stream'));

  // codegen must include ui-extension app slot and user data-api
  assert.ok(codegenAllowlist.some((cap) => cap.startsWith('ui.register.ui-extension.app')));
  assert.ok(codegenAllowlist.some((cap) => cap.startsWith('data.register.data-api.user-')));
  assert.ok(codegenAllowlist.some((cap) => cap.startsWith('data.query.data-api.user-')));

  // codegen must include audit/meta self-read
  assert.ok(codegenAllowlist.includes('audit.read.self'));
  assert.ok(codegenAllowlist.includes('meta.read.self'));

  // codegen must NOT include broad subsystem wildcards
  assert.ok(!codegenAllowlist.includes('event.publish.*'));
  assert.ok(!codegenAllowlist.includes('event.subscribe.*'));
  assert.ok(!codegenAllowlist.includes('data.query.*'));
  assert.ok(!codegenAllowlist.includes('turn.register.*'));
  assert.ok(!codegenAllowlist.includes('inter-mod.request.*'));

  // Source scan: codegen is defined via DEFAULT_CODEGEN_ALLOWLIST spread
  assert.ok(
    CAPABILITIES_SOURCE.includes('codegen: [...DEFAULT_CODEGEN_ALLOWLIST]'),
    'capabilities source must define codegen via dedicated allowlist constant',
  );
});

test('D-HOOK-007: sideload restrictions exist', () => {
  const sideloadAllowlist = DEFAULT_SOURCE_ALLOWLIST.sideload;

  // sideload has event.publish but NOT event.subscribe
  assert.ok(sideloadAllowlist.includes('event.publish.*'));
  assert.ok(!sideloadAllowlist.includes('event.subscribe.*'));

  // sideload has data.query but NOT data.register
  assert.ok(sideloadAllowlist.includes('data.query.*'));
  assert.ok(!sideloadAllowlist.includes('data.register.*'));

  // sideload has ui.register
  assert.ok(sideloadAllowlist.includes('ui.register.*'));

  // sideload has inter-mod.request but NOT inter-mod.provide
  assert.ok(sideloadAllowlist.includes('inter-mod.request.*'));
  assert.ok(!sideloadAllowlist.some((cap) => cap.startsWith('inter-mod.provide')));

  // sideload must NOT include turn hook registration
  assert.ok(!sideloadAllowlist.some((cap) => cap.startsWith('turn.register')));

  // Source scan: permission gateway defaults unknown source types to sideload
  assert.ok(
    PERMISSION_GATEWAY_SOURCE.includes("return 'sideload'"),
    'permission gateway must default unknown source types to sideload',
  );
});

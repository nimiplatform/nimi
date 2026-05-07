import assert from 'node:assert/strict';
import test from 'node:test';

import { preflightCodegenBundle } from '../src/runtime/mod/codegen/preflight';
import { resolveCodegenConsentDecision } from '../src/runtime/mod/codegen';

test('source-type codegen ceiling blocks T1 media capabilities before consent grants', () => {
  const preflight = preflightCodegenBundle({
    modId: 'world.nimi.user.codegen.consent',
    capabilities: ['runtime.ai.text.generate', 'runtime.media.image.generate', 'runtime.media.video.generate'],
    sourceCode: 'export const value = 1;',
  });

  assert.equal(preflight.ok, false);
  assert.deepEqual(preflight.consentRequiredCapabilities, []);
  assert.deepEqual(preflight.deniedCapabilities, [
    'runtime.media.image.generate',
    'runtime.media.video.generate',
  ]);

  const consent = resolveCodegenConsentDecision({
    preflight,
    approvedCapabilities: ['runtime.media.image.generate'],
  });

  assert.ok(consent.grantedCapabilities.includes('runtime.ai.text.generate'));
  assert.ok(!consent.grantedCapabilities.includes('runtime.media.image.generate'));
  assert.deepEqual(consent.deniedCapabilities, []);
});

test('codegen preflight rejects wildcard manifest capability declarations', () => {
  const preflight = preflightCodegenBundle({
    modId: 'world.nimi.user.codegen.wildcard',
    capabilities: ['runtime.ai.text.generate', 'ui.register.ui-extension.app.*'],
    sourceCode: 'export const value = 1;',
  });

  assert.equal(preflight.ok, false);
  assert.deepEqual(preflight.deniedCapabilities, ['ui.register.ui-extension.app.*']);
  assert.equal(preflight.reasonCode, 'CODEGEN_CAPABILITY_DENIED');
});

test('codegen preflight rejects aliased and computed access to forbidden globals', () => {
  const preflight = preflightCodegenBundle({
    modId: 'world.nimi.user.codegen.static-scan',
    capabilities: ['runtime.ai.text.generate'],
    sourceCode: [
      'const request = fetch;',
      'const SocketCtor = globalThis["WebSocket"];',
      'const DynamicFunction = Function;',
      'export const value = [request, SocketCtor, DynamicFunction];',
    ].join('\n'),
  });

  assert.equal(preflight.ok, false);
  assert.deepEqual(
    preflight.violations.map((item) => item.reasonCode),
    [
      'CODEGEN_PATTERN_NEW_FUNCTION_FORBIDDEN',
      'CODEGEN_PATTERN_FETCH_FORBIDDEN',
      'CODEGEN_PATTERN_WEBSOCKET_FORBIDDEN',
    ],
  );
});

test('codegen preflight does not treat prompt text literals as forbidden global access', () => {
  const preflight = preflightCodegenBundle({
    modId: 'world.nimi.user.codegen.literal-text',
    capabilities: ['runtime.ai.text.generate'],
    sourceCode: 'export const prompt = "please describe fetch and WebSocket without calling them";',
  });

  assert.equal(preflight.ok, true);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCodegenCapability,
  isCodegenManifestWildcardCapability,
  resolveCodegenCapabilityDecision,
} from '../src/runtime/mod/codegen/capability-catalog';

test('catalog classifies T0/T1/T2 correctly', () => {
  assert.equal(classifyCodegenCapability('runtime.ai.text.generate'), 'T0');
  assert.equal(classifyCodegenCapability('runtime.media.image.generate'), 'T1');
  assert.equal(classifyCodegenCapability('runtime.media.jobs.submit'), 'UNKNOWN');
  assert.equal(classifyCodegenCapability('runtime.local.assets.list'), 'T1');
  assert.equal(classifyCodegenCapability('turn.register.pre-model'), 'T2');
});

test('unknown capabilities are returned as unknown and denied in decision stage', () => {
  const decision = resolveCodegenCapabilityDecision([
    'runtime.ai.text.generate',
    'custom.unregistered.capability',
  ]);

  assert.deepEqual(decision.autoGranted, ['runtime.ai.text.generate']);
  assert.deepEqual(decision.unknown, ['custom.unregistered.capability']);
});

test('source-type codegen ceiling hard-denies T1 capabilities outside the allowlist', () => {
  const decision = resolveCodegenCapabilityDecision([
    'runtime.media.image.generate',
    'runtime.local.assets.list',
  ]);

  assert.deepEqual(decision.autoGranted, []);
  assert.deepEqual(decision.requiresConsent, []);
  assert.deepEqual(decision.denied, [
    'runtime.media.image.generate',
    'runtime.local.assets.list',
  ]);
  assert.deepEqual(decision.unknown, []);
});

test('codegen manifest wildcard declarations are denied even when catalog patterns match concrete capabilities', () => {
  assert.equal(classifyCodegenCapability('ui.register.ui-extension.app.content.routes'), 'T0');
  assert.equal(isCodegenManifestWildcardCapability('ui.register.ui-extension.app.*'), true);
  assert.equal(isCodegenManifestWildcardCapability('ui.register.ui-extension.app.content.routes'), false);

  const decision = resolveCodegenCapabilityDecision([
    'runtime.ai.text.generate',
    'ui.register.ui-extension.app.*',
    'data.register.data-api.user-*.*.*',
  ]);

  assert.deepEqual(decision.autoGranted, ['runtime.ai.text.generate']);
  assert.deepEqual(decision.requiresConsent, []);
  assert.deepEqual(decision.denied, [
    'ui.register.ui-extension.app.*',
    'data.register.data-api.user-*.*.*',
  ]);
  assert.deepEqual(decision.unknown, []);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCodegenCapability,
  resolveCodegenCapabilityDecision,
} from '../src/runtime/mod/codegen/capability-catalog';

test('catalog classifies T0/T1/T2 correctly', () => {
  assert.equal(classifyCodegenCapability('runtime.ai.text.generate'), 'T0');
  assert.equal(classifyCodegenCapability('runtime.media.image.generate'), 'T1');
  assert.equal(classifyCodegenCapability('runtime.media.jobs.submit'), 'T1');
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

test('runtime.local capability domain requires consent instead of falling through to unknown', () => {
  const decision = resolveCodegenCapabilityDecision([
    'runtime.local.assets.list',
  ]);

  assert.deepEqual(decision.autoGranted, []);
  assert.deepEqual(decision.requiresConsent, ['runtime.local.assets.list']);
  assert.deepEqual(decision.denied, []);
  assert.deepEqual(decision.unknown, []);
});

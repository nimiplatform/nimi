import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCodegenCapability,
  resolveCodegenCapabilityDecision,
} from '../src/runtime/mod/codegen/capability-catalog';

test('catalog classifies T0/T1/T2 correctly', () => {
  assert.equal(classifyCodegenCapability('llm.text.generate'), 'T0');
  assert.equal(classifyCodegenCapability('llm.image.generate'), 'T1');
  assert.equal(classifyCodegenCapability('turn.register.pre-model'), 'T2');
});

test('unknown capabilities are returned as unknown and denied in decision stage', () => {
  const decision = resolveCodegenCapabilityDecision([
    'llm.text.generate',
    'custom.unregistered.capability',
  ]);

  assert.deepEqual(decision.autoGranted, ['llm.text.generate']);
  assert.deepEqual(decision.unknown, ['custom.unregistered.capability']);
});

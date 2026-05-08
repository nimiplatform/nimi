import assert from 'node:assert/strict';
import test from 'node:test';

import { applyRuntimeFields } from '../src/shell/renderer/mod-ui/host/field-bindings.js';

test('mod runtime field bindings preserve admitted custom runtime fields', () => {
  let captured: Record<string, string | number | boolean> | null = null;

  applyRuntimeFields({
    setRuntimeFields: (fields) => {
      captured = fields;
    },
  }, {
    targetType: 'agent',
    customCapabilityRef: 'world.generate',
    'mod.runtime.context': 'scene-42',
    turnIndex: '7',
    userConfirmedUpload: 'true',
  });

  assert.deepEqual(captured, {
    targetType: 'agent',
    customCapabilityRef: 'world.generate',
    'mod.runtime.context': 'scene-42',
    turnIndex: 7,
    userConfirmedUpload: true,
  });
});

test('mod runtime field bindings reject only unsafe runtime field keys', () => {
  let captured: Record<string, string | number | boolean> | null = null;

  applyRuntimeFields({
    setRuntimeFields: (fields) => {
      captured = fields;
    },
  }, {
    ['__proto__']: 'polluted',
    constructor: 'polluted',
    prototype: 'polluted',
    safeExtension: 'kept',
  });

  assert.deepEqual(captured, {
    safeExtension: 'kept',
  });
  assert.equal(({} as Record<string, unknown>).safeExtension, undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

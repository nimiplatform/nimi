import assert from 'node:assert/strict';
import test from 'node:test';

import { assertRuntimeModCapabilitiesDeclared } from '../src/runtime/mod/host/lifecycle-validate.js';

test('runtime mod lifecycle rejects baseline capabilities without manifest declarations', () => {
  assert.throws(
    () => assertRuntimeModCapabilitiesDeclared({
      baselineCapabilities: ['runtime.ai.text.generate'],
      manifestCapabilities: [],
    }),
    /RUNTIME_MOD_CAPABILITY_NOT_DECLARED: runtime\.ai\.text\.generate/,
  );
});

test('runtime mod lifecycle allows empty manifest declarations only when no baseline exists', () => {
  assert.doesNotThrow(() => assertRuntimeModCapabilitiesDeclared({
    baselineCapabilities: [],
    manifestCapabilities: [],
  }));
});

test('runtime mod lifecycle accepts declared baseline capabilities', () => {
  assert.doesNotThrow(() => assertRuntimeModCapabilitiesDeclared({
    baselineCapabilities: ['runtime.ai.text.generate'],
    manifestCapabilities: ['runtime.ai.text.*'],
  }));
});

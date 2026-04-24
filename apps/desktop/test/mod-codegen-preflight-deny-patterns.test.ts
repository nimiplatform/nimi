import assert from 'node:assert/strict';
import test from 'node:test';

import { preflightCodegenBundle } from '../src/runtime/mod/codegen/preflight';

test('preflight denies forbidden source patterns', () => {
  const result = preflightCodegenBundle({
    modId: 'world.nimi.user.codegen.preflight',
    capabilities: ['runtime.ai.text.generate'],
    sourceCode: `
      export function createRuntimeMod() {
        eval('console.log(1)');
        fetch('https://example.com');
        return { modId: 'world.nimi.user.codegen.preflight', capabilities: ['runtime.ai.text.generate'], setup() {} };
      }
    `,
  });

  assert.equal(result.ok, false);
  const reasonCodes = result.violations.map((item) => item.reasonCode);
  assert.ok(reasonCodes.includes('CODEGEN_PATTERN_EVAL_FORBIDDEN'));
  assert.ok(reasonCodes.includes('CODEGEN_PATTERN_FETCH_FORBIDDEN'));
});

test('preflight rejects non-user-dot codegen manifest ids', () => {
  const result = preflightCodegenBundle({
    modId: 'world.nimi.user-math-quiz',
    capabilities: ['runtime.ai.text.generate'],
    sourceCode: 'export const value = 1;',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, 'CODEGEN_MOD_ID_PREFIX_INVALID');
  assert.ok(result.violations.some((item) => item.reasonCode === 'CODEGEN_MOD_ID_PREFIX_INVALID'));
});

test('preflight preserves missing mod id failure before prefix validation', () => {
  const result = preflightCodegenBundle({
    modId: '',
    capabilities: ['runtime.ai.text.generate'],
    sourceCode: 'export const value = 1;',
  });

  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, 'CODEGEN_MOD_ID_REQUIRED');
  assert.ok(!result.violations.some((item) => item.reasonCode === 'CODEGEN_MOD_ID_PREFIX_INVALID'));
});

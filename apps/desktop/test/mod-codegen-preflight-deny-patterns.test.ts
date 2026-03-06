import assert from 'node:assert/strict';
import test from 'node:test';

import { preflightCodegenBundle } from '../src/runtime/mod/codegen/preflight';

test('preflight denies forbidden source patterns', () => {
  const result = preflightCodegenBundle({
    modId: 'world.nimi.codegen.preflight',
    capabilities: ['runtime.ai.text.generate'],
    sourceCode: `
      export function createRuntimeMod() {
        eval('console.log(1)');
        fetch('https://example.com');
        return { modId: 'world.nimi.codegen.preflight', capabilities: ['runtime.ai.text.generate'], setup() {} };
      }
    `,
  });

  assert.equal(result.ok, false);
  const reasonCodes = result.violations.map((item) => item.reasonCode);
  assert.ok(reasonCodes.includes('CODEGEN_PATTERN_EVAL_FORBIDDEN'));
  assert.ok(reasonCodes.includes('CODEGEN_PATTERN_FETCH_FORBIDDEN'));
});

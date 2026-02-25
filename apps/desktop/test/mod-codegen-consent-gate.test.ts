import assert from 'node:assert/strict';
import test from 'node:test';

import { preflightCodegenBundle } from '../src/runtime/mod/codegen/preflight';
import { resolveCodegenConsentDecision } from '../src/runtime/mod/codegen';

test('consent gate splits granted/denied T1 capabilities', () => {
  const preflight = preflightCodegenBundle({
    modId: 'world.nimi.codegen.consent',
    capabilities: ['llm.text.generate', 'llm.image.generate', 'llm.video.generate'],
    sourceCode: 'export const value = 1;',
  });

  const consent = resolveCodegenConsentDecision({
    preflight,
    approvedCapabilities: ['llm.image.generate'],
  });

  assert.ok(consent.grantedCapabilities.includes('llm.text.generate'));
  assert.ok(consent.grantedCapabilities.includes('llm.image.generate'));
  assert.ok(consent.deniedCapabilities.includes('llm.video.generate'));
});

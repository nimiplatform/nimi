import assert from 'node:assert/strict';
import test from 'node:test';

import { preflightCodegenBundle } from '../src/runtime/mod/codegen/preflight';
import { resolveCodegenConsentDecision } from '../src/runtime/mod/codegen';

test('consent gate splits granted/denied T1 capabilities', () => {
  const preflight = preflightCodegenBundle({
    modId: 'world.nimi.codegen.consent',
    capabilities: ['runtime.ai.text.generate', 'runtime.media.image.generate', 'runtime.media.video.generate'],
    sourceCode: 'export const value = 1;',
  });

  const consent = resolveCodegenConsentDecision({
    preflight,
    approvedCapabilities: ['runtime.media.image.generate'],
  });

  assert.ok(consent.grantedCapabilities.includes('runtime.ai.text.generate'));
  assert.ok(consent.grantedCapabilities.includes('runtime.media.image.generate'));
  assert.ok(consent.deniedCapabilities.includes('runtime.media.video.generate'));
});

import assert from 'node:assert/strict';
import test from 'node:test';

import * as runtimeGenerated from './generated';

test('runtime generated public barrel exposes scenario enum values used by live runners', () => {
  assert.equal(runtimeGenerated.FallbackPolicy.DENY, 1);
  assert.equal(runtimeGenerated.VoiceReferenceKind.PRESET, 1);
});

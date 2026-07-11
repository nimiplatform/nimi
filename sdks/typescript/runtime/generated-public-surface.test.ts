import assert from 'node:assert/strict';
import test from 'node:test';

import * as runtimeGenerated from './generated';

test('runtime generated public barrel does not expose raw descriptor client surface', () => {
  assert.equal('RuntimeGeneratedClient' in runtimeGenerated, false);
  assert.equal('RUNTIME_METHODS' in runtimeGenerated, false);
  assert.equal('RUNTIME_METHOD_BY_ID' in runtimeGenerated, false);
  assert.equal('RuntimeTypedClient' in runtimeGenerated, false);
  assert.equal('ExecuteDelegatedCapabilityRequest' in runtimeGenerated, false);
  assert.equal('ExecuteDelegatedCapabilityResponse' in runtimeGenerated, false);
  assert.equal('ResumeDelegatedCapabilityRequest' in runtimeGenerated, false);
  assert.equal('ResumeDelegatedCapabilityResponse' in runtimeGenerated, false);
  assert.equal('RegisterAvatarLiveInstanceBindingRequest' in runtimeGenerated, false);
  assert.equal('RegisterAvatarLiveInstanceBindingResponse' in runtimeGenerated, false);
});

test('runtime generated public barrel exposes scenario enum values used by live runners', () => {
  assert.equal(runtimeGenerated.FallbackPolicy.DENY, 1);
  assert.equal(runtimeGenerated.VoiceReferenceKind.PRESET, 1);
});

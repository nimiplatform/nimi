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
